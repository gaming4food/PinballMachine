// The pinball table's physics, on the server (as the claw's is: the server is the one source of truth, and the stages
// only draw the snapshots it sends). The playfield, the walls, the glass, the bumpers, the slings, the targets, the
// raised ramps and the dish are fixed colliders; the balls are dynamic spheres with CCD; the flippers are kinematic
// bodies swung toward up or rest. Bumpers and slings kick a ball away and report it; drop targets drop, and flip targets
// turn to their backs (a bank of them all turned reports a match); a rising target (a pop-up or the mummy) stands down,
// no wall at all, until the game raises it, and then a pop-up drops when hit and the mummy stays up and reports every
// hit; the rollovers, the spinners, the lock, the kickback and the switches with no art (one across each orbit lane,
// one at the left ramp's top and one beside the gate's gap, each reporting a ball once a pass) are sensors that report,
// and the lock, while it holds a ball, kicks back out any other that reaches it; a saucer holds a slow ball a moment
// and kicks it out; the tomb's door, in the doorway cut into the pyramid's front corner, is a wall until the game opens
// it, and then the doorway's mouth catches any ball that touches it, holds it a moment and kicks it out; the diverter's
// gate, a kinematic body as the flippers are, stands in a gap in the left ramp's rail until the game swings it over,
// slowly, across the ramp (once no ball is on the ramp or in the dish above it), where it turns balls going up the ramp
// out through the gap, down into the lock; a ball past the drain is taken off and reported. What the hits are worth,
// whose balls they are and what's lit is the game's (game.ts): this is only the physics. (The ramps, the dish, the flip
// targets, the saucers and the second spinner were built and proven in the Blender spike,
// spike/blender/sim-features.mts.)
//
// The table is in scene units (table.ts): x across, z up the table, y up off the playfield (the plane y = 0).
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { DT } from '@kit/server';
import { SNAP_STRIDE, type BodyState } from '@kit/shared';
import { DIVERTER_SPEED, SNAP_PINBALL_HEADER, SNAP_TYPE_PINBALL, TOY } from '../shared/pinball';
import { FLIPPER_SHAPE, flipperHull, isLockTarget, TABLE, tombMouth, wallsWithTomb, type Diverter, type Dish, type Flipper, type Ramp, type Table, type Target, type Tomb, type Wall } from '../shared/table';

// Passed on for the game and the tests, which import it from here; it's every machine's (@kit/server).
export { DT } from '@kit/server';

/** Gravity in scene units per second squared: 9.81 m/s² at 5.1 cm a unit. It pulls down the tilted table. */
export const GRAVITY = 192;
/** Rapier steps per DT: a ball at 60 units/s moves 0.25 a step, less than its radius, so it can't skip a wall. */
export const SUBSTEPS = 4;
const H = DT / SUBSTEPS;

/** Half a wall's thickness (walls are boxes along each segment, rounded at the joints, from the playfield up to
 * TABLE.wallTop: well over the ball, and under the ramps, the dish and the wireform, which pass over them). The tomb's
 * door and the diverter's gate are as thick; the tests measure their reach with it. */
export const WALL_HALF = 0.08;
/** Half a sling's thickness. */
const SLING_HALF = 0.08;
/** How thick a target is across its face when its table says nothing (Target.depth). */
const TARGET_DEPTH = 0.2;
/** Thick blocks outside the outer wall (and over the top), so nothing gets off the table even past a wall. */
const BACKSTOP = 1.5;

/** The playfield: dead (the ball doesn't bounce on it) and a little grippy, so a ball rolls rather than slides. */
const PLAYFIELD = { friction: 0.2, restitution: 0 };
/** The glass: slippery and dead, so a ball that hops into it comes straight back down. */
const GLASS = { friction: 0, restitution: 0.1 };
/** The walls' grip; how lively each bounces is the table's (Wall.restitution). */
const WALL_FRICTION = 0.1;
/** A pop bumper's own bounce, before its kick. */
const BUMPER_RESTITUTION = 0.5;
/** A sling's rubber, before its kick. */
const SLING_RESTITUTION = 0.6;
/** A drop target's face. */
const TARGET_RESTITUTION = 0.3;
/**
 * The flippers' rubber: grippy, so a cradled ball sits and a flipped one is carried and thrown. The restitution is the
 * bounce a swinging flipper gives a ball on it (bat). Measured 2026-10-17, 100 seeded flips with the ball between the
 * left flipper's middle and its tip, the share reaching the upper table (z > 12): 0.2 52%, 0.25 80%, 0.3 91%, 0.35 86%,
 * 0.4 86%, 0.45 75%, 0.5 30%. The misses come in bands of where the ball was, as the shot's line crosses bumper-3 or
 * the orbit rail's end; 0.3 is the best, away from the bad bands either side. The friction barely matters (0.3 to 0.9).
 */
const FLIPPER = { friction: 0.6, restitution: 0.3 };
/**
 * The ball's own friction and bounce: high, combined by the lower (Min), so each surface's own values above are what a
 * contact gets. Ball on ball is lively and grippy.
 */
const BALL = { friction: 0.8, restitution: 0.9, density: 1 };
/** The fastest a ball goes (units/s): what a flipper can throw it, and what the escape test fires at. */
const MAX_SPEED = 60;

/** How fast a flipper swings, degrees per second. */
const FLIPPER_SPEED = 1800;
/**
 * A flipper's shape (shared/table.ts's FLIPPER_SHAPE, which the stage draws too): round on its pivot and at its tip, the
 * tip's round ending at its `length`.
 */
const { baseRadius: FLIPPER_BASE_R, tipRadius: FLIPPER_TIP_R } = FLIPPER_SHAPE;
/** A ball this near a swinging flipper's face is batted by it (bat). */
const BAT_TOUCH = 0.03;

/**
 * A bumper or a sling kicks the same ball again, and a flip plaque or the mummy scores it again, only after this long
 * (s), so a ball touching twice gets one kick (or one score).
 */
const KICK_COOLDOWN = 0.1;
/** The rollovers' and the kickback's sensors' radius. */
const ROLLOVER_R = 0.3;
const KICKBACK_R = 0.6;
/** How fast the kickback fires a ball back up (units/s, up the table). */
const KICKBACK_SPEED = 30;
/** How fast a ball let go from the lock leaves it (units/s), and which way: down and in, toward the flippers. */
const LOCK_EJECT = { speed: 8, dir: [0.6, -0.8] as const };
/**
 * The lock full: a ball that reaches it while it holds another is kicked back out, as a saucer kicks. It is put beside
 * the held ball (its middle a ball's width and LOCK_KICK_CLEAR out from the held ball's, along `dir`) and sent along
 * `dir` at `speed` (units/s, the lock's own release speed), down the lane by the left ramp toward the left flipper.
 * Left there instead, 7 of the 27 of the layout test's left-ramp shots that the gate over sends into the lock came to
 * rest against the held ball. Measured 2026-10-19 with a ball held and the flippers at rest, those 27 are each kicked
 * once and come within a flipper's reach a median 1.35 s later, none caught by the Scarab saucer and none left on the
 * table, and so do the 30 of 120 balls dropped round the lock and the 26 of 40 rolled up the lane that reach it; in
 * the stress run's 3,250 runs with a ball held and random flips, none got off the table and none came to rest against
 * the held ball. Kicked anywhere from -75 to -120 degrees (straight down the table is -90) at 4 to 13 units/s, those
 * shots and drops get away as well, since gravity takes a ball from below the held one whatever the kick: the speed
 * sets only how soon it reaches a flipper (1.2 s at 12, 1.5 at 4). At -82.5 every kicked ball went into the Scarab
 * saucer and back up to the bumpers; kicked up the table or to the left, none got away; and along the release's own
 * way, (0.6, -0.8), the ball would be put into bumper-1. At -97.5 it is put 0.25 clear of bumper-1 and 0.33 of the
 * ramp's side. (Exported for the tests, which follow the kick.)
 */
export const LOCK_KICK = { speed: 8, dir: [-0.13, -0.99] as [number, number] };
/** How far apart the held ball and the one the full lock kicks out are put, surface to surface. */
const LOCK_KICK_CLEAR = 0.02;
/**
 * After it's let go, a ball doesn't set the lock off again for this long (s); and one kicked out of a saucer or the
 * tomb isn't caught again that soon. (Exported for the tests, which time the tomb's ignore by it.)
 */
export const LOCK_IGNORE = 0.75;
/** The tomb's door won't shut while a ball's surface is within this of where the door's face would be (closeTomb). */
const TOMB_CLEAR = 0.05;
/** The gate won't swing while a ball's surface is within this of anywhere it sweeps through (setDiverter). */
const GATE_CLEAR = 0.05;
/** A matched bank shows all its backs this long (s) before its plaques turn back to the front. */
const BANK_SHOW = 1.0;
/** An extra spinner's sensor is this tall (half of it each side of its middle), only as tall as a ball: so a ball on a
 * ramp over one doesn't turn it. */
