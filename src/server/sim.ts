// The pinball table's physics, on the server (as the claw's is: the server is the one source of truth, and the stages
// only draw the snapshots it sends). The playfield, the walls, the glass, the bumpers, the slings and the drop targets
// are fixed colliders; the balls are dynamic spheres with CCD; the flippers are kinematic bodies swung toward up or
// rest. Bumpers and slings kick a ball away and report it; the rollovers, the spinner, the lock and the kickback are
// sensors that report; a ball past the drain is taken off and reported. What the hits are worth, whose balls they are
// and what's lit is the game's (game.ts): this is only the physics.
//
// The table is in scene units (table.ts): x across, z up the table, y up off the playfield (the plane y = 0).
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { DT } from '@kit/server';
import { SNAP_STRIDE, type BodyState } from '@kit/shared';
import { SNAP_PINBALL_HEADER, SNAP_TYPE_PINBALL } from '../shared/pinball';
import { TABLE, type Flipper, type Table } from '../shared/table';

// Passed on for the game and the tests, which import it from here; it's every machine's (@kit/server).
export { DT } from '@kit/server';

/** Gravity in scene units per second squared: 9.81 m/s² at 5.1 cm a unit. It pulls down the tilted table. */
export const GRAVITY = 192;
/** Rapier steps per DT: a ball at 60 units/s moves 0.25 a step, less than its radius, so it can't skip a wall. */
export const SUBSTEPS = 4;
const H = DT / SUBSTEPS;

/** Half a wall's thickness (walls are boxes along each segment, rounded at the joints, from the playfield to the glass). */
const WALL_HALF = 0.08;
/** Half a sling's thickness. */
const SLING_HALF = 0.08;
/** Half a drop target's thickness, across its wall. */
const TARGET_HALF = 0.1;
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
/** A flipper's shape: round at the base (on the pivot) and at the tip, its tip round ending at its `length`. */
const FLIPPER_BASE_R = 0.22;
const FLIPPER_TIP_R = 0.1;
const FLIPPER_HEIGHT = 0.45;
/** A ball this near a swinging flipper's face is batted by it (bat). */
const BAT_TOUCH = 0.03;

