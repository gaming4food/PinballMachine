// The quest's sparks, and the open tomb's beam, which sends its motes up among them. Everything is in the table's own
// coordinates (x across, y up off the playfield, z up the table), as table-mesh.ts. All the sparks are one pool of
// MAX_SPARKS points made at the start, so a busy moment can't slow the stage: a burst past the pool takes the oldest
// spark again, and a spark that has run its life is parked out of sight. Nothing is made after the constructor. They
// run on the table's clock, the `step` that update() is given, so they stand still while the table does.
import * as THREE from 'three';
import type { Table } from '../shared/table';
import { doorway } from './table-mesh';

/** The most sparks alight at once; a burst past it takes the oldest again. */
export const MAX_SPARKS = 400;

/** How long a spark lives (s) and how fast it is thrown (units a second): each between these, picked at random. */
const LIFE = { min: 0.45, max: 0.8 };
const SPEED = { min: 2.5, max: 5 };
/** How steeply it is thrown, in degrees above the playfield: always up, and always some way out. */
const ELEVATION = { min: 25, max: 80 };
/** How hard a spark falls (units a second, a second squared), and how much it is slowed (of its speed, a second). */
const GRAVITY = 9;
const DRAG = 1.5;
/** The lowest a spark goes (y): just over the playfield. */
const FLOOR = 0.05;
/** How far across a spark is, in the table's units. */
const SIZE = 0.14;
/** How long a mote lives (s): the beam's sparks, which drift up and never fall. */
const MOTE_LIFE = 1.6;
/** Where a spark is parked once it is out: far under the playfield, where nothing is drawn. */
const PARKED = -1000;

/**
 * A round dot, white, with a bright core fading to nothing at its edge: the sparks' map (and the sand's, sand.ts). The
 * core is flat to a fifth of the way out, so a spark reads as a bright point where a falloff from the middle alone left
 * it a faint smudge.
 */
export function dotMap(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.min(1, Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2));
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * (1 - THREE.MathUtils.smoothstep(r, 0.2, 1)));
    }
  }
  const map = new THREE.DataTexture(data, n, n);
  // Smooth when drawn larger or smaller than it is (a DataTexture is nearest-filtered unless told).
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

/**
 * Sizes `points` (drawn with `material`) `size` across in the world, wherever the stage draws them. three sizes a point
 * in pixels from the renderer's own size (not the target it draws into) and the screen's height alone (not the camera's
 * lens), so a size of 0.14 is neither 0.14 across nor the same at every quality: the stage draws into a target 3 times
 * its size (supersampling) through a 32° lens, which would leave a spark about a pixel. So the size is set before each
 * draw, from the target and the lens. (For a perspective camera, as the stage's is.) The renderer's size is read into
 * one vector made here, so nothing is made per frame.
 */
export function sizeInWorld(points: THREE.Points, material: THREE.PointsMaterial, size: number): void {
  const view = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getSize(view);
    const ratio = renderer.getPixelRatio();
    const drawn = renderer.getRenderTarget()?.height ?? view.y * ratio;
    material.size = (size * camera.projectionMatrix.elements[5] * drawn) / (view.y * ratio);
  };
}

/**
 * The pool of sparks, thrown in bursts or sent drifting up as motes, and moved on by the table's clock. They are drawn
 * additively, so a spark fades by dimming, and one that is out is parked and dark.
 */