const SPINNER2_HALF_Y = 0.3;
/**
 * A switch's sensor stands this tall up from its floor (half of it each side of its middle), only as tall as a ball,
 * as the extra spinner's does: so a ball on the right ramp over the right orbit lane's switch passes over it, and one
 * on the playfield beside the left ramp passes under the gate's. It is this thick (half each side of its line): a ball
 * at the fastest the table lets one go moves 0.25 a substep, less than a ball, so none passes one unseen.
 */
const SWITCH_HALF_Y = 0.3;
const SWITCH_HALF_DEPTH = 0.05;
/**
 * A switch reports a ball once a pass: after it reports one it ignores that ball for this long (s), so a ball that
 * rattles across it in its lane, or stalls on it and rolls back, is one pass.
 */
const SWITCH_IGNORE = 0.5;
/** A ramp's rails are slick, so a ball glancing along one keeps its speed. */
const RAIL = { friction: 0, restitution: 0.2 };
/** How much a nudge shoves each ball: up the table, and a random bit sideways (units/s). */
const NUDGE = { up: 4, side: 2 };
/** The plunger's launch varies by up to this share of its speed, so no two launches go quite the same. */
const LAUNCH_SPREAD = 0.04;
/** The spinner turns this many radians per unit of the ball's speed through it, and slows by this much a second. */
const SPINNER_SPIN = 1.2;
const SPINNER_DRAG = 6;
/** How near a flipper's sweep a ball counts as near it (nearFlipper): this far past its length, these degrees past its swing. */
const NEAR = { reach: 0.3, deg: 15 };
/** The one-way gate at the top of the shooter lane, across the gap between the lane's inner wall and the arch: its bounce. */
const GATE_RESTITUTION = 0.2;

export interface Hit {
  /** What the ball touched. A `switch` is touched by a ball passing it either way: its velocity says which way. */
  kind: 'bumper' | 'sling' | 'target' | 'rollover' | 'spinner' | 'lock' | 'drain' | 'kickback' | 'saucer' | 'bank' | 'tomb' | 'switch';
  id: string;
  ball: number;
}

export interface Ball {
  id: number;
  /** The viewer whose ball it is, or null for a house ball. */
  owner: number | null;
  body: RAPIER.RigidBody;
}

/** A ball's silver, for its body state. */
const BALL_COLOR = 0xc8ccd4;

type Part =
  | { kind: 'bumper'; id: string; x: number; z: number; kick: number }
  | { kind: 'sling'; id: string; nx: number; nz: number; a: [number, number]; kick: number }
  | { kind: 'target'; id: string; index: number }
  | { kind: 'rollover'; id: string }
  | { kind: 'spinner' }
  | { kind: 'lock' }
  | { kind: 'saucer'; index: number }
  | { kind: 'spinner2'; index: number }
  | { kind: 'kickback' }
  | { kind: 'gate' }
  | { kind: 'tomb' }
  | { kind: 'switch'; id: string };

interface FlipperState {
  f: Flipper;
  body: RAPIER.RigidBody;
  angle: number;
  up: boolean;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
/** The turn about +y that takes +x to (cos a, 0, sin a) for a in degrees (the table's angles, x toward z). */
function turnTo(deg: number): RAPIER.Rotation {
  const h = -rad(deg) / 2;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}

export class PinballSim {
  private readonly world: RAPIER.World;
  readonly items = new Map<number, Ball>();
  private _tick = 0;
  private readonly events = new RAPIER.EventQueue(true);
  private readonly parts = new Map<number, Part>();
  private readonly ballByCollider = new Map<number, Ball>();
  private readonly flippers: FlipperState[] = [];
  /**
   * Each target: a drop target (the lock's, or a pop-up) is `down` with its collider off; a flip target stays up,
   * `turned` to its back; a rising target is `down` until the game raises it.
   */
  private readonly targets: { collider: RAPIER.Collider; down: boolean; turned: boolean; a: [number, number]; b: [number, number] }[] = [];
  /** Matched banks, and when their plaques turn back to the front. */
  private readonly bankResets = new Map<string, number>();
  private readonly lastKick = new Map<string, number>();
  private readonly lockIgnoreUntil = new Map<number, number>();
  /**
   * The switches (table.switches): each a box centred `y` up, `half` its width either way along (ux, uz), the way it
   * runs. They are sensors looked at by hand each substep (passSwitches), not Rapier's: with four more colliders in
   * Rapier's world, the same shots came out differently once balls had been taken off and put on (one world used for
   * shot after shot, as the tests and the game use it: of 300 random shots, the 28th first differed at its 22nd step,
   * nowhere near a switch), so every measured rate of the table would have moved with no part of it moved. By hand,
   * the physics is the same, step for step, with them or without.
   */
  private readonly switchBoxes: { id: string; x: number; y: number; z: number; ux: number; uz: number; half: number }[] = [];
  /** The balls in each switch's box as the last substep ended (keyed `switch:ball`): a ball touches one coming in. */
  private readonly inSwitch = new Set<string>();
  /** Until when each switch ignores each ball it has just reported (keyed `switch:ball`): one pass, one hit. */
  private readonly switchIgnoreUntil = new Map<string, number>();
  /** The lock's sensor, which the full lock asks which balls are in it (kickFromFullLock). */
  private lockSensor!: RAPIER.Collider;
  /** Every ball held still: the lock's, the saucers' (those also in saucerHold) and the tomb's (tombHold's). */
  private readonly held = new Set<number>();
  /** The extra spinners' turns (table.spinners, in order). */
  private readonly spin2: { angle: number; speed: number; ball: number }[] = [];
  /** The balls a saucer holds: which saucer, and when it kicks the ball out. */
  private readonly saucerHold = new Map<number, { index: number; until: number }>();
  /**
   * Balls just kicked out of a saucer or the tomb, and until when the saucers ignore them: so a kicked ball gets away,
   * and the tomb's, kicked down the centre lane, goes past the magnet just below it, which would hold a ball that slow.
   */
  private readonly saucerIgnore = new Map<number, number>();
  /**
   * The tomb, on a table with one: its door, a wall across the doorway's mouth (`a` to `b`, tombMouth) while it's shut,
   * and its catch, a sensor in the same place, on while it's open. It starts shut.
   */
  private tomb: { spec: Tomb; a: [number, number]; b: [number, number]; door: RAPIER.Collider; catcher: RAPIER.Collider; open: boolean } | null = null;
  /** The ball the tomb holds, and when it kicks it out: one at a time, as a held ball fills the mouth. */
  private tombHold: { id: number; until: number } | null = null;
  /** Balls just kicked out of the tomb, and until when it ignores them. */
  private readonly tombIgnore = new Map<number, number>();
  /**
   * The diverter, on a table with one: its gate, a kinematic box hinged at its pivot and standing on its ramp's floor
   * (`y`, the floor's height at the pivot) as high as the ramp's rails (`rail`); its angle now, and its goal (`over`,
   * or at rest), which it swings toward at DIVERTER_SPEED; its ramp, and the dish that ramp runs up into at its far end
   * (behind the gate's hinge), if any. It starts at rest.
   */
  private diverter: { spec: Diverter; body: RAPIER.RigidBody; y: number; rail: number; angle: number; over: boolean; ramp: Ramp; dish: Dish | null } | null = null;
  /** How many balls the saucers have kicked out (an alternating one mirrors every other). */
  private saucerKicks = 0;
  private nextId = 1;
  private spinAngle = 0;
  private spinSpeed = 0;
  private spinBall = 0;
  /** The x of the shooter lane's one-way gate (Infinity: no gate), and the balls' bodies it's solid to this step. */
  private gateX = Infinity;
  private readonly gateSolidTo = new Set<number>();
  private readonly hooks: RAPIER.PhysicsHooks;
  /** This substep's hits, passed on once it's done (flushHits), so a handler that takes balls off can't pull one out
   * from under the step: it used to be called from inside the drain loop, and a drain handler's clear() had the loop
   * touch a body already gone from the world (a panic in Rapier's WebAssembly). */
  private readonly pending: Hit[] = [];

