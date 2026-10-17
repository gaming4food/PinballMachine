// The pinball table as data: what the physics (the server) and the stage (the picture) both read. The table in use is
// the pyramid table (pyramid.ts), designed and proven in a Blender spike.
//
// Units are scene units, 1 unit = 5.1 cm. The playfield is the plane y = 0; x runs across it (-5 left, +5 right) and z
// runs up the table (0 at the drain, 16.7 at the top). The shooter lane is the strip at the right, x from 4.2 to 5.
import { PYRAMID } from './pyramid';

/** The table's size and the ball's. The walls stand `wallTop` high; the glass is `glassY` over the playfield, clear of the ramps and the dish. */
export const TABLE = { width: 10, length: 16.7, tiltDeg: 6.5, ballRadius: 0.27, glassY: 2.4, wallTop: 0.7 } as const;

/** A wall: a polyline in (x, z) that the ball bounces off, with how lively the bounce is (0 dead, 1 perfect). */
export interface Wall {
  points: [number, number][];
  restitution: number;
  /** What the wall is, for the picture: the outer wall, the shooter lane's, a guide, the orbit's, the pyramid's, a lane's, a sling's back, an island's. */
  kind?: 'outer' | 'shooter' | 'guide' | 'orbit' | 'pyramid' | 'lane' | 'slingback' | 'island';
}

/** A pop bumper: a round post that kicks the ball away when it's hit. */
export interface Bumper {
  id: string;
  x: number;
  z: number;
  radius: number;
  kick: number;
  points: number;
  /** How far up off the playfield its base stands, for one on a dish (default 0). */
  y0?: number;
}

/** A slingshot: a rubber face from a to b, above a flipper, that kicks the ball back out. */
export interface Sling {
  id: string;
  a: [number, number];
  b: [number, number];
  kick: number;
  points: number;
}

/** A target: a drop target or a flip target, centered at (x, z) and `width` wide along its face. */
export interface Target {
  id: string;
  x: number;
  z: number;
  width: number;
  points: number;
  /** The way its face runs (degrees, x toward z), for one not along one of the table's walls. */
  angle?: number;
  /** A flip target: it stays up when hit and turns to its back, rather than dropping. */
  flip?: boolean;
}

/** A rollover lane at the top: it scores and lights when a ball rolls over it. */
export interface Rollover {
  id: string;
  x: number;
  z: number;
  points: number;
}

/** The spinner on a lane: it turns as the ball passes and scores for each turn. */
export interface Spinner {
  x: number;
  z: number;
  width: number;
  pointsPerTurn: number;
}

/** A spinner of its own, beside the table's first one (`Table.spinner`). */
export type ExtraSpinner = Spinner & { id: string };

/**
 * A saucer: a slow ball (under `maxSpeed`) that reaches it is held `hold` seconds, then kicked out along `eject` at
 * `speed`. With `alternate`, every other ball goes out mirrored (x the other way): a magnet flinging balls left and right.
 */
export interface Saucer {
  id: string;
  x: number;
  z: number;
  radius: number;
  hold: number;
  eject: [number, number];
  speed: number;
  maxSpeed: number;
  alternate?: boolean;
  points: number;
}

/**
 * A raised ramp: a trough along a centre line of [x, z, y] points (y the floor's height), `width` wide, with rails
 * `rail` high. A ramp low at its start is skirted down to the playfield both sides unless `skirt` is false; `flare` is
 * how much wider its mouth opens.
 */
export interface Ramp {
  id: string;
  path: [number, number, number][];
  width: number;
  rail: number;
  skirt?: boolean;
  flare?: number;
}

/** A raised round dish at (x, z), its floor `y` up and `r` across, with a rim `rail` high open over each arc of `gaps` (degrees). */
export interface Dish {
  id: string;
  x: number;
  z: number;
  y: number;
  r: number;
  rail: number;
  gaps: [number, number][];
}

/** A bank of flip targets: when all of them show their backs the bank matches, the game pays `bonus`, and they turn back. */
export interface Bank {
  id: string;
  targets: string[];
  bonus: number;
}

/** The lock: a saucer that holds a ball (for multiball). */
export interface Lock {
  x: number;
  z: number;
  radius: number;
}

/** The kickback: a kicker in the left outlane that, when lit, shoots a draining ball back up. */
export interface Kickback {
  side: 'left';
  x: number;
  z: number;
}

/**
 * The plunger: it sits in the shooter lane at x and fires a ball from zFrom up toward zTo at `speed`, in scene units per
 * second (the physics varies each launch by a few percent).
 */
export interface Plunger {
  x: number;
  zFrom: number;
  zTo: number;
  speed: number;
}

/**
 * A flipper. Angles are in degrees in the x-z plane, measured from the +x axis toward +z (counterclockwise with x to
 * the right and z up the table). So a left flipper rests at -30 (pointing right and down) and swings up to +30; the
 * right flipper is its mirror, resting at 210 (pointing left and down) and swinging up to 150.
 */
export interface Flipper {
  side: 'left' | 'right';
  pivot: [number, number];
  length: number;
  restDeg: number;
  upDeg: number;
}

/** A whole table. */
export interface Table {
  walls: Wall[];
  bumpers: Bumper[];
  slings: Sling[];
  targets: Target[];
  rollovers: Rollover[];
  spinner: Spinner;
  lock: Lock;
  kickback: Kickback;
  plunger: Plunger;
  /** A ball below this z has drained. */
  drainZ: number;
  flippers: Flipper[];
  ramps: Ramp[];
  dishes: Dish[];
  saucers: Saucer[];
  /** The spinners besides `spinner`. */
  spinners: ExtraSpinner[];
  banks: Bank[];
}

/** Where a flipper's tip is at a given angle (its rest angle by default), from its pivot and length. */
export function flipperTip(f: Flipper, deg: number = f.restDeg): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [f.pivot[0] + f.length * Math.cos(a), f.pivot[1] + f.length * Math.sin(a)];
}

/** The table in use: the pyramid table (pyramid.ts), which the server's physics and the stage both read. */
export const TABLE_IN_USE: Table = PYRAMID;
