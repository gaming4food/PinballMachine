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
  /**
   * What the wall is, for the picture (and, for the pyramid's, for wallsWithTomb): the outer wall, the shooter lane's,
   * a guide, the orbit's, the pyramid's, a lane's, a sling's back, an island's, or a jamb of the tomb's doorway
   * (wallsWithTomb makes those; `walls` has none).
   */
  kind?: 'outer' | 'shooter' | 'guide' | 'orbit' | 'pyramid' | 'lane' | 'slingback' | 'island' | 'tomb';
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

/** A target: a drop target, a flip target or a rising one, centered at (x, z) and `width` wide along its face. */
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
  /**
   * A rising target: it starts down (no wall, nothing to hit) and the game raises it, and puts it down again. Raised,
   * `'drop'` drops when hit, as a drop target does, and reports it (a pop-up); `'hold'` stays up when hit and reports
   * every hit (the mummy). Neither is one of the lock's drop targets (isLockTarget).
   */
  rise?: 'drop' | 'hold';
  /** How thick it is across its face, for the physics' wall and the picture (default 0.2). */
  depth?: number;
  /** How tall it is drawn (default 0.52). */
  height?: number;
}

/** One of the lock's drop targets (the scarab and the eye): no flip plaque, no rising target. Only these light it. */
export function isLockTarget(t: Target): boolean {
  return !t.flip && !t.rise;
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
  /**
   * A gap in one rail, for the diverter to send a ball out through: that side's rail is left out between path points
   * `from` and `to` ('right' is the ramp's right hand going along its path).
   */
  opening?: { side: 'left' | 'right'; from: number; to: number };
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

/**
 * The kickback: a kicker in an outlane that, when lit, shoots a draining ball back up. `side` is which outlane (the
 * pyramid table's is in the right one, x 3.72).
 */
export interface Kickback {
  side: 'left' | 'right';
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

/**
 * The tomb: a doorway cut into the pyramid's front corner, behind a door. Open, it catches a ball that touches its
 * mouth (the doorway is narrower than a ball, so the ball never goes in), holds it at `held`, just in front of the
 * mouth, for `hold` seconds, then kicks it out along `eject` at `speed`, and scores `points`. The doorway's mouth lies
 * along the line z = `z`, `width` across and centred on `x`: it runs between where the pyramid's two lower faces
 * cross that line (tombMouth; wallsWithTomb cuts the pyramid's wall there and adds the jambs that close the pocket
 * behind it).
 */
export interface Tomb {
  id: string;
  x: number;
  z: number;
  width: number;
  held: [number, number];
  hold: number;
  eject: [number, number];
  speed: number;
  points: number;
}

/**
 * The diverter: a gate on a ramp, `length` long and hinged at `pivot`, that swings between `restDeg`, its rest (along
 * the gap in the ramp's rail, the ramp's `opening`, in the rail's place), and `overDeg`, over (across the ramp, where
 * it turns a ball out through the gap). The angles are in degrees from the +x axis toward +z, as a flipper's.
 */
export interface Diverter {
  id: string;
  ramp: string;
  pivot: [number, number];
  length: number;
  restDeg: number;
  overDeg: number;
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
  /** The quest's tomb in the pyramid's front corner, if the table has one. Read the walls through wallsWithTomb. */
  tomb?: Tomb;
  /** The quest's diverter on one of the ramps, if the table has one. */
  diverter?: Diverter;
}

/**
 * A flipper's shape, the physics' (server/sim.ts: its collider and its bat) and the stage's (stage/pinball-parts.ts)
 * alike: round on its pivot (`baseRadius`) and at its tip (`tipRadius`, the tip's round ending at the flipper's
 * `length`), and `height` tall off the playfield. The Blender build's hero picture draws its flippers from it too
 * (tools/export-scene.ts writes it into blender/scene.json).
 */
export const FLIPPER_SHAPE = { baseRadius: 0.22, tipRadius: 0.1, height: 0.45 } as const;

/**
 * A flipper's outline in its own frame (+x from the pivot to the tip, y up off the playfield), at the playfield and at
 * its top: `n` points round each of its two rounds, for a convex hull (the physics' collider, the stage's flipper).
 */
export function flipperHull(length: number, n = 12): [number, number, number][] {
  const { baseRadius, tipRadius, height } = FLIPPER_SHAPE;
  const pts: [number, number, number][] = [];
  for (const y of [0, height]) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      pts.push([baseRadius * Math.cos(a), y, baseRadius * Math.sin(a)]);
      pts.push([length - tipRadius + tipRadius * Math.cos(a), y, tipRadius * Math.sin(a)]);
    }
  }
  return pts;
}