/** A bumper or a sling kicks the same ball again only after this long (s), so a ball touching twice gets one kick. */
const KICK_COOLDOWN = 0.1;
/** The rollovers' and the kickback's sensors' radius. */
const ROLLOVER_R = 0.3;
const KICKBACK_R = 0.6;
/** How fast the kickback fires a ball back up (units/s, up the table). */
const KICKBACK_SPEED = 30;
/** How fast a ball let go from the lock leaves it (units/s), and which way: down and in, toward the flippers. */
const LOCK_EJECT = { speed: 8, dir: [0.6, -0.8] as const };
/** After it's let go, a ball doesn't set the lock off again for this long (s). */
const LOCK_IGNORE = 0.75;
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
  kind: 'bumper' | 'sling' | 'target' | 'rollover' | 'spinner' | 'lock' | 'drain' | 'kickback';
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
  | { kind: 'kickback' }
  | { kind: 'gate' };

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
  private readonly targets: { collider: RAPIER.Collider; down: boolean }[] = [];
  private readonly lastKick = new Map<string, number>();
  private readonly lockIgnoreUntil = new Map<number, number>();
  private readonly held = new Set<number>();
  private nextId = 1;
  private spinAngle = 0;
  private spinSpeed = 0;
  private spinBall = 0;
  /** The x of the shooter lane's one-way gate (Infinity: no gate), and the balls' bodies it's solid to this step. */
  private gateX = Infinity;
  private readonly gateSolidTo = new Set<number>();
  private readonly hooks: RAPIER.PhysicsHooks;

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

  /** A box from a to b in (x, z), `half` thick each side, standing from the playfield to the glass. */
  private segment(a: [number, number], b: [number, number], half: number): RAPIER.ColliderDesc {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const hy = TABLE.glassY / 2;
    return RAPIER.ColliderDesc.cuboid(len / 2, hy, half)
      .setTranslation((a[0] + b[0]) / 2, hy, (a[1] + b[1]) / 2)
      .setRotation(turnTo((Math.atan2(dz, dx) * 180) / Math.PI));
  }

  /** A round post at (x, z), from the playfield to the glass. */
  private post(x: number, z: number, r: number): RAPIER.ColliderDesc {
    const hy = TABLE.glassY / 2;
    return RAPIER.ColliderDesc.cylinder(hy, r).setTranslation(x, hy, z);
  }

  private sensor(desc: RAPIER.ColliderDesc, part: Part): void {
    this.fixed(desc.setSensor(true), part);
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

    for (const w of t.walls) {
      for (let i = 0; i + 1 < w.points.length; i++) {
        this.fixed(this.segment(w.points[i], w.points[i + 1], WALL_HALF).setFriction(WALL_FRICTION).setRestitution(w.restitution));
      }
      for (const [x, z] of w.points) this.fixed(this.post(x, z, WALL_HALF).setFriction(WALL_FRICTION).setRestitution(w.restitution));
    }

    for (const b of t.bumpers) {
      this.fixed(this.post(b.x, b.z, b.radius).setFriction(0).setRestitution(BUMPER_RESTITUTION), { kind: 'bumper', id: b.id, x: b.x, z: b.z, kick: b.kick });
    }

    // A sling kicks out from its face, the side toward the table's middle (halfway between the flippers' pivots).
    const middle = t.flippers.reduce((sum, f) => sum + f.pivot[0], 0) / Math.max(1, t.flippers.length);
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

    // Each drop target stands along the wall nearest it.
    t.targets.forEach((g, index) => {
      const [a, b] = nearestSegment(t, [g.x, g.z]);
      const ux = b[0] - a[0], uz = b[1] - a[1];
      const len = Math.hypot(ux, uz);
      const ex = ((ux / len) * g.width) / 2, ez = ((uz / len) * g.width) / 2;
      const collider = this.fixed(
        this.segment([g.x - ex, g.z - ez], [g.x + ex, g.z + ez], TARGET_HALF).setFriction(WALL_FRICTION).setRestitution(TARGET_RESTITUTION),
        { kind: 'target', id: g.id, index },
      );
      this.targets.push({ collider, down: false });
    });

    for (const r of t.rollovers) this.sensor(this.post(r.x, r.z, ROLLOVER_R), { kind: 'rollover', id: r.id });
    const sp = t.spinner;
    this.sensor(RAPIER.ColliderDesc.cuboid(sp.width / 2, hy, 0.05).setTranslation(sp.x, hy, sp.z), { kind: 'spinner' });
    this.sensor(this.post(t.lock.x, t.lock.z, t.lock.radius), { kind: 'lock' });
    this.sensor(this.post(t.kickback.x, t.kickback.z, KICKBACK_R), { kind: 'kickback' });

    // The shooter lane's one-way gate: from the top of the lane's inner wall (the straight up-and-down wall just left of
    // the plunger) up to the arch over it.
    const inner = t.walls.find((w) => w.points.length === 2 && w.points[0][0] === w.points[1][0] && w.points[0][0] < t.plunger.x && w.points[0][0] > t.plunger.x - 1);
    if (inner) {
      const x = inner.points[0][0];
      const top = Math.max(inner.points[0][1], inner.points[1][1]);
      const arch = archZ(t, x) ?? top + 2;
      const gate = this.fixed(this.segment([x, top], [x, arch + WALL_HALF], WALL_HALF).setFriction(WALL_FRICTION).setRestitution(GATE_RESTITUTION));
      gate.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      this.gateX = x;
      this.parts.set(gate.handle, { kind: 'gate' });
    }

    for (const f of t.flippers) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(f.pivot[0], 0, f.pivot[1]).setRotation(turnTo(f.restDeg)),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.convexHull(flipperPoints(f.length))!.setFriction(FLIPPER.friction).setRestitution(FLIPPER.restitution),
        body,
      );
      this.flippers.push({ f, body, angle: f.restDeg, up: false });
    }
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
    for (const key of this.lastKick.keys()) if (key.endsWith(`:${id}`)) this.lastKick.delete(key);
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
    ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.setTranslation({ x, y: TABLE.ballRadius, z }, true);
    ball.body.setNextKinematicTranslation({ x, y: TABLE.ballRadius, z });
    this.held.add(id);
  }

  /** Lets a held ball go: out of the lock, toward the flippers. */
  release(id: number): void {
    const ball = this.items.get(id);
    if (!ball || !this.held.has(id)) return;
    this.held.delete(id);
    ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    ball.body.setLinvel({ x: LOCK_EJECT.speed * LOCK_EJECT.dir[0], y: 0, z: LOCK_EJECT.speed * LOCK_EJECT.dir[1] }, true);
    this.lockIgnoreUntil.set(id, this.time + LOCK_IGNORE);
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

  /** A flipper's angle now, in the table's degrees. */
  flipperAngle(side: 'left' | 'right'): number {
    return this.flippers.find((s) => s.f.side === side)?.angle ?? 0;
  }

  /** Which drop targets are down: bit i for target i. */
  targetsDown(): number {
    let bits = 0;
    this.targets.forEach((g, i) => {
      if (g.down) bits |= 1 << i;
    });
    return bits;
  }

  resetTargets(): void {
    for (const g of this.targets) {
      g.down = false;
      g.collider.setEnabled(true);
    }
  }

  /** The spinner's turn, in radians (0 to 2π). */
  spinnerAngle(): number {
    return this.spinAngle;
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
      if (this.items.has(this.spinBall)) this.hits({ kind: 'spinner', id: 'spinner', ball: this.spinBall });
    }
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
        this.hits({ kind: 'drain', id: 'drain', ball: ball.id });
      }
    }
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
        this.hits({ kind: part.kind, id: part.id, ball: ball.id });
        return;
      }
      case 'target':
        if (this.targets[part.index].down || toDrop.includes(part.index)) return;
        toDrop.push(part.index);
        this.hits({ kind: 'target', id: part.id, ball: ball.id });
        return;
      case 'rollover':
        this.hits({ kind: 'rollover', id: part.id, ball: ball.id });
        return;
      case 'spinner': {
        const v = ball.body.linvel();
        this.spinSpeed = Math.max(this.spinSpeed, Math.hypot(v.x, v.z) * SPINNER_SPIN);
        this.spinBall = ball.id;
        return;
      }
      case 'lock':
        if (this.held.has(ball.id) || now < (this.lockIgnoreUntil.get(ball.id) ?? -Infinity)) return;
        this.hits({ kind: 'lock', id: 'lock', ball: ball.id });
        return;
      case 'kickback':
        this.hits({ kind: 'kickback', id: 'kickback', ball: ball.id });
        return;
      case 'gate':
        return;
    }
  }

  // --- Snapshot ---

  /**
   * The binary snapshot (shared/pinball.ts): the header, with the flippers' angles (degrees), the lit inserts the game
   * passes, the targets down and the spinner's turn, then each ball in the kit's body format.
   */
  snapshot(lit: number): Buffer {
    const count = this.items.size;
    const buf = Buffer.allocUnsafe(SNAP_PINBALL_HEADER + count * SNAP_STRIDE);
    buf.writeUInt8(SNAP_TYPE_PINBALL, 0);
    buf.writeDoubleLE(this.time, 1);
    buf.writeUInt16LE(count, 9);
    buf.writeFloatLE(this.flipperAngle('left'), 11);
    buf.writeFloatLE(this.flipperAngle('right'), 15);
    buf.writeUInt32LE(lit >>> 0, 19);
    buf.writeUInt8(this.targetsDown() & 0xff, 23);
    buf.writeFloatLE(this.spinAngle, 24);
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

/** A flipper's outline in its own frame (+x from the pivot), at the playfield and at its top, for a convex hull. */
function flipperPoints(length: number): Float32Array {
  const pts: number[] = [];
  const n = 12;
  for (const y of [0, FLIPPER_HEIGHT]) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      pts.push(FLIPPER_BASE_R * Math.cos(a), y, FLIPPER_BASE_R * Math.sin(a));
      pts.push(length - FLIPPER_TIP_R + FLIPPER_TIP_R * Math.cos(a), y, FLIPPER_TIP_R * Math.sin(a));
    }
  }
  return new Float32Array(pts);
}

/** The wall segment nearest p. */
function nearestSegment(t: Table, p: [number, number]): [[number, number], [number, number]] {
  let best: [[number, number], [number, number]] = [[0, 0], [0, 1]];
  let bestD = Infinity;
  for (const w of t.walls) {
    for (let i = 0; i + 1 < w.points.length; i++) {
      const a = w.points[i], b = w.points[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz);
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
