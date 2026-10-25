// Each ball's trail and glow: a streak behind a fast ball and a soft disc of light on the playfield under it, both in
// the colour of the streamer playing it (gold for a house ball). Everything is in the table's own coordinates (x
// across, y up off the playfield, z up the table), as table-mesh.ts. Like the sparks (sparks.ts), all of it is made
// once, in the constructor, for the most balls the table ever has: one mesh holds every ball's trail and one every
// ball's glow, their buffers are written in place each frame, and a ball's place that is not in use is parked out of
// sight. So nothing is made per frame, however many balls are in play. The trail and glow run on the stage's drawn
// clock (`now`), which the stage gives to show() and frame().
//
// The trail is not a lamp (the plan's Decision 6): it never blinks on, its brightness follows the ball's speed. A ball
// rattling between bumpers swings its speed across the whole range several times a second, though, which would make
// the trail flash as fast. So its brightness may rise only TRAIL_RISE of its peak a second and fall only TRAIL_FALL:
// going from dark to lit (DARK_BELOW to LIT_ABOVE, light-show.ts) and back takes 0.35 s at the least, and 4 rises
// take 1.05 s, so it never rises more than 3 times in any second, as the stage's lights never do.
import * as THREE from 'three';

/**
 * How a ball looks (the plan's Decisions 2 to 4). Its trail shows from `trailFrom` units a second, faintly, and is at
 * its full `trailPeak` opacity from `trailFull`; it covers the last `trailSeconds` of the ball's path, kept as
 * `trailPoints` points. Its glow is a disc `glowRadii` ball radii out at `glowOpacity`. A house ball, or one from a
 * server too old to send a colour, is `houseColor`.
 */
export const BALL_LOOK = {
  trailFrom: 18,
  trailFull: 36,
  trailSeconds: 0.12,
  trailPoints: 8,
  trailPeak: 0.55,
  glowRadii: 1.6,
  glowOpacity: 0.22,
  houseColor: 0xffc23a,
} as const;

/** How many triangles round a glow's disc: enough that its edge, faded to nothing, reads as round. */
export const GLOW_SEGMENTS = 16;

/**
 * How fast a trail's brightness may rise and fall, in its peak a second. Together they keep a dark-to-lit-and-back
 * cycle to (LIT_ABOVE - DARK_BELOW) × (1/rise + 1/fall) = 0.35 s at the least, over a third of a second, so that 4
 * rises take more than a second. Rising faster than it falls lets a ball that is hit light its trail quickly.
 */
const TRAIL_RISE = 3;
const TRAIL_FALL = 1.5;
/** The glow's height over the playfield: just above it, so it is drawn on it and not into it. */
const GLOW_Y = 0.01;
/** A jump of more than this many ball diameters in one frame is the ball being put somewhere, not flying there. */
const JUMP_DIAMETERS = 4;
/** Where a place not in use is parked: far under the playfield, where nothing is drawn. */
const PARKED = -1000;

/** What a free place holds for its ball's id. */
const FREE = Number.NaN;

/**
 * The balls' trails and glows, from pools for `maxBalls` balls made at the start. The stage calls show() for each ball
 * it draws each frame, then frame(); a ball that has left goes with end(), and one that has been put somewhere (a save,
 * an unstick) has its path forgotten with jump().
 */
export class BallTrails {
  /** The trails' mesh and the glows' mesh, for the stage to add to the table. */
  readonly group = new THREE.Group();
  private readonly maxBalls: number;
  private readonly ballRadius: number;
  private readonly trailPosition: THREE.BufferAttribute;
  private readonly trailColor: THREE.BufferAttribute;
  private readonly glowPosition: THREE.BufferAttribute;
  private readonly glowColor: THREE.BufferAttribute;

  /** Each place's ball (FREE when it has none), and whether it was shown since the last frame. */
  private readonly ids: Float64Array;
  private readonly shown: Uint8Array;
  /** Each place's ring of the ball's last positions and their times (x, y, z, t), its newest and how many it holds. */
  private readonly ring: Float64Array;
  private readonly newest: Int32Array;
  private readonly count: Int32Array;
  /** Each place's ball's colour (its red, green and blue as three draws them), whether it is held, and when shown. */
  private readonly rgb: Float32Array;
  private readonly held: Uint8Array;
  private readonly seenAt: Float64Array;
  /** Each place's trail brightness, of its peak (0 to 1), eased toward what its speed asks (see TRAIL_RISE). */
  private readonly level: Float64Array;
  /** Each place's trail's last sideways direction across the table (x, z), kept for a point where the path stops. */
  private readonly side: Float64Array;
  /** A colour to read a hex into: made once, used at every show. */
  private readonly hex = new THREE.Color();