  constructor(private readonly table: Table, private readonly hits: (hit: Hit) => void) {
    const tilt = rad(TABLE.tiltDeg);
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY * Math.cos(tilt), z: -GRAVITY * Math.sin(tilt) });
    this.world.timestep = H;
    this.world.numSolverIterations = 8;
    // The lane's gate is solid to a ball on the playfield's side of it, and not to one in the lane: so a launch goes out
    // through it, and a ball from the table can't get in. Which side each ball is on is worked out before each step
    // (substep): the hook runs inside Rapier's step, where asking the world anything throws, and a hook that throws
    // counts as no contact.
    this.hooks = {
      filterContactPair: (c1, _c2, b1, b2) => {
        const ballBody = this.parts.get(c1)?.kind === 'gate' ? b2 : b1;
        return this.gateSolidTo.has(ballBody) ? RAPIER.SolverFlags.COMPUTE_IMPULSE : RAPIER.SolverFlags.EMPTY;
      },
      filterIntersectionPair: () => true,
    };
    this.build();
  }

  get tick(): number {
    return this._tick;
  }

  /** Seconds of play so far, on the table's clock. */
  get time(): number {
    return this._tick * DT;
  }

  // --- Building the table ---

  private fixed(desc: RAPIER.ColliderDesc, part?: Part): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    if (part) desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(desc, body);
    if (part) this.parts.set(collider.handle, part);
    return collider;
  }

  /** A box from a to b in (x, z), `half` thick each side, standing from the playfield to the walls' top. */
  private segment(a: [number, number], b: [number, number], half: number): RAPIER.ColliderDesc {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const hy = TABLE.wallTop / 2;
    return RAPIER.ColliderDesc.cuboid(len / 2, hy, half)
      .setTranslation((a[0] + b[0]) / 2, hy, (a[1] + b[1]) / 2)
      .setRotation(turnTo((Math.atan2(dz, dx) * 180) / Math.PI));
  }

  /** A round post at (x, z), the walls' height, standing on y0 (the playfield, or the dish's floor). */
  private post(x: number, z: number, r: number, y0 = 0): RAPIER.ColliderDesc {
    const hy = TABLE.wallTop / 2;
    return RAPIER.ColliderDesc.cylinder(hy, r).setTranslation(x, y0 + hy, z);
  }

  private sensor(desc: RAPIER.ColliderDesc, part: Part): RAPIER.Collider {
    return this.fixed(desc.setSensor(true), part);
  }

  private build(): void {
    const t = this.table;
    const { glassY } = TABLE;
    // The playfield and the glass, wider and longer than the table.
    this.fixed(RAPIER.ColliderDesc.cuboid(8, 0.5, 13).setTranslation(0, -0.5, 10).setFriction(PLAYFIELD.friction).setRestitution(PLAYFIELD.restitution));
    this.fixed(RAPIER.ColliderDesc.cuboid(8, 0.5, 13).setTranslation(0, glassY + 0.5, 10).setFriction(GLASS.friction).setRestitution(GLASS.restitution));
    // Backstops outside the outer wall and over the top.
    const half = TABLE.width / 2;
    const hy = glassY / 2;
    for (const side of [-1, 1]) this.fixed(RAPIER.ColliderDesc.cuboid(BACKSTOP / 2, hy, 11).setTranslation(side * (half + BACKSTOP / 2), hy, 10));
    this.fixed(RAPIER.ColliderDesc.cuboid(half + BACKSTOP, hy, BACKSTOP / 2).setTranslation(0, hy, TABLE.length + BACKSTOP / 2));

    // The walls with the tomb's doorway cut into the pyramid, and its jambs.
    const walls = wallsWithTomb(t);
    for (const w of walls) {
      for (let i = 0; i + 1 < w.points.length; i++) {
        this.fixed(this.segment(w.points[i], w.points[i + 1], WALL_HALF).setFriction(WALL_FRICTION).setRestitution(w.restitution));
      }
      for (const [x, z] of w.points) this.fixed(this.post(x, z, WALL_HALF).setFriction(WALL_FRICTION).setRestitution(w.restitution));
    }

    // The tomb's door, a wall as the pyramid's are, across the doorway's mouth between the jambs' ends (their posts
    // round its ends off), and its catch: a sensor just as big, so a ball is caught where it would have met the door.
    const mouth = tombMouth(t);
    if (t.tomb && mouth) {
      const { restitution } = walls.find((w) => w.kind === 'pyramid')!;
      const door = this.fixed(this.segment(mouth.a, mouth.b, WALL_HALF).setFriction(WALL_FRICTION).setRestitution(restitution));
      const catcher = this.fixed(this.segment(mouth.a, mouth.b, WALL_HALF).setSensor(true), { kind: 'tomb' });
      catcher.setEnabled(false);
      this.tomb = { spec: t.tomb, ...mouth, door, catcher, open: false };
    }

    for (const b of t.bumpers) {
      this.fixed(this.post(b.x, b.z, b.radius, b.y0 ?? 0).setFriction(0).setRestitution(BUMPER_RESTITUTION), { kind: 'bumper', id: b.id, x: b.x, z: b.z, kick: b.kick });
    }

    // A sling kicks out from its face, the side toward the table's middle: halfway between the pivots of the two main
    // flippers, the first two in the table's order (stage/pinball-parts.ts takes its `mid` the same way). Not the upper
    // flipper's too: its pivot, out at the right orbit, would move the middle from -0.4 to 0.68.
    const mains = t.flippers.slice(0, 2);
    const middle = mains.reduce((sum, f) => sum + f.pivot[0], 0) / Math.max(1, mains.length);
    for (const s of t.slings) {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
      const len = Math.hypot(dx, dz);
      let nx = dz / len, nz = -dx / len;
      const mx = (s.a[0] + s.b[0]) / 2;
      if ((middle - mx) * nx < 0) {
        nx = -nx;
        nz = -nz;
      }
      const part: Part = { kind: 'sling', id: s.id, nx, nz, a: s.a, kick: s.kick };
      this.fixed(this.segment(s.a, s.b, SLING_HALF).setFriction(0).setRestitution(SLING_RESTITUTION), part);
      for (const [x, z] of [s.a, s.b]) this.fixed(this.post(x, z, SLING_HALF).setFriction(0).setRestitution(SLING_RESTITUTION), part);
    }

    // Each target stands along the wall nearest it, or runs its own way (angle), as thick as its depth. A rising target
    // is built down, its collider off, and stays so until the game raises it.
    t.targets.forEach((g, index) => {
      const [a, b] = g.angle !== undefined
        ? ([[g.x, g.z], [g.x + Math.cos(rad(g.angle)), g.z + Math.sin(rad(g.angle))]] as [[number, number], [number, number]])
        : nearestSegment(walls, [g.x, g.z]);
      const ux = b[0] - a[0], uz = b[1] - a[1];
      const len = Math.hypot(ux, uz);
      const ex = ((ux / len) * g.width) / 2, ez = ((uz / len) * g.width) / 2;
      const collider = this.fixed(
        this.segment([g.x - ex, g.z - ez], [g.x + ex, g.z + ez], halfDepth(g)).setFriction(WALL_FRICTION).setRestitution(TARGET_RESTITUTION),
        { kind: 'target', id: g.id, index },
      );
      const down = g.rise !== undefined;
      if (down) collider.setEnabled(false);
      this.targets.push({ collider, down, turned: false, a: [g.x - ex, g.z - ez], b: [g.x + ex, g.z + ez] });
    });

    for (const r of t.rollovers) this.sensor(this.post(r.x, r.z, ROLLOVER_R), { kind: 'rollover', id: r.id });
    const sp = t.spinner;
    this.sensor(RAPIER.ColliderDesc.cuboid(sp.width / 2, hy, 0.05).setTranslation(sp.x, hy, sp.z), { kind: 'spinner' });
    this.lockSensor = this.sensor(this.post(t.lock.x, t.lock.z, t.lock.radius), { kind: 'lock' });
    t.spinners.forEach((s2, index) => {
      this.spin2.push({ angle: 0, speed: 0, ball: 0 });
      this.sensor(RAPIER.ColliderDesc.cuboid(s2.width / 2, SPINNER2_HALF_Y, 0.05).setTranslation(s2.x, SPINNER2_HALF_Y, s2.z), { kind: 'spinner2', index });
    });
    t.saucers.forEach((sc, index) => this.sensor(this.post(sc.x, sc.z, sc.radius), { kind: 'saucer', index }));
    this.sensor(this.post(t.kickback.x, t.kickback.z, KICKBACK_R), { kind: 'kickback' });

    // The shooter lane's one-way gate: from the top of the lane's inner wall (the straight up-and-down wall just left of
    // the plunger) up to the arch over it.
    const inner = walls.find((w) => w.points.length === 2 && w.points[0][0] === w.points[1][0] && w.points[0][0] < t.plunger.x && w.points[0][0] > t.plunger.x - 1);
    if (inner) {
      const x = inner.points[0][0];
      const top = Math.max(inner.points[0][1], inner.points[1][1]);
      const arch = archZ(t, x) ?? top + 2;
      const gate = this.fixed(this.segment([x, top], [x, arch + WALL_HALF], WALL_HALF).setFriction(WALL_FRICTION).setRestitution(GATE_RESTITUTION));
      gate.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      this.gateX = x;
      this.parts.set(gate.handle, { kind: 'gate' });
    }

    // A ramp's floor grips as the playfield; its rails are slick. The dish, floor and rim, is the playfield's.
    for (const r of t.ramps) {
      const [floor, sides] = this.rampMeshes(r);
      this.fixed(floor.setFriction(PLAYFIELD.friction).setRestitution(PLAYFIELD.restitution));
      this.fixed(sides.setFriction(RAIL.friction).setRestitution(RAIL.restitution));
    }
    for (const d of t.dishes) for (const m of this.dishMeshes(d)) this.fixed(m.setFriction(PLAYFIELD.friction).setRestitution(PLAYFIELD.restitution));

    // The diverter's gate: a box out from its pivot, as thick as a wall and as tall as its ramp's rails, standing on
    // the ramp's floor and turning about its pivot in the floor's plane, slick as the rails are. At rest it stands
    // along the gap in the ramp's rail (the ramp's opening), in the rail's place. The dish its ramp runs up into at its
    // far end is the one whose floor the ramp's last point is on.
    const dv = t.diverter;
    const gateRamp = dv && t.ramps.find((r) => r.id === dv.ramp);
    if (dv && gateRamp) {
      const y = floorHeight(gateRamp, dv.pivot);
      const [ex, ez] = gateRamp.path[gateRamp.path.length - 1];
      const dish = t.dishes.find((d) => Math.hypot(ex - d.x, ez - d.z) <= d.r) ?? null;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(dv.pivot[0], y, dv.pivot[1]).setRotation(turnTo(dv.restDeg)),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(dv.length / 2, gateRamp.rail / 2, WALL_HALF)
          .setTranslation(dv.length / 2, gateRamp.rail / 2, 0)
          .setFriction(RAIL.friction)
          .setRestitution(RAIL.restitution),
        body,
      );
      this.diverter = { spec: dv, body, y, rail: gateRamp.rail, angle: dv.restDeg, over: false, ramp: gateRamp, dish };
    }

    for (const f of t.flippers) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(f.pivot[0], 0, f.pivot[1]).setRotation(turnTo(f.restDeg)),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.convexHull(new Float32Array(flipperHull(f.length).flat()))!.setFriction(FLIPPER.friction).setRestitution(FLIPPER.restitution),
        body,
      );
      this.flippers.push({ f, body, angle: f.restDeg, up: false });
    }

    // The switches with no art: each a thin box across its lane at its angle, from the floor it stands on (the
    // playfield, or a ramp's) up as tall as a ball (passSwitches).
    for (const s of t.switches) {
      const a = rad(s.angle ?? 0);
      this.switchBoxes.push({ id: s.id, x: s.x, y: (s.y ?? 0) + SWITCH_HALF_Y, z: s.z, ux: Math.cos(a), uz: Math.sin(a), half: s.width / 2 });
    }
  }

  /**
   * A ramp as two triangle meshes. Its floor shares its vertices and has Rapier fix its internal edges (with a vertex per
   * triangle, the ball hit every edge between triangles as a step and a 29 units/s shot stopped halfway up). Its rails, a
   * skirt down each side to the playfield and a cap across each raised end are the other, so the ramp is a solid wedge
   * (skirted only at its low end, balls rolled in under its high end and wedged where it got low). A ramp with an
   * opening has that side's rail left out between the opening's two path points, for the diverter's gate to stand in
   * (the floor runs on whole beside it, so a ball the gate turns out rolls off its edge).
   */
  private rampMeshes(r: Ramp): [RAPIER.ColliderDesc, RAPIER.ColliderDesc] {
    const edges = r.path.map(([x, z, y], i) => {
      const [px, pz] = r.path[Math.max(0, i - 1)], [nx, nz] = r.path[Math.min(r.path.length - 1, i + 1)];
      const dx = nx - px, dz = nz - pz, l = Math.hypot(dx, dz) || 1;
      // A flared mouth, `flare` wider at the start and back to `width` within the first quarter (a shot a little off the
      // ramp's line caught the end of a rail head-on and stopped dead).
      const along = i / (r.path.length - 1), w = r.width + (r.flare ?? 0) * Math.max(0, 1 - along * 4) ** 2;
      const ox = (-dz / l) * (w / 2), oz = (dx / l) * (w / 2);
      return { l: [x + ox, z + oz], r: [x - ox, z - oz], y };
    });
    const fv: number[] = [], fi: number[] = [];
    for (const e of edges) fv.push(e.l[0], e.y, e.l[1], e.r[0], e.y, e.r[1]);
    for (let i = 0; i + 1 < edges.length; i++) {
      const al = 2 * i, ar = al + 1, bl = al + 2, br = al + 3;
      // Wound so the floor faces up (with its internal edges fixed the mesh is one-sided).
      fi.push(al, br, ar, al, bl, br);
    }
    const sv: number[] = [], si: number[] = [];
    const at = (x: number, y: number, z: number) => (sv.push(x, y, z), sv.length / 3 - 1);
    const quad = (a: number, b: number, c: number, d: number) => si.push(a, b, c, a, c, d);
    const gap = r.opening;
    const gapSide = gap?.side === 'left' ? 'l' : 'r';
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i], b = edges[i + 1];
      for (const side of ['l', 'r'] as const) {
        const p = a[side], q = b[side];
        const open = gap !== undefined && side === gapSide && i >= gap.from && i < gap.to;
        if (!open) quad(at(p[0], a.y, p[1]), at(q[0], b.y, q[1]), at(q[0], b.y + r.rail, q[1]), at(p[0], a.y + r.rail, p[1]));
        if (r.skirt !== false) quad(at(p[0], 0, p[1]), at(q[0], 0, q[1]), at(q[0], b.y, q[1]), at(p[0], a.y, p[1]));
      }
    }
    // A raised wireform (skirt: false) stands clear of the playfield, so balls pass under it; it has no end caps.
    for (const e of r.skirt === false ? [] : [edges[0], edges[edges.length - 1]]) {
      if (e.y > 0.02) quad(at(e.l[0], 0, e.l[1]), at(e.r[0], 0, e.r[1]), at(e.r[0], e.y, e.r[1]), at(e.l[0], e.y, e.l[1]));
    }
    const flags = RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES;
    return [RAPIER.ColliderDesc.trimesh(new Float32Array(fv), new Uint32Array(fi), flags), RAPIER.ColliderDesc.trimesh(new Float32Array(sv), new Uint32Array(si))];
  }

  /**
   * A dish as two triangle meshes: its flat floor (shared vertices) and its rim round all but its gaps. (Its bumper
   * stands near the uphill rim so no ball can rest uphill of it.)
   */
  private dishMeshes(d: Dish): [RAPIER.ColliderDesc, RAPIER.ColliderDesc] {
    const N = 48;
    const inGap = (deg: number) => d.gaps.some(([from, to]) => {
      const g0 = (from + 360) % 360, g1 = (to + 360) % 360, a = (deg + 360) % 360;
      return g0 <= g1 ? a >= g0 && a <= g1 : a >= g0 || a <= g1;
    });
    const fv: number[] = [d.x, d.y, d.z], fi: number[] = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      fv.push(d.x + d.r * Math.cos(a), d.y, d.z + d.r * Math.sin(a));
    }
    for (let k = 0; k < N; k++) fi.push(0, 1 + ((k + 1) % N), 1 + k); // facing up
    const sv: number[] = [], si: number[] = [];
    const at = (x: number, y: number, z: number) => (sv.push(x, y, z), sv.length / 3 - 1);
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      if (inGap((a0 * 180) / Math.PI) || inGap((a1 * 180) / Math.PI)) continue;
      const x0 = d.x + d.r * Math.cos(a0), z0 = d.z + d.r * Math.sin(a0), x1 = d.x + d.r * Math.cos(a1), z1 = d.z + d.r * Math.sin(a1);
      const p = at(x0, d.y, z0), q = at(x1, d.y, z1), qt = at(x1, d.y + d.rail, z1), pt = at(x0, d.y + d.rail, z0);
      si.push(p, q, qt, p, qt, pt);
    }
    return [
      RAPIER.ColliderDesc.trimesh(new Float32Array(fv), new Uint32Array(fi), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES),
      RAPIER.ColliderDesc.trimesh(new Float32Array(sv), new Uint32Array(si)),
    ];
  }

  // --- Balls ---

  /** Puts a ball in the plunger lane and fires it up, returning its id. */
  launch(owner: number | null): number {
    const p = this.table.plunger;
    const speed = p.speed * (1 + LAUNCH_SPREAD * (2 * Math.random() - 1));
    const id = this.addBall(owner, p.x, p.zFrom, 0, speed);
    // Already rolling, as a ball leaving the plunger is, so none of the launch goes into getting it to roll.
    this.items.get(id)!.body.setAngvel({ x: speed / TABLE.ballRadius, y: 0, z: 0 }, true);
    return id;
  }

  private addBall(owner: number | null, x: number, z: number, vx: number, vz: number): number {
    const r = TABLE.ballRadius;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, r, z).setLinvel(vx, 0, vz).setCcdEnabled(true).setCanSleep(false),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(r)
        .setDensity(BALL.density)
        .setFriction(BALL.friction)
        .setRestitution(BALL.restitution)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const ball: Ball = { id: this.nextId++, owner, body };
    this.items.set(ball.id, ball);
    this.ballByCollider.set(collider.handle, ball);
    return ball.id;
  }

  /** A ball's body state, for the 'spawn' message: the owner goes here (the snapshot's bodies have no room for it). */
  state(id: number): BodyState {
    const ball = this.items.get(id);
    if (!ball) throw new Error(`no ball ${id}`);
    const p = ball.body.translation();
    const q = ball.body.rotation();
    return {
      id,
      kind: 'ball',
      color: BALL_COLOR,
      ...(ball.owner !== null ? { owner: ball.owner } : {}),
      p: [p.x, p.y, p.z],
      q: [q.x, q.y, q.z, q.w],
    };
  }

  remove(id: number): void {
    const ball = this.items.get(id);
    if (!ball) return;
    for (let i = 0; i < ball.body.numColliders(); i++) this.ballByCollider.delete(ball.body.collider(i).handle);
    this.world.removeRigidBody(ball.body);
    this.items.delete(id);
    this.held.delete(id);
    this.lockIgnoreUntil.delete(id);
    this.saucerHold.delete(id);
    this.saucerIgnore.delete(id);
    if (this.tombHold?.id === id) this.tombHold = null;
    this.tombIgnore.delete(id);
    for (const key of this.lastKick.keys()) if (key.endsWith(`:${id}`)) this.lastKick.delete(key);
    for (const key of this.switchIgnoreUntil.keys()) if (key.endsWith(`:${id}`)) this.switchIgnoreUntil.delete(key);
    for (const key of this.inSwitch) if (key.endsWith(`:${id}`)) this.inSwitch.delete(key);
  }

  /** Takes every ball off, returning their ids. */
  clear(): number[] {
    const ids = [...this.items.keys()];
    for (const id of ids) this.remove(id);
    return ids;
  }

  /** Holds a ball in the lock (for multiball), still, until release. */
  holdInLock(id: number): void {
    const ball = this.items.get(id);
    if (!ball) return;
    const { x, z } = this.table.lock;
    // Out of a saucer or the tomb, if one had it: the lock has it now, and nothing else kicks it out.
    this.saucerHold.delete(id);
    if (this.tombHold?.id === id) this.tombHold = null;
    ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.setTranslation({ x, y: TABLE.ballRadius, z }, true);
    ball.body.setNextKinematicTranslation({ x, y: TABLE.ballRadius, z });
    this.held.add(id);
  }

  /**
   * Lets a ball the lock holds go: out of the lock, toward the flippers. (A saucer's ball, or the tomb's, goes when its
   * hold ends.)
   */
  release(id: number): void {
    const ball = this.items.get(id);
    if (!ball || this.heldBy(id) !== 'lock') return;
    this.held.delete(id);
    ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    ball.body.setLinvel({ x: LOCK_EJECT.speed * LOCK_EJECT.dir[0], y: 0, z: LOCK_EJECT.speed * LOCK_EJECT.dir[1] }, true);
    this.lockIgnoreUntil.set(id, this.time + LOCK_IGNORE);
  }

  /** What holds a ball still: the lock (holdInLock), a saucer or the magnet, the tomb, or nothing. */
  heldBy(id: number): 'lock' | 'saucer' | 'tomb' | null {
    if (this.saucerHold.has(id)) return 'saucer';
    if (this.tombHold?.id === id) return 'tomb';
    return this.held.has(id) ? 'lock' : null;
  }

  // --- The tomb ---

  /** Whether the tomb is open (its door gone and its mouth catching): never, on a table without one. */
  get tombOpen(): boolean {
    return this.tomb?.open ?? false;
  }

  /** Opens the tomb: its door goes from across the mouth, and the mouth catches. Open already, it stays open. */
  openTomb(): void {
    const tomb = this.tomb;
    if (!tomb || tomb.open) return;
    tomb.open = true;
    tomb.door.setEnabled(false);
    tomb.catcher.setEnabled(true);
  }

  /**
   * Shuts the tomb (its door back across the mouth, and the mouth no longer catching) and returns true: or, while it
   * holds a ball or any ball stands within a ball's radius and TOMB_CLEAR of the door's face, returns false and
   * changes nothing (a door shut on a ball would wedge it), so the game tries again next step. Shut already, or on a
   * table without a tomb, it is shut: true.
   */
  closeTomb(): boolean {
    const tomb = this.tomb;
    if (!tomb || !tomb.open) return true;
    if (this.tombHold || this.ballAtMouth()) return false;
    tomb.open = false;
    tomb.door.setEnabled(true);
    tomb.catcher.setEnabled(false);
    return true;
  }

  /**
   * Whether a ball's centre is within a ball's radius, WALL_HALF and TOMB_CLEAR of the tomb's mouth: so within
   * TOMB_CLEAR of touching the door (its face is WALL_HALF out from the mouth's line), shut or not.
   */
  private ballAtMouth(): boolean {
    const { a, b } = this.tomb!;
    const reach = TABLE.ballRadius + WALL_HALF + TOMB_CLEAR;
    for (const ball of this.items.values()) {
      const p = ball.body.translation();
      if (segmentDistance([p.x, p.z], a, b) < reach) return true;
    }
    return false;
  }

  // --- The diverter ---

  /**
   * Whether the diverter's gate is set over (its goal, which it swings to at DIVERTER_SPEED): never, on a table
   * without one.
   */
  get diverterOver(): boolean {
    return this.diverter?.over ?? false;
  }

  /**
   * Sets the diverter's gate swinging over (true) or back to rest (false) and returns true: or, while any ball's centre
   * is within a ball's radius and GATE_CLEAR of where the gate sweeps between the two, returns false and changes
   * nothing (a gate swung into a ball would shove it or wedge it), so the game tries again next step; and it won't
   * swing over while a ball is up on its ramp or in the dish that ramp runs up into (ballOnGateRamp). Set so already,
   * it stays: true. A table without a diverter has none to swing over (false), and none away from rest (true).
   */
  setDiverter(over: boolean): boolean {
    const gate = this.diverter;
    if (!gate) return !over;
    if (gate.over === over) return true;
    if (this.ballInSweep() || (over && this.ballOnGateRamp())) return false;
    gate.over = over;
    return true;
  }

  /**
   * Whether a ball is up on the gate's ramp (over its floor, anywhere along it) or in the dish the ramp runs up into
   * at its far end. Over, the gate shuts the ramp across, and a ball beyond it, or one going up that gets past it
   * while it swings, would come back down onto its back and be wedged between it and the far rail: on the left ramp,
   * waiting only for its sweep, all 40 balls let go in the dish or on the ramp above it were, and 19 of 700 shots up
   * the ramp, the gate asked over at each moment of their flight, got past it into the dish. Over, none gets past.
   */
  private ballOnGateRamp(): boolean {
    const { ramp, dish } = this.diverter!;
    const R = TABLE.ballRadius;
    for (const ball of this.items.values()) {
      const p = ball.body.translation();
      if (dish && Math.hypot(p.x - dish.x, p.z - dish.z) < dish.r && p.y - R > dish.y - 0.05) return true;
      const near = nearestOnRamp(ramp, [p.x, p.z]);
      if (near.d < (ramp.width + (ramp.flare ?? 0)) / 2 && p.y - R > near.y - 0.05) return true;
    }
    return false;
  }

  /**
   * Whether a ball's centre is within a ball's radius and GATE_CLEAR of where the gate sweeps: the sector between its
   * two angles out to its length (where its middle line goes), a wall's half-thickness wider either side (where its
   * faces go), from its ramp's floor up as high as the rails. So a ball on the playfield under the ramp is no matter.
   */
  private ballInSweep(): boolean {
    const { spec, y, rail } = this.diverter!;
    for (const ball of this.items.values()) {
      const p = ball.body.translation();
      const across = Math.max(0, sectorDistance([p.x, p.z], spec.pivot, spec.length, spec.restDeg, spec.overDeg) - WALL_HALF);
      const up = Math.max(0, y - p.y, p.y - (y + rail));
      if (Math.hypot(across, up) < TABLE.ballRadius + GATE_CLEAR) return true;
    }
    return false;
  }

  /** The toys' bits (shared/pinball.ts's TOY): the tomb open, and the diverter's gate set over (its goal). */
  toys(): number {
    return (this.tombOpen ? TOY.tombOpen : 0) | (this.diverterOver ? TOY.diverterOver : 0);
  }

  /** Fires a ball back up the table from the kickback (the game calls this when the kickback is lit). */
  kickback(id: number): void {
    const ball = this.items.get(id);
    if (!ball || this.held.has(id)) return;
    const k = this.table.kickback;
    ball.body.setTranslation({ x: k.x, y: TABLE.ballRadius, z: k.z }, true);
    ball.body.setLinvel({ x: 0, y: 0, z: KICKBACK_SPEED }, true);
    ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Shoves the table: every ball on it jumps a little up the table, and a little to one side or the other. */
  nudge(): void {
    for (const ball of this.items.values()) {
      if (this.held.has(ball.id)) continue;
      const v = ball.body.linvel();
      ball.body.setLinvel({ x: v.x + NUDGE.side * (2 * Math.random() - 1), y: v.y, z: v.z + NUDGE.up }, true);
    }
  }

  // --- Flippers, targets, spinner ---

  flip(side: 'left' | 'right', up: boolean): void {
    for (const s of this.flippers) if (s.f.side === side) s.up = up;
  }

  /** A flipper's angle now, in the table's degrees: the side's first (its main flipper). */
  flipperAngle(side: 'left' | 'right'): number {
    return this.flippers.find((s) => s.f.side === side)?.angle ?? 0;
  }

  /** Every flipper's angle now, in the table's order. */
  flipperAngles(): number[] {
    return this.flippers.map((s) => s.angle);
  }

  /**
   * Which targets are down, bit i for target i: the lock's drop targets and the pop-ups knocked down, and every rising
   * target at rest (a pop-up or the mummy stands down until the game raises it).
   */
  targetsDown(): number {
    let bits = 0;
    this.targets.forEach((g, i) => {
      if (g.down) bits |= 1 << i;
    });
    return bits;
  }

  /** Which flip targets show their backs: bit i for target i. */
  targetsTurned(): number {
    let bits = 0;
    this.targets.forEach((g, i) => {
      if (g.turned) bits |= 1 << i;
    });
    return bits;
  }

  /** Raises the lock's drop targets, turns every flip target back to its front and puts every rising target down. */
  resetTargets(): void {
    this.targets.forEach((g, i) => {
      const rising = this.table.targets[i].rise !== undefined;
      g.down = rising;
      g.turned = false;
      g.collider.setEnabled(!rising);
    });
    this.bankResets.clear();
  }

  /**
   * Raises the lock's drop targets (the scarab and the eye) only: the flip targets stay as they're turned, and the
   * rising ones as they stand.
   */
  resetDropTargets(): void {
    this.table.targets.forEach((spec, i) => {
      if (!isLockTarget(spec)) return;
      const g = this.targets[i];
      g.down = false;
      g.collider.setEnabled(true);
    });
  }

  /**
   * Raises a rising target (a pop-up or the mummy) and returns true: or, while a ball stands where it rises, returns
   * false and changes nothing (a target raised into a ball would wedge it), so the game tries again next step. One that
   * is up already stays up; an id that names no rising target is refused (false).
   */
  raiseTarget(id: string): boolean {
    const i = this.targetIndex(id);
    if (i < 0 || this.table.targets[i].rise === undefined) return false;
    const g = this.targets[i];
    if (!g.down) return true;
    if (this.ballAtTarget(i)) return false;
    g.down = false;
    g.collider.setEnabled(true);
    return true;
  }

  /** Puts a rising target down, its collider off: no wall and nothing to hit, until it is raised again. */
  lowerTarget(id: string): void {
    const i = this.targetIndex(id);
    if (i < 0 || this.table.targets[i].rise === undefined) return;
    const g = this.targets[i];
    g.down = true;
    g.collider.setEnabled(false);
  }

  /** Whether a ball stands where a lock drop target that is down would rise (raised into a ball, it would wedge it). */
  ballAtDropTarget(): boolean {
    return this.targets.some((g, i) => g.down && isLockTarget(this.table.targets[i]) && this.ballAtTarget(i));
  }

  /** Whether a ball stands within reach of target i's face: a ball's radius, half its depth and 0.05 from it. */
  private ballAtTarget(i: number): boolean {
    const g = this.targets[i];
    const reach = TABLE.ballRadius + halfDepth(this.table.targets[i]) + 0.05;
    for (const ball of this.items.values()) {
      const p = ball.body.translation();
      if (segmentDistance([p.x, p.z], g.a, g.b) < reach) return true;
    }
    return false;
  }

  /** The spinner's turn, in radians (0 to 2π). */
  spinnerAngle(): number {
    return this.spinAngle;
  }

  /** Every spinner's turn, in radians: the table's spinner, then its other spinners in order. */
  spinnerAngles(): number[] {
    return [this.spinAngle, ...this.spin2.map((s2) => s2.angle)];
  }

  /** The flipper a ball is within reach of (in its sweep, or about to be), or null. */
  nearFlipper(id: number): 'left' | 'right' | null {
    const ball = this.items.get(id);
    if (!ball) return null;
    const p = ball.body.translation();
    for (const { f } of this.flippers) {
      const dx = p.x - f.pivot[0], dz = p.z - f.pivot[1];
      if (Math.hypot(dx, dz) > f.length + TABLE.ballRadius + NEAR.reach) continue;
      const mid = (f.restDeg + f.upDeg) / 2;
      const off = Math.abs(((((Math.atan2(dz, dx) * 180) / Math.PI - mid) % 360) + 540) % 360 - 180);
      if (off <= Math.abs(f.upDeg - f.restDeg) / 2 + NEAR.deg) return f.side;
    }
    return null;
  }

  // --- Stepping ---

  /** Advances the table by DT, in SUBSTEPS Rapier steps. */
  step(): void {
    for (let s = 0; s < SUBSTEPS; s++) this.substep();
    this._tick++;
  }

  private substep(): void {
    for (const s of this.flippers) {
      const target = s.up ? s.f.upDeg : s.f.restDeg;
      const d = target - s.angle;
      const most = FLIPPER_SPEED * H;
      const next = Math.abs(d) <= most ? target : s.angle + Math.sign(d) * most;
      if (next !== s.angle) this.bat(s, rad(next - s.angle) / H);
      s.angle = next;
      s.body.setNextKinematicRotation(turnTo(s.angle));
    }
    // The diverter's gate swings toward its goal as a flipper does, but slowly and with no bat: a ball in its way is
    // pushed at the gate's own speed.
    const gate = this.diverter;
    if (gate) {
      const target = gate.over ? gate.spec.overDeg : gate.spec.restDeg;
      const d = target - gate.angle;
      const most = DIVERTER_SPEED * H;
      gate.angle = Math.abs(d) <= most ? target : gate.angle + Math.sign(d) * most;
      gate.body.setNextKinematicRotation(turnTo(gate.angle));
    }
    this.gateSolidTo.clear();
    for (const ball of this.items.values()) if (ball.body.translation().x < this.gateX) this.gateSolidTo.add(ball.body.handle);
    this.world.step(this.events, this.hooks);
    const now = this.time;
    const toDrop: number[] = [];
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const ball = this.ballByCollider.get(h1) ?? this.ballByCollider.get(h2);
      const part = this.parts.get(h1) ?? this.parts.get(h2);
      if (!ball || !part || !this.items.has(ball.id)) return;
      this.touch(ball, part, now, toDrop);
    });
    this.passSwitches(now);
    for (const [id, at] of [...this.bankResets]) {
      if (now < at) continue;
      this.bankResets.delete(id);
      const bank = this.table.banks.find((b) => b.id === id);
      for (const tid of bank?.targets ?? []) {
        const g = this.targets[this.targetIndex(tid)];
        if (g) g.turned = false;
      }
    }
    for (const index of toDrop) {
      const g = this.targets[index];
      if (g.down) continue;
      g.down = true;
      g.collider.setEnabled(false);
    }
    const spinTurns = Math.floor(this.spinAngle / (2 * Math.PI));
    this.spinSpeed = Math.max(0, this.spinSpeed - SPINNER_DRAG * H);
    this.spinAngle += this.spinSpeed * H;
    if (Math.floor(this.spinAngle / (2 * Math.PI)) > spinTurns) {
      this.spinAngle %= 2 * Math.PI;
      if (this.items.has(this.spinBall)) this.report({ kind: 'spinner', id: 'spinner', ball: this.spinBall });
    }
    this.spin2.forEach((s2, i) => {
      const turns = Math.floor(s2.angle / (2 * Math.PI));
      s2.speed = Math.max(0, s2.speed - SPINNER_DRAG * H);
      s2.angle += s2.speed * H;
      if (Math.floor(s2.angle / (2 * Math.PI)) > turns) {
        s2.angle %= 2 * Math.PI;
        if (this.items.has(s2.ball)) this.report({ kind: 'spinner', id: this.table.spinners[i].id, ball: s2.ball });
      }
    });
    // A saucer's hold over: its ball goes out along its eject (mirrored every other time, for an alternating one).
    for (const [id, h] of [...this.saucerHold]) {
      if (now < h.until) continue;
      this.saucerHold.delete(id);
      const ball = this.items.get(id);
      if (!ball) continue;
      this.held.delete(id);
      const sc = this.table.saucers[h.index];
      const len = Math.hypot(sc.eject[0], sc.eject[1]) || 1;
      const mirror = sc.alternate && this.saucerKicks++ % 2 === 1 ? -1 : 1;
      ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      ball.body.setLinvel({ x: (mirror * sc.speed * sc.eject[0]) / len, y: 0, z: (sc.speed * sc.eject[1]) / len }, true);
      this.saucerIgnore.set(id, now + LOCK_IGNORE);
    }
    // The tomb's hold over: its ball goes out along its eject, and neither the tomb nor a saucer (the magnet just below
    // the tomb would) catches it while it gets away.
    if (this.tombHold && now >= this.tombHold.until) {
      const { id } = this.tombHold;
      this.tombHold = null;
      const ball = this.items.get(id);
      if (ball) {
        this.held.delete(id);
        const { eject, speed } = this.tomb!.spec;
        const len = Math.hypot(eject[0], eject[1]) || 1;
        ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        ball.body.setLinvel({ x: (speed * eject[0]) / len, y: 0, z: (speed * eject[1]) / len }, true);
        this.tombIgnore.set(id, now + LOCK_IGNORE);
        this.saucerIgnore.set(id, now + LOCK_IGNORE);
      }
    }
    this.kickFromFullLock(now);
    for (const ball of [...this.items.values()]) {
      if (this.held.has(ball.id)) continue;
      const v = ball.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > MAX_SPEED) {
        const k = MAX_SPEED / speed;
        ball.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
      }
      if (ball.body.translation().z < this.table.drainZ) {
        this.remove(ball.id);
        this.report({ kind: 'drain', id: 'drain', ball: ball.id });
      }
    }
    this.flushHits();
  }

  private report(hit: Hit): void {
    this.pending.push(hit);
  }

  /**
   * Passes on this substep's hits, in the order they came. A handler may take balls off (or clear the table): a hit
   * for a ball it has already taken off isn't passed on, except a drain (that ball's gone by then anyway).
   */
  private flushHits(): void {
    if (this.pending.length === 0) return;
    const hits = this.pending.splice(0);
    for (const hit of hits) if (hit.kind === 'drain' || this.items.has(hit.ball)) this.hits(hit);
  }

  /**
   * A swinging flipper bats the balls on it. Rapier bounces a ball only off a contact that's new, and a ball lying on a
   * flipper isn't: left to it, the flipper only pushes the ball round with it, so every shot came off at the top of the
   * swing (straight up the middle) and no faster than the flipper's face. So the bounce is given here, before the step:
   * a ball touching the face, with the face about to move into it at `vs` along the normal, comes off at
   * vs + e (vs - vn), e the flipper's restitution, as a new contact would.
   */
  private bat(s: FlipperState, omega: number): void {
    const { f } = s;
    const a = rad(s.angle);
    const ux = Math.cos(a), uz = Math.sin(a);
    const reach = f.length - FLIPPER_TIP_R;
    for (const ball of this.items.values()) {
      if (this.held.has(ball.id)) continue;
      const p = ball.body.translation();
      const rx = p.x - f.pivot[0], rz = p.z - f.pivot[1];
      const t = Math.max(0, Math.min(reach, rx * ux + rz * uz));
      const cx = rx - t * ux, cz = rz - t * uz;
      const dist = Math.hypot(cx, cz);
      const thick = FLIPPER_BASE_R + ((FLIPPER_TIP_R - FLIPPER_BASE_R) * t) / reach;
      if (dist < 1e-6 || dist > thick + TABLE.ballRadius + BAT_TOUCH) continue;
      const nx = cx / dist, nz = cz / dist;
      // The face's velocity where it meets the ball (turning at omega about the pivot, the table's way round).
      const qx = t * ux + nx * thick, qz = t * uz + nz * thick;
      const vs = omega * (-qz * nx + qx * nz);
      const v = ball.body.linvel();
      const vn = v.x * nx + v.z * nz;
      if (vs <= 0 || vn >= vs) continue;
      const add = vs + FLIPPER.restitution * (vs - vn) - vn;
      ball.body.setLinvel({ x: v.x + nx * add, y: v.y, z: v.z + nz * add }, true);
    }
  }

  /**
   * The switches' sensors, by hand (switchBoxes): a ball touches a switch when its sphere comes to overlap the
   * switch's box, having been clear of it as the last substep ended, as a Rapier sensor's touch starts. A ball held
   * still touches none, since it passes nothing.
   */
  private passSwitches(now: number): void {
    const R = TABLE.ballRadius;
    for (const s of this.switchBoxes) {
      for (const ball of this.items.values()) {
        const key = `${s.id}:${ball.id}`;
        const p = ball.body.translation();
        const dx = p.x - s.x, dz = p.z - s.z;
        // How far the ball's centre is past each of the box's faces: along it, across it, and up.
        const along = Math.abs(dx * s.ux + dz * s.uz) - s.half, across = Math.abs(dz * s.ux - dx * s.uz) - SWITCH_HALF_DEPTH, up = Math.abs(p.y - s.y) - SWITCH_HALF_Y;
        const inside = !this.held.has(ball.id) && Math.hypot(Math.max(0, along), Math.max(0, across), Math.max(0, up)) < R;
        if (!inside) this.inSwitch.delete(key);
        else if (!this.inSwitch.has(key)) {
          this.inSwitch.add(key);
          this.touch(ball, { kind: 'switch', id: s.id }, now, []);
        }
      }
    }
  }

  /** A ball has just touched a part of the table. */
  private touch(ball: Ball, part: Part, now: number, toDrop: number[]): void {
    switch (part.kind) {
      case 'bumper':
      case 'sling': {
        const key = `${part.id}:${ball.id}`;
        if (now - (this.lastKick.get(key) ?? -Infinity) < KICK_COOLDOWN) return;
        const p = ball.body.translation();
        let nx: number, nz: number;
        if (part.kind === 'bumper') {
          const dx = p.x - part.x, dz = p.z - part.z;
          const d = Math.hypot(dx, dz) || 1;
          nx = dx / d;
          nz = dz / d;
        } else {
          // Only the face kicks: a ball behind the sling (in the inlane) just bounces off.
          if ((p.x - part.a[0]) * part.nx + (p.z - part.a[1]) * part.nz <= 0) return;
          nx = part.nx;
          nz = part.nz;
        }
        this.lastKick.set(key, now);
        const v = ball.body.linvel();
        const vn = v.x * nx + v.z * nz;
        // Whatever of it went into the part is taken out, and the kick added away from it.
        const add = part.kick - Math.min(vn, 0);
        ball.body.setLinvel({ x: v.x + nx * add, y: v.y, z: v.z + nz * add }, true);
        this.report({ kind: part.kind, id: part.id, ball: ball.id });
        return;
      }
      case 'target': {
        const spec = this.table.targets[part.index];
        if (!spec.flip && spec.rise !== 'hold') {
          // A drop target, the lock's or a pop-up, drops: its collider goes off once the step is done (toDrop).
          if (this.targets[part.index].down || toDrop.includes(part.index)) return;
          toDrop.push(part.index);
          this.report({ kind: 'target', id: part.id, ball: ball.id });
          return;
        }
        // A flip target stays up and the first hit turns it to its back; a held one (the mummy) stays up and does not
        // turn at all. Every hit of either scores (with the bumpers' cool-down).
        const g = this.targets[part.index];
        const key = `${part.id}:${ball.id}`;
        if (now - (this.lastKick.get(key) ?? -Infinity) < KICK_COOLDOWN) return;
        this.lastKick.set(key, now);
        this.report({ kind: 'target', id: part.id, ball: ball.id });
        if (spec.rise === 'hold' || g.turned) return;
        g.turned = true;
        // Its bank matches when all its plaques are turned: once, until they turn back (a second ball on the last plaque
        // in the same step finds it already turned, above).
        for (const bank of this.table.banks) {
          if (!bank.targets.includes(part.id) || this.bankResets.has(bank.id)) continue;
          if (bank.targets.every((id) => this.targets[this.targetIndex(id)]?.turned)) {
            this.report({ kind: 'bank', id: bank.id, ball: ball.id });
            this.bankResets.set(bank.id, now + BANK_SHOW);
          }
        }
        return;
      }
      case 'rollover':
        this.report({ kind: 'rollover', id: part.id, ball: ball.id });
        return;
      case 'spinner': {
        const v = ball.body.linvel();
        this.spinSpeed = Math.max(this.spinSpeed, Math.hypot(v.x, v.z) * SPINNER_SPIN);
        this.spinBall = ball.id;
        return;
      }
      case 'spinner2': {
        const v = ball.body.linvel();
        const s2 = this.spin2[part.index];
        s2.speed = Math.max(s2.speed, Math.hypot(v.x, v.z) * SPINNER_SPIN);
        s2.ball = ball.id;
        return;
      }
      case 'saucer': {
        // A slow ball is held still at the saucer's middle for its hold (the substep lets it go when the hold is over).
        const sc = this.table.saucers[part.index];
        const v = ball.body.linvel();
        if (this.held.has(ball.id) || now < (this.saucerIgnore.get(ball.id) ?? -Infinity) || Math.hypot(v.x, v.z) > sc.maxSpeed) return;
        ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        ball.body.setTranslation({ x: sc.x, y: TABLE.ballRadius, z: sc.z }, true);
        ball.body.setNextKinematicTranslation({ x: sc.x, y: TABLE.ballRadius, z: sc.z });
        this.held.add(ball.id);
        this.saucerHold.set(ball.id, { index: part.index, until: now + sc.hold });
        this.report({ kind: 'saucer', id: sc.id, ball: ball.id });
        return;
      }
      case 'lock':
        if (this.held.has(ball.id) || now < (this.lockIgnoreUntil.get(ball.id) ?? -Infinity)) return;
        this.report({ kind: 'lock', id: 'lock', ball: ball.id });
        return;
      case 'kickback':
        this.report({ kind: 'kickback', id: 'kickback', ball: ball.id });
        return;
      case 'switch': {
        // Once a pass: the same ball touching it again within SWITCH_IGNORE (rattling across it, or rolling back over
        // it) is that pass still.
        const key = `${part.id}:${ball.id}`;
        if (now < (this.switchIgnoreUntil.get(key) ?? -Infinity)) return;
        this.switchIgnoreUntil.set(key, now + SWITCH_IGNORE);
        this.report({ kind: 'switch', id: part.id, ball: ball.id });
        return;
      }
      case 'gate':
        return;
      case 'tomb':
        this.catchInTomb(ball, now);
        return;
    }
  }

  /**
   * The open tomb's mouth touched: the ball is caught, at any speed (unlike a saucer's), and held still at the tomb's
   * `held` spot for its hold (the substep kicks it out). Not a ball the lock or a saucer holds, nor one just kicked out
   * of the tomb, nor while the tomb holds another (a held ball fills the mouth); nor while another ball stands where
   * the caught one would be held, as one moved there would be moved into it.
   */
  private catchInTomb(ball: Ball, now: number): void {
    const tomb = this.tomb;
    if (!tomb?.open || this.tombHold || this.held.has(ball.id) || now < (this.tombIgnore.get(ball.id) ?? -Infinity)) return;
    const [x, z] = tomb.spec.held;
    for (const other of this.items.values()) {
      const p = other.body.translation();
      if (other !== ball && Math.hypot(p.x - x, p.z - z) < 2 * TABLE.ballRadius) return;
    }
    ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.setTranslation({ x, y: TABLE.ballRadius, z }, true);
    ball.body.setNextKinematicTranslation({ x, y: TABLE.ballRadius, z });
    this.held.add(ball.id);
    this.tombHold = { id: ball.id, until: now + tomb.spec.hold };
    this.report({ kind: 'tomb', id: tomb.spec.id, ball: ball.id });
  }

  /**
   * While the lock holds a ball, any other ball in its sensor is kicked back out, as a saucer kicks: put beside the
   * held ball, on the side LOCK_KICK goes, and sent off along it; and the lock ignores it for LOCK_IGNORE, as it does a
   * ball it lets go. (The gate over turns the left ramp's shots out onto the held ball, and left there 7 of the layout
   * test's 27 that went in came to rest against it.) Not a ball something holds, nor one the lock is ignoring, nor
   * while another ball stands where the kicked one would be put: that one is tried again next step, and so is one
   * still in the sensor when its ignore is over. The touch that brings a ball in is the lock's hit as ever, and the
   * kick reports nothing of its own: the game holds a ball only in the lit lock outside multiball, and the lock holds
   * one only in multiball.
   */
  private kickFromFullLock(now: number): void {
    let holding = false;
    for (const id of this.held) if (this.heldBy(id) === 'lock') holding = true;
    if (!holding) return;
    const R = TABLE.ballRadius;
    const [dx, dz] = LOCK_KICK.dir;
    const len = Math.hypot(dx, dz) || 1;
    const out = 2 * R + LOCK_KICK_CLEAR;
    const x = this.table.lock.x + (out * dx) / len, z = this.table.lock.z + (out * dz) / len;
    for (const ball of this.items.values()) {
      if (this.held.has(ball.id) || now < (this.lockIgnoreUntil.get(ball.id) ?? -Infinity)) continue;
      if (!this.world.intersectionPair(this.lockSensor, ball.body.collider(0))) continue;
      let clear = true;
      for (const other of this.items.values()) {
        const p = other.body.translation();
        if (other !== ball && Math.hypot(p.x - x, p.z - z) < 2 * R) clear = false;
      }
      if (!clear) continue;
      ball.body.setTranslation({ x, y: R, z }, true);
      ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      ball.body.setLinvel({ x: (LOCK_KICK.speed * dx) / len, y: 0, z: (LOCK_KICK.speed * dz) / len }, true);
      this.lockIgnoreUntil.set(ball.id, now + LOCK_IGNORE);
    }
  }

  private targetIndex(id: string): number {
    return this.table.targets.findIndex((t) => t.id === id);
  }

  // --- Snapshot ---

  /**
   * The binary snapshot (shared/pinball.ts): the header, with the three flippers' angles (degrees), the lit inserts the
   * game passes, the targets down and turned, the two spinners' turns and the toys' bits (toys()), then each ball in
   * the kit's body format.
   */
  snapshot(lit: number): Buffer {
    const count = this.items.size;
    const buf = Buffer.allocUnsafe(SNAP_PINBALL_HEADER + count * SNAP_STRIDE);
    buf.writeUInt8(SNAP_TYPE_PINBALL, 0);
    buf.writeDoubleLE(this.time, 1);
    buf.writeUInt16LE(count, 9);
    const flippers = this.flipperAngles();
    for (let i = 0; i < 3; i++) buf.writeFloatLE(flippers[i] ?? 0, 11 + i * 4);
    buf.writeUInt32LE(lit >>> 0, 23);
    buf.writeUInt32LE(this.targetsDown() >>> 0, 27);
    buf.writeUInt32LE(this.targetsTurned() >>> 0, 31);
    const spinners = this.spinnerAngles();
    buf.writeFloatLE(spinners[0] ?? 0, 35);
    buf.writeFloatLE(spinners[1] ?? 0, 39);
    buf.writeUInt32LE(this.toys() >>> 0, 43);
    let o = SNAP_PINBALL_HEADER;
    for (const ball of this.items.values()) {
      const p = ball.body.translation();
      const q = ball.body.rotation();
      buf.writeUInt32LE(ball.id, o);
      buf.writeFloatLE(p.x, o + 4);
      buf.writeFloatLE(p.y, o + 8);
      buf.writeFloatLE(p.z, o + 12);
      buf.writeFloatLE(q.x, o + 16);
      buf.writeFloatLE(q.y, o + 20);
      buf.writeFloatLE(q.z, o + 24);
      buf.writeFloatLE(q.w, o + 28);
      o += SNAP_STRIDE;
    }
    return buf;
  }
}

