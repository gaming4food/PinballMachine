// The sandstorm's look on the stage (chat's event): sand blowing across the table with the wind, and the amber haze
// over the table's picture. The sand is a pool of MAX_GRAINS of its own, made at the start, so a storm never takes the
// sparks' (sparks.ts) and a busy moment can't slow the stage; a grain that has crossed is parked out of sight, and
// nothing is made after the constructor. Everything is in the table's own coordinates (x across, y up off the
// playfield, z up the table), as sparks.ts, and moves on the table's clock, the `step` that update() is given, so it
// stands still while the table does.
//
// The haze is not a flash: it eases in over HAZE.ease from the moment the stage first saw the storm and out to the
// storm's end, and the stage draws it through easeHaze, which never lets it change faster than that ease, even where a
// second storm moves the end on in the middle of the ease out.
import * as THREE from 'three';
import { TABLE } from '../shared/table';
import { dotMap, sizeInWorld } from './sparks';

/** The most grains blowing at once: a grain the wind would send past it isn't sent. */
export const MAX_GRAINS = 240;

/**
 * The haze over the picture while a storm blows: its colour, the most of it mixed into the picture (0 to 1), and how
 * long it takes to ease in or out (s).
 */
export const HAZE = { color: 0xd9a35a, most: 0.18, ease: 0.8 } as const;

/** How many grains enter a second while the wind blows, across the table's length. */
const RATE = 60;
/** How fast a grain crosses (units a second along x, with the wind), and drifts down the table (along -z). */
const SPEED = { min: 4, max: 6 };
const DRIFT = { min: 0.2, max: 0.8 };
/** How high over the playfield a grain flies (y), and where up the table it enters (z), each picked at random. */
const HEIGHT = { min: 0.1, max: 0.7 };
const ENTER_Z = { min: 0.5, max: TABLE.length - 0.3 };
/** The sand's colour, how solid a grain is at most, and how far in from each edge it fades in and out (units). */
const COLOR = 0xe2c08a;
const ALPHA = 0.85;
const EDGE_FADE = 0.6;
/** How far across a grain is, in the table's units: as the sparks are. */
const SIZE = 0.14;
/** The table's edges are this far either side of its middle (x). */
const HALF = TABLE.width / 2;
/** Where a grain is parked once it has crossed: far under the playfield, where nothing is drawn. */
const PARKED = -1000;

/**
 * The haze's amount (0 to HAZE.most) at table time `now`, for a storm the stage first saw at `seenAt` that blows until
 * `until`: easing in over HAZE.ease from `seenAt`, held, and easing out over HAZE.ease to nothing at `until`. A storm
 * seen at -Infinity (a page opened in its middle) is eased in already. No storm (either time null) is no haze.
 */
export function hazeAt(seenAt: number | null, until: number | null, now: number): number {
  if (seenAt === null || until === null || !(now > seenAt) || !(now < until)) return 0;
  return HAZE.most * Math.min(1, (now - seenAt) / HAZE.ease, (until - now) / HAZE.ease);
}

/**
 * The haze as drawn, moved from `was` toward `goal` (hazeAt's) by the table clock's `step`, never faster than the ease
 * (HAZE.most in HAZE.ease). hazeAt alone jumps where a second storm moves the end on during the ease out; this keeps
 * the picture to the ease all the same. A step of 0, or one that isn't a number, holds it where it was.
 */
export function easeHaze(was: number, goal: number, step: number): number {
  if (!(step > 0)) return was;
  const most = (HAZE.most / HAZE.ease) * step;
  return Math.abs(goal - was) <= most ? goal : was + Math.sign(goal - was) * most;
}

/**
 * The sand: grains that enter from the windward edge at RATE a second while the wind blows (blow), cross the table with
 * it and leave by the far edge, moved on by the table's clock (update). With no wind none enter, and those in flight
 * finish crossing.
 */