  constructor(maxBalls: number, ballRadius: number) {
    this.maxBalls = maxBalls;
    this.ballRadius = ballRadius;
    const points = BALL_LOOK.trailPoints;
    this.ids = new Float64Array(maxBalls).fill(FREE);
    this.shown = new Uint8Array(maxBalls);
    this.ring = new Float64Array(maxBalls * points * 4);
    this.newest = new Int32Array(maxBalls);
    this.count = new Int32Array(maxBalls);
    this.rgb = new Float32Array(maxBalls * 3);
    this.held = new Uint8Array(maxBalls);
    this.seenAt = new Float64Array(maxBalls);
    this.level = new Float64Array(maxBalls);
    this.side = new Float64Array(maxBalls * 2);

    // The trails: a strip for each place, two vertices at each of its points (one each side of the path), the head's
    // first; each point's two triangles join it to the next point's vertices.
    const trailVertices = maxBalls * points * 2;
    const trail = new THREE.BufferGeometry();
    this.trailPosition = new THREE.BufferAttribute(new Float32Array(trailVertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.trailColor = new THREE.BufferAttribute(new Float32Array(trailVertices * 4), 4).setUsage(THREE.DynamicDrawUsage);
    trail.setAttribute('position', this.trailPosition);
    trail.setAttribute('color', this.trailColor);
    const trailIndex: number[] = [];
    for (let s = 0; s < maxBalls; s++) {
      for (let k = 0; k < points - 1; k++) {
        const v = 2 * (s * points + k);
        trailIndex.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    trail.setIndex(trailIndex);

    // The glows: a fan for each place, its centre first and then its rim, its triangles facing up.
    const fan = GLOW_SEGMENTS + 1;
    const glowVertices = maxBalls * fan;
    const glow = new THREE.BufferGeometry();
    this.glowPosition = new THREE.BufferAttribute(new Float32Array(glowVertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.glowColor = new THREE.BufferAttribute(new Float32Array(glowVertices * 4), 4).setUsage(THREE.DynamicDrawUsage);
    glow.setAttribute('position', this.glowPosition);
    glow.setAttribute('color', this.glowColor);
    const glowIndex: number[] = [];
    for (let s = 0; s < maxBalls; s++) {
      const c = s * fan;
      for (let k = 0; k < GLOW_SEGMENTS; k++) glowIndex.push(c, c + 1 + ((k + 1) % GLOW_SEGMENTS), c + 1 + k);
    }
    glow.setIndex(glowIndex);

    const material = (side: THREE.Side) =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side,
      });
    // A strip turns as its ball does, so it is drawn from either side; a glow always faces up.
    const trails = new THREE.Mesh(trail, material(THREE.DoubleSide));
    const glows = new THREE.Mesh(glow, material(THREE.FrontSide));
    // The balls go anywhere on the table, and three.js works a mesh's bounding sphere out once, from its vertices as
    // they are at the start: all parked.
    trails.frustumCulled = glows.frustumCulled = false;
    trails.name = 'ball-trails';
    glows.name = 'ball-glows';
    this.group.add(trails, glows);
    this.clear();
  }

  /**
   * Ball `id` drawn at (x, y, z) this frame, at `t` on the drawn clock, in its owner's `color` (null for gold). A ball
   * new to the trails takes a free place; with every place taken it is not drawn. A held ball shows no trail.
   */
  show(id: number, x: number, y: number, z: number, color: number | null, held: boolean, t: number): void {
    let s = this.slotOf(id);
    if (s < 0) {
      s = this.slotOf(FREE);
      if (s < 0) return;
      this.ids[s] = id;
      this.forget(s);
      this.level[s] = 0;
      this.seenAt[s] = t;
    }
    this.shown[s] = 1;
    this.hex.setHex(color ?? BALL_LOOK.houseColor);
    this.rgb[3 * s] = this.hex.r;
    this.rgb[3 * s + 1] = this.hex.g;
    this.rgb[3 * s + 2] = this.hex.b;
    this.held[s] = held ? 1 : 0;

    // A held ball has no trail at once, and starts a new path when it goes.
    if (held) {
      this.level[s] = 0;
      this.forget(s);
      this.record(s, x, y, z, t);
      this.seenAt[s] = t;
      return;
    }
    // Put somewhere further than a ball flies in a frame: its path starts again here, from dark.
    if (this.count[s] > 0) {
      const n = this.at(s, 0);
      const moved = Math.hypot(x - this.ring[n], y - this.ring[n + 1], z - this.ring[n + 2]);
      if (moved > JUMP_DIAMETERS * 2 * this.ballRadius) {
        this.forget(s);
        this.level[s] = 0;
      }
    }
    this.record(s, x, y, z, t);

    // The ball's speed from its last two points, and the brightness it asks for, eased toward at TRAIL_RISE and
    // TRAIL_FALL over the time since the ball was last shown. With no second point (a new path) it keeps as it is.
    const step = t - this.seenAt[s];
    this.seenAt[s] = t;
    if (this.count[s] < 2 || !(step > 0)) return;
    const a = this.at(s, 0);
    const b = this.at(s, 1);
    const dt = this.ring[a + 3] - this.ring[b + 3];
    if (!(dt > 0)) return;
    const speed = Math.hypot(this.ring[a] - this.ring[b], this.ring[a + 1] - this.ring[b + 1], this.ring[a + 2] - this.ring[b + 2]) / dt;
    const goal = THREE.MathUtils.clamp((speed - BALL_LOOK.trailFrom) / (BALL_LOOK.trailFull - BALL_LOOK.trailFrom), 0, 1);
    const now = this.level[s];
    this.level[s] = goal > now ? Math.min(goal, now + TRAIL_RISE * step) : Math.max(goal, now - TRAIL_FALL * step);
  }

  /** Ball `id` has left: its place is free and its trail and glow are gone at once. */
  end(id: number): void {
    const s = this.slotOf(id);
    if (s < 0) return;
    this.free(s);
    this.park(s);
    this.changed();
  }

  /** Ball `id` was put somewhere (a save, an unstick): its path is forgotten, so no streak is drawn from where it was. */
  jump(id: number): void {
    const s = this.slotOf(id);
    if (s < 0) return;
    this.forget(s);
    this.level[s] = 0;
  }

  /**
   * After every ball has been shown: a ball not shown since the last frame has left, and its place is freed; every
   * place's trail and glow are written into the buffers for `t`, the drawn clock's time.
   */
  frame(t: number): void {
    for (let s = 0; s < this.maxBalls; s++) {
      if (!Number.isNaN(this.ids[s]) && !this.shown[s]) this.free(s);
      if (Number.isNaN(this.ids[s])) this.park(s);
      else this.draw(s, t);
      this.shown[s] = 0;
    }
    this.changed();
  }

  /** Lets every ball go (a fresh hello, or the drawn clock starting again). */
  clear(): void {
    for (let s = 0; s < this.maxBalls; s++) {
      this.free(s);
      this.park(s);
    }
    this.changed();
  }

  /** Ball `id`'s trail at its head now, its opacity: 0 for a ball held, unknown or too slow. */
  trailOpacity(id: number): number {
    const s = this.slotOf(id);
    if (s < 0 || this.held[s]) return 0;
    return this.level[s] * BALL_LOOK.trailPeak;
  }

  /** The place ball `id` has (FREE finds a free place), or -1. */
  private slotOf(id: number): number {
    for (let s = 0; s < this.maxBalls; s++) {
      const has = this.ids[s];
      if (Number.isNaN(id) ? Number.isNaN(has) : has === id) return s;
    }
    return -1;
  }

  /** Where in the ring place `s`'s `back`-th newest point is (0 the newest). */
  private at(s: number, back: number): number {
    const points = BALL_LOOK.trailPoints;
    return 4 * (s * points + ((this.newest[s] - back + points) % points));
  }

  /**
   * Adds (x, y, z) at `t` to place `s`'s path. The points are kept about trailSeconds / (trailPoints - 1) apart, so the
   * ring covers trailSeconds whatever the frame rate: while the newest is less than that after the one before it, it is
   * moved to the ball rather than a new one added.
   */
  private record(s: number, x: number, y: number, z: number, t: number): void {
    const spacing = BALL_LOOK.trailSeconds / (BALL_LOOK.trailPoints - 1);
    if (!(this.count[s] >= 2 && t - this.ring[this.at(s, 1) + 3] < spacing)) {
      this.newest[s] = (this.newest[s] + 1) % BALL_LOOK.trailPoints;
      this.count[s] = Math.min(BALL_LOOK.trailPoints, this.count[s] + 1);
    }
    const n = this.at(s, 0);
    this.ring[n] = x;
    this.ring[n + 1] = y;
    this.ring[n + 2] = z;
    this.ring[n + 3] = t;
  }

  /** Forgets place `s`'s path. */
  private forget(s: number): void {
    this.count[s] = 0;
  }

  /** Frees place `s`. */
  private free(s: number): void {
    this.ids[s] = FREE;
    this.shown[s] = 0;
    this.held[s] = 0;
    this.level[s] = 0;
    this.forget(s);
  }

  /** Writes place `s`'s trail and glow for `t`. */
  private draw(s: number, t: number): void {
    const head = this.at(s, 0);
    this.drawGlow(s, this.ring[head], this.ring[head + 2]);
    // The points of the path within trailSeconds of now (the head always): with fewer than two there is no trail.
    let n = 1;
    while (n < this.count[s] && t - this.ring[this.at(s, n) + 3] <= BALL_LOOK.trailSeconds + 1e-9) n++;
    const opacity = this.held[s] ? 0 : this.level[s] * BALL_LOOK.trailPeak;
    if (n < 2 || opacity <= 0) {
      this.parkTrail(s);
      return;
    }
    const pos = this.trailPosition.array as Float32Array;
    const col = this.trailColor.array as Float32Array;
    const points = BALL_LOOK.trailPoints;
    for (let k = 0; k < points; k++) {
      // Points past the drawn ones lie on the tail's, dark, so their triangles have no area.
      const i = Math.min(k, n - 1);
      const p = this.at(s, i);
      // Across the path at this point: square to it from the point before to the one after, in the playfield's plane.
      const ahead = this.at(s, Math.max(0, i - 1));
      const behind = this.at(s, Math.min(n - 1, i + 1));
      const dx = this.ring[ahead] - this.ring[behind];
      const dz = this.ring[ahead + 2] - this.ring[behind + 2];
      const length = Math.hypot(dx, dz);
      if (length > 1e-9) {
        this.side[2 * s] = -dz / length;
        this.side[2 * s + 1] = dx / length;
      }
      // As wide as the ball and as bright as the trail at its head, both tapering to nothing at its tail.
      const left = 1 - i / (n - 1);
      const half = this.ballRadius * left;
      const sx = this.side[2 * s] * half;
      const sz = this.side[2 * s + 1] * half;
      const v = 2 * (s * points + k);
      for (let e = 0; e < 2; e++) {
        const sign = e === 0 ? 1 : -1;
        pos[3 * (v + e)] = this.ring[p] + sign * sx;
        pos[3 * (v + e) + 1] = this.ring[p + 1];
        pos[3 * (v + e) + 2] = this.ring[p + 2] + sign * sz;
        col[4 * (v + e)] = this.rgb[3 * s];
        col[4 * (v + e) + 1] = this.rgb[3 * s + 1];
        col[4 * (v + e) + 2] = this.rgb[3 * s + 2];
        col[4 * (v + e) + 3] = opacity * left;
      }
    }
  }

  /** Writes place `s`'s glow, a disc lying on the playfield under (x, z): its colour at its centre, fading to its rim. */
  private drawGlow(s: number, x: number, z: number): void {
    const pos = this.glowPosition.array as Float32Array;
    const col = this.glowColor.array as Float32Array;
    const radius = BALL_LOOK.glowRadii * this.ballRadius;
    const c = s * (GLOW_SEGMENTS + 1);
    for (let k = 0; k <= GLOW_SEGMENTS; k++) {
      const v = c + k;
      const turn = ((k - 1) / GLOW_SEGMENTS) * Math.PI * 2;
      pos[3 * v] = k === 0 ? x : x + radius * Math.cos(turn);
      pos[3 * v + 1] = GLOW_Y;
      pos[3 * v + 2] = k === 0 ? z : z + radius * Math.sin(turn);
      col[4 * v] = this.rgb[3 * s];
      col[4 * v + 1] = this.rgb[3 * s + 1];
      col[4 * v + 2] = this.rgb[3 * s + 2];
      col[4 * v + 3] = k === 0 ? BALL_LOOK.glowOpacity : 0;
    }
  }

  /** Puts place `s`'s trail and glow out of sight: dark, and far under the playfield. */
  private park(s: number): void {
    this.parkTrail(s);
    const pos = this.glowPosition.array as Float32Array;
    const col = this.glowColor.array as Float32Array;
    const fan = GLOW_SEGMENTS + 1;
    for (let v = s * fan; v < (s + 1) * fan; v++) {
      pos[3 * v] = pos[3 * v + 2] = 0;
      pos[3 * v + 1] = PARKED;
      col[4 * v + 3] = 0;
    }
  }

  /** Puts place `s`'s trail out of sight. */
  private parkTrail(s: number): void {
    const pos = this.trailPosition.array as Float32Array;
    const col = this.trailColor.array as Float32Array;
    const each = 2 * BALL_LOOK.trailPoints;
    for (let v = s * each; v < (s + 1) * each; v++) {
      pos[3 * v] = pos[3 * v + 2] = 0;
      pos[3 * v + 1] = PARKED;
      col[4 * v + 3] = 0;
    }
  }

  /** The buffers are to be sent to the graphics card again. */
  private changed(): void {
    this.trailPosition.needsUpdate = true;
    this.trailColor.needsUpdate = true;
    this.glowPosition.needsUpdate = true;
    this.glowColor.needsUpdate = true;
  }
}