/** Half a target's thickness across its face: its wall stands this far out each side of its segment. */
function halfDepth(g: Target): number {
  return (g.depth ?? TARGET_DEPTH) / 2;
}

/** A ramp's floor height at p, in (x, z): its centre line's height at the point on it nearest p. */
function floorHeight(r: Ramp, p: [number, number]): number {
  return nearestOnRamp(r, p).y;
}

/** The point on a ramp's centre line nearest p, in (x, z): how far from p it is, and the floor's height there. */
function nearestOnRamp(r: Ramp, p: [number, number]): { d: number; y: number } {
  let best = Infinity, y = r.path[0][2];
  for (let i = 0; i + 1 < r.path.length; i++) {
    const [ax, az, ay] = r.path[i], [bx, bz, by] = r.path[i + 1];
    const dx = bx - ax, dz = bz - az;
    const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(p[0] - ax - u * dx, p[1] - az - u * dz);
    if (d < best) {
      best = d;
      y = ay + u * (by - ay);
    }
  }
  return { d: best, y };
}

/**
 * The distance from p to the sector round c of radius r between the angles a0 and a1 (degrees, the table's way round,
 * x toward z), in (x, z): 0 inside it. The sector is the one a line turning from the lesser angle to the greater
 * sweeps, as the gate turns between its two.
 */