export class Sand {
  /** Every grain of the pool as a point, in the table's coordinates. */
  readonly points: THREE.Points;
  private readonly position: THREE.BufferAttribute;
  /** Each grain's colour and, in the fourth place, how solid it is: 0 once it is out. */
  private readonly color: THREE.BufferAttribute;
  /** Each grain's velocity across (x) and down the table (z), and whether it is blowing, by its place in the pool. */
  private readonly vx = new Float64Array(MAX_GRAINS);
  private readonly vz = new Float64Array(MAX_GRAINS);
  private readonly blowing = new Uint8Array(MAX_GRAINS);
  /** The wind's direction along x last given (0: calm), and how many grains are owed, a fraction of one over. */
  private dir: 1 | -1 | 0 = 0;
  private owed = 0;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(MAX_GRAINS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(new Float32Array(MAX_GRAINS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.color);
    // Sand is grains, not light: drawn over the table as it is, where the sparks are added to it.
    const material = new THREE.PointsMaterial({ size: SIZE, map: dotMap(), vertexColors: true, transparent: true, depthWrite: false });
    this.points = new THREE.Points(geometry, material);
    // The grains blow anywhere over the table, and three.js works the pool's bounding sphere out once, from the points
    // as they are at the start: all parked.
    this.points.frustumCulled = false;
    sizeInWorld(this.points, material, SIZE);
    // Every grain the same sand colour: only how solid it is changes.
    const rgb = new THREE.Color(COLOR);
    const col = this.color.array as Float32Array;
    for (let i = 0; i < MAX_GRAINS; i++) {
      col[4 * i] = rgb.r;
      col[4 * i + 1] = rgb.g;
      col[4 * i + 2] = rgb.b;
    }
    this.clear();
  }

  /**
   * The wind each frame, from the state: toward +x (1), toward -x (-1), or calm (0). `_now` is the table's clock as
   * drawn, as the stage's other effects are given it; the grains move by update's step alone, so it isn't needed here.
   */
  blow(dir: 1 | -1 | 0, _now: number): void {
    this.dir = dir;
    if (dir === 0) this.owed = 0;
  }

  /**
   * Moves the sand on by `step`, the table's time since the last update: while the wind blows the grains owed enter
   * first, at the windward edge, so that a place a grain leaves in this step is taken no sooner than the next (a grain
   * is never seen to jump back across); then every grain blows on with the wind and down the table, fading in from the
   * edge it came in by and out toward the one it leaves by, and is parked out of sight once past it. A step of 0
   * moves nothing.
   */
  update(step: number): void {
    if (!(step > 0)) return;
    if (this.dir !== 0) {
      this.owed += RATE * step;
      for (; this.owed >= 1; this.owed -= 1) this.enter(this.dir);
    }
    const pos = this.position.array as Float32Array;
    const col = this.color.array as Float32Array;
    let moved = false;
    for (let i = 0; i < MAX_GRAINS; i++) {
      if (!this.blowing[i]) continue;
      moved = true;
      const x = pos[3 * i] + this.vx[i] * step;
      const z = pos[3 * i + 2] + this.vz[i] * step;
      // How far it is from the edge it leaves by, and from the one it came in by.
      const ahead = this.vx[i] > 0 ? HALF - x : x + HALF;
      if (ahead <= 0 || z < 0) {
        this.park(i);
        continue;
      }
      pos[3 * i] = x;
      pos[3 * i + 2] = z;
      col[4 * i + 3] = ALPHA * Math.min(1, ahead / EDGE_FADE, (2 * HALF - ahead) / EDGE_FADE);
    }
    if (moved) this.changed();
  }

  /** How many grains are blowing. */
  live(): number {
    let n = 0;
    for (let i = 0; i < MAX_GRAINS; i++) n += this.blowing[i];
    return n;
  }

  /** Lets every grain go, and the grains owed. */
  clear(): void {
    this.owed = 0;
    for (let i = 0; i < MAX_GRAINS; i++) this.park(i);
    this.changed();
  }

  /** A grain enters at the windward edge, blowing toward `dir`, in the first place free: with none, none enters. */
  private enter(dir: 1 | -1): void {
    const i = this.blowing.indexOf(0);
    if (i < 0) return;
    const pos = this.position.array as Float32Array;
    pos[3 * i] = -dir * HALF;
    pos[3 * i + 1] = HEIGHT.min + (HEIGHT.max - HEIGHT.min) * Math.random();
    pos[3 * i + 2] = ENTER_Z.min + (ENTER_Z.max - ENTER_Z.min) * Math.random();
    this.vx[i] = dir * (SPEED.min + (SPEED.max - SPEED.min) * Math.random());
    this.vz[i] = -(DRIFT.min + (DRIFT.max - DRIFT.min) * Math.random());
    this.blowing[i] = 1;
  }

  /** Puts grain `i` out of sight: clear, and far under the playfield. */
  private park(i: number): void {
    const pos = this.position.array as Float32Array;
    pos[3 * i] = 0;
    pos[3 * i + 1] = PARKED;
    pos[3 * i + 2] = 0;
    (this.color.array as Float32Array)[4 * i + 3] = 0;
    this.blowing[i] = 0;
  }

  /** The buffers are to be sent to the graphics card again. */
  private changed(): void {
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
  }
}