export class Sparks {
  /** Every spark of the pool as a point, in the table's coordinates. */
  readonly points: THREE.Points;
  private readonly position: THREE.BufferAttribute;
  /** Each spark's colour and, in the fourth place, its light: 1 as it is thrown, fading to 0 at the end of its life. */
  private readonly color: THREE.BufferAttribute;
  /** What each spark is doing, by its place in the pool: its age and life (s), its velocity, and if it is a mote. */
  private readonly age = new Float64Array(MAX_SPARKS);
  private readonly life = new Float64Array(MAX_SPARKS);
  private readonly velocity = new Float64Array(MAX_SPARKS * 3);
  private readonly drifts = new Uint8Array(MAX_SPARKS);
  /** A colour to read a hex into: made once, used at every call. */
  private readonly rgb = new THREE.Color();

  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.color);
    const material = new THREE.PointsMaterial({
      size: SIZE,
      map: dotMap(),
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    // The sparks fly anywhere over the table, and three.js works the pool's bounding sphere out once, from the points
    // as they are at the start: all parked.
    this.points.frustumCulled = false;
    sizeInWorld(this.points, material, SIZE);
    this.clear();
  }

  /**
   * `count` sparks thrown from (x, y, z) in `color` (0xRRGGBB), up and out: each at its own speed, its own way round
   * and its own life. Past MAX_SPARKS alight, the oldest are taken again.
   */
  burst(x: number, y: number, z: number, color: number, count: number): void {
    // More than the pool would only take the burst's own sparks again.
    const n = Math.min(MAX_SPARKS, Math.round(count));
    for (let k = 0; k < n; k++) {
      const i = this.take();
      this.light(i, x, y, z, color, LIFE.min + (LIFE.max - LIFE.min) * Math.random());
      const around = Math.random() * Math.PI * 2;
      const up = THREE.MathUtils.degToRad(ELEVATION.min + (ELEVATION.max - ELEVATION.min) * Math.random());
      const speed = SPEED.min + (SPEED.max - SPEED.min) * Math.random();
      this.velocity[3 * i] = speed * Math.cos(up) * Math.cos(around);
      this.velocity[3 * i + 1] = speed * Math.sin(up);
      this.velocity[3 * i + 2] = speed * Math.cos(up) * Math.sin(around);
    }
    if (n > 0) this.changed();
  }

  /** A mote at (x, y, z) in `color`: it drifts straight up at `rise` units a second, never falls, lives MOTE_LIFE. */
  mote(x: number, y: number, z: number, color: number, rise: number): void {
    const i = this.take();
    this.light(i, x, y, z, color, MOTE_LIFE);
    this.velocity[3 * i + 1] = Math.max(0, rise);
    this.drifts[i] = 1;
    this.changed();
  }

  /**
   * Moves every spark on by `step`, the table's time since the last update: it is slowed, falls, flies on and fades,
   * stays over the playfield, and is parked out of sight at the end of its life. A step of 0 moves nothing.
   */
  update(step: number): void {
    if (!(step > 0)) return;
    const pos = this.position.array as Float32Array;
    const col = this.color.array as Float32Array;
    const vel = this.velocity;
    // The slowing over this step in one go, so it is the same however the time is cut up.
    const slow = Math.exp(-DRAG * step);
    let moved = false;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.age[i] >= this.life[i]) continue;
      moved = true;
      this.age[i] += step;
      if (this.age[i] >= this.life[i]) {
        this.park(i);
        continue;
      }
      const v = 3 * i;
      if (!this.drifts[i]) {
        vel[v] *= slow;
        vel[v + 1] = vel[v + 1] * slow - GRAVITY * step;
        vel[v + 2] *= slow;
      }
      pos[v] += vel[v] * step;
      pos[v + 1] += vel[v + 1] * step;
      pos[v + 2] += vel[v + 2] * step;
      // It lands on the playfield and stays there, sliding on and slowing, until its light is out.
      if (pos[v + 1] < FLOOR) {
        pos[v + 1] = FLOOR;
        vel[v + 1] = 0;
      }
      col[4 * i + 3] = 1 - this.age[i] / this.life[i];
    }
    if (moved) this.changed();
  }

  /** How many sparks are alight. */
  live(): number {
    let n = 0;
    for (let i = 0; i < MAX_SPARKS; i++) if (this.age[i] < this.life[i]) n++;
    return n;
  }

  /** Lets every spark go. */
  clear(): void {
    this.age.fill(0);
    this.life.fill(0);
    for (let i = 0; i < MAX_SPARKS; i++) this.park(i);
    this.changed();
  }

  /** The place for a new spark: one that is out if there is one, and when every spark is alight, the oldest. */
  private take(): number {
    let oldest = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.age[i] >= this.life[i]) return i;
      if (this.age[i] > this.age[oldest]) oldest = i;
    }
    return oldest;
  }

  /** Lights place `i` at (x, y, z) in `color` for `life` seconds, at rest and just over the playfield at the lowest. */
  private light(i: number, x: number, y: number, z: number, color: number, life: number): void {
    const pos = this.position.array as Float32Array;
    const col = this.color.array as Float32Array;
    pos[3 * i] = x;
    pos[3 * i + 1] = Math.max(FLOOR, y);
    pos[3 * i + 2] = z;
    this.rgb.setHex(color);
    col[4 * i] = this.rgb.r;
    col[4 * i + 1] = this.rgb.g;
    col[4 * i + 2] = this.rgb.b;
    col[4 * i + 3] = 1;
    this.age[i] = 0;
    this.life[i] = life;
    this.velocity.fill(0, 3 * i, 3 * i + 3);
    this.drifts[i] = 0;
  }

  /** Puts spark `i` out of sight: dark, and far under the playfield. */
  private park(i: number): void {
    const pos = this.position.array as Float32Array;
    pos[3 * i] = 0;
    pos[3 * i + 1] = PARKED;
    pos[3 * i + 2] = 0;
    (this.color.array as Float32Array)[4 * i + 3] = 0;
  }

  /** The buffers are to be sent to the graphics card again. */
  private changed(): void {
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
  }
}

/**
 * The beam's shaft at its brightest: its colour and opacity, how tall it is, and how far in front of the doorway's face
 * it stands.
 */
const BEAM = { color: 0xffe8b0, opacity: 0.55, height: 2.2, out: 0.06 };
/** How long the beam takes to fade in or out (s). */
const BEAM_FADE = 0.4;
/** The motes the open beam sends up: how many a second, how fast each rises (units a second), and from how high. */
const MOTES = { rate: 16, rise: 0.9, y: 0.1 };