/** Where a flipper's tip is at a given angle (its rest angle by default), from its pivot and length. */
export function flipperTip(f: Flipper, deg: number = f.restDeg): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [f.pivot[0] + f.length * Math.cos(a), f.pivot[1] + f.length * Math.sin(a)];
}

/**
 * The tomb's mouth: its two ends, where the two faces that meet at the pyramid's front corner cross the line
 * z = tomb.z. The pyramid's wall is a closed outline that starts and ends at that corner, its lowest point: `a` is
 * where the face up to the outline's next corner crosses the line, and `b` where the face back from its last corner
 * does, so the outline cut open at the mouth runs from `a` round the other corners to `b` (on the pyramid table, `a`
 * is the mouth's right end and `b` its left). It reads the faces, never `tomb.width`; table-test holds the two to each
 * other. Null for a table with no tomb or no pyramid wall; it throws when the mouth's line can't cut the front corner
 * off the outline.
 */
export function tombMouth(t: Table): { a: [number, number]; b: [number, number] } | null {
  const { tomb } = t;
  const pyramid = tomb && t.walls.find((w) => w.kind === 'pyramid');
  if (!tomb || !pyramid) return null;
  const pts = pyramid.points;
  const n = pts.length;
  const front = pts[0];
  // The mouth's line has to cut the front corner off a closed outline: above the corner, below the two corners the
  // faces rise to.
  const closed = n >= 4 && pts[n - 1][0] === front[0] && pts[n - 1][1] === front[1];
  if (!closed || !(tomb.z > front[1] && tomb.z < Math.min(pts[1][1], pts[n - 2][1]))) {
    throw new Error(`the tomb's mouth (z ${tomb.z}) must cut the front corner off the pyramid's closed outline`);
  }
  /** Where the face from the front corner to `c` crosses the mouth's line. */
  const crossing = (c: [number, number]): [number, number] => [front[0] + ((tomb.z - front[1]) / (c[1] - front[1])) * (c[0] - front[0]), tomb.z];
  return { a: crossing(pts[1]), b: crossing(pts[n - 2]) };
}

/**
 * The table's walls as the physics and the picture build them: `t.walls`, and, when the table has a tomb, its pyramid
 * wall cut open at the front corner for the doorway, and the doorway's two jambs added (`kind: 'tomb'`). Everything
 * that builds solids from the walls takes them from here, not from `t.walls`, so the doorway is open to all alike.
 *
 * The wall becomes the open outline from the mouth's end `a` round the corners to its end `b` (tombMouth). From each
 * end a jamb runs straight up the table as far as the mouth is wide, then along that line to the tomb's x: the two
 * close a square pocket behind the mouth, so the pyramid's hollow inside stays closed. A ball never gets into the
 * pocket (the jambs' walls leave less than a ball between them, and the tomb catches a ball at its mouth): its depth
 * is only so the picture has a doorway to show. A table with no tomb, or no pyramid wall, keeps its walls as they are.
 */
export function wallsWithTomb(t: Table): Wall[] {
  const mouth = tombMouth(t);
  if (!mouth) return [...t.walls];
  const tomb = t.tomb!;
  const at = t.walls.findIndex((w) => w.kind === 'pyramid');
  const pyramid = t.walls[at];
  const outline: Wall = { ...pyramid, points: [mouth.a, ...pyramid.points.slice(1, -1), mouth.b] };
  const top = tomb.z + Math.abs(mouth.a[0] - mouth.b[0]);
  const jambs = [mouth.a, mouth.b].map((end): Wall => ({ kind: 'tomb', restitution: pyramid.restitution, points: [end, [end[0], top], [tomb.x, top]] }));
  return [...t.walls.slice(0, at), outline, ...jambs, ...t.walls.slice(at + 1)];
}

/** The table in use: the pyramid table (pyramid.ts), which the server's physics and the stage both read. */
export const TABLE_IN_USE: Table = PYRAMID;