function sectorDistance(p: [number, number], c: [number, number], r: number, a0: number, a1: number): number {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  const dx = p[0] - c[0], dz = p[1] - c[1];
  // How far round from lo the point lies, 0 to 360: within the sector's angles, its nearest point is along its own
  // radius; outside them, on one of the two edges.
  const round = ((((Math.atan2(dz, dx) * 180) / Math.PI - lo) % 360) + 360) % 360;
  if (round <= hi - lo) return Math.max(0, Math.hypot(dx, dz) - r);
  const edge = (deg: number): [number, number] => [c[0] + r * Math.cos(rad(deg)), c[1] + r * Math.sin(rad(deg))];
  return Math.min(segmentDistance(p, c, edge(lo)), segmentDistance(p, c, edge(hi)));
}

/** The distance from p to the segment a-b, in (x, z). */
function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz);
}

/** The wall segment nearest p. */
function nearestSegment(walls: Wall[], p: [number, number]): [[number, number], [number, number]] {
  let best: [[number, number], [number, number]] = [[0, 0], [0, 1]];
  let bestD = Infinity;
  for (const w of walls) {
    for (let i = 0; i + 1 < w.points.length; i++) {
      const a = w.points[i], b = w.points[i + 1];
      const d = segmentDistance(p, a, b);
      if (d < bestD) {
        bestD = d;
        best = [a, b];
      }
    }
  }
  return best;
}

/** Where the outer wall crosses x on its way over the top (the highest z it has there), or null. */
function archZ(t: Table, x: number): number | null {
  const pts = t.walls[0].points;
  let best: number | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
    const z = az + ((x - ax) / (bx - ax)) * (bz - az);
    if (best === null || z > best) best = z;
  }
  return best;
}