/** `now` moved toward `goal` by `step` at most (so it ends on the goal, never past it). */
const toward = (now: number, goal: number, step: number) => (Math.abs(goal - now) <= step ? goal : now + Math.sign(goal - now) * step);

/**
 * The shaft's light: brightest at its foot and fading out toward its top, and soft at both sides, so that it reads as
 * light and not as a lit panel (made in code, as the sparks' map is).
 */
function shaftMap(): THREE.DataTexture {
  const w = 16;
  const h = 64;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min((x + 0.5) / w, 1 - (x + 0.5) / w) / 0.3;
      const side = THREE.MathUtils.smoothstep(edge, 0, 1);
      // Row 0 is the shaft's foot: a texture's first row is its bottom. A gentle fall, so the shaft is still there high
      // up.
      const fall = (1 - (y + 0.5) / h) ** 0.8;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * side * fall);
    }
  }
  const map = new THREE.DataTexture(data, w, h);
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

/**
 * The light that comes out of the tomb while it is open: a shaft of light as wide as the doorway, standing on the
 * doorstep just in front of the door's face (the picture's unseen lintel and pillars reach in front of it a little, and
 * would hide a shaft that stood in them), and a stream of motes sent up among its light. It fades in and out over
 * BEAM_FADE with the tomb's bit. Its group is empty on a table with no tomb. The caller steps the sparks as well as the
 * beam: the motes are the sparks'.
 */
export class TombBeam {
  /** The shaft, once made. */
  readonly group = new THREE.Group();
  private readonly way: ReturnType<typeof doorway>;
  private readonly shaft: THREE.Mesh | null = null;
  /**
   * Whether the tomb is open, how lit the beam is (0 shut, 1 open), and whether the next set is the first (or the first
   * after a reset).
   */
  private open = false;
  private lit = 0;
  private fresh = true;
  /** How many motes are owed, a fraction of one over: they come at MOTES.rate a second whatever the steps. */
  private owed = 0;

  constructor(
    table: Table,
    private readonly sparks: Sparks,
  ) {
    this.way = doorway(table);
    if (!this.way) return;
    const { x0, x1, front } = this.way;
    const geometry = new THREE.PlaneGeometry(x1 - x0, BEAM.height);
    // Standing on the doorstep: the shaft's foot at the playfield.
    geometry.translate(0, BEAM.height / 2, 0);
    const material = new THREE.MeshBasicMaterial({
      color: BEAM.color,
      map: shaftMap(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0,
    });
    // A flat shaft needs no back faces drawn before its front ones, which a transparent two-sided material is drawn
    // with by default (and sets itself up again for every frame).
    material.forceSinglePass = true;
    this.shaft = new THREE.Mesh(geometry, material);
    this.shaft.position.set((x0 + x1) / 2, 0, front - BEAM.out);
    this.shaft.visible = false;
    this.group.add(this.shaft);
  }

  /**
   * The tomb's bit: open, or shut. The first call, and the first after reset(), shows the beam as it is, lit or dark at
   * once (a page opening on an open tomb); after that it fades to the bit over BEAM_FADE as the table runs.
   */
  set(open: boolean): void {
    // No tomb, no beam: it stays dark whatever the bit says.
    if (!this.way) return;
    this.open = open;
    if (!this.fresh) return;
    this.fresh = false;
    this.lit = open ? 1 : 0;
    this.show();
  }

  /**
   * A fresh hello: the new connection's tomb may be open or shut whatever the beam shows now, so the next set() shows
   * it as it is, at once, as the table's toys are shown after one (TableParts.reset). Until then the beam stays as it
   * is, as the tomb's door does.
   */
  reset(): void {
    this.fresh = true;
  }

  /** The table's clock moves on by `step`: the beam fades toward the bit and, while it is open, sends motes up. */
  update(step: number): void {
    if (!this.way || !(step > 0)) return;
    this.lit = toward(this.lit, this.open ? 1 : 0, step / BEAM_FADE);
    this.show();
    if (!this.open) {
      this.owed = 0;
      return;
    }
    const { x0, x1, front } = this.way;
    this.owed += MOTES.rate * step;
    for (; this.owed >= 1; this.owed -= 1) {
      this.sparks.mote(x0 + (x1 - x0) * Math.random(), MOTES.y, front - BEAM.out, BEAM.color, MOTES.rise);
    }
  }

  /** How lit the beam is: 0 shut, up to 1 open. */
  get level(): number {
    return this.lit;
  }

  /** The shaft at its level: dark and not drawn at 0, BEAM.opacity at 1. */
  private show(): void {
    if (!this.shaft) return;
    this.shaft.visible = this.lit > 0;
    (this.shaft.material as THREE.MeshBasicMaterial).opacity = BEAM.opacity * this.lit;
  }
}
