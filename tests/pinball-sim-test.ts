// The pinball's physics (server/sim.ts), headless with the real Rapier: a launch goes up the plunger lane and onto the
// table, no shot gets out through a wall, a ball left alone drains, the right flipper shoots to the upper table (up the
// left ramp and round the left orbit) and the left flipper too (round the right orbit) and at the drop targets, a bumper
// kicks, the kickback and the lock do what the game asks (and the lock, holding a ball, kicks a second back out and
// never holds it), flip targets turn and their banks match once, a saucer's ball is held and let go cleanly, the
// quest's rising targets (the three pop-ups and the mummy) start down, rise when the game raises them, never rise into
// a ball, and the pop-ups drop when hit while the mummy stays up and reports every hit, the quest's tomb is a wall
// while shut and, open, catches a ball at its mouth at any speed, holds it just in front of its door and kicks it out
// to a flipper, one ball at a time and not one it has just kicked out, never shuts on a ball and never holds one the
// lock or a saucer has (nor they its), the quest's diverter (a gate on the left ramp, over a gap in its rail) at rest
// leaves the ramp running as before and swung over sends balls going up it into the lock, a ball leaving the ramp only
// through the gap, swinging at its own slow speed, never into a ball, and never over while a ball is on its ramp or in
// the dish above it, the toys' bits say what's open and over (and a table with no diverter has no gate to swing), the
// switches with no art each see a ball that passes them once (an orbit shot its own lane's going up, a launch only the
// left one's going down, a shot into the dish the dish's, a ball the gate turns out the gate's) and no other ball, and
// the snapshot is the 47-byte header (type, time, ball count, the three flippers' angles, the lit bits, the targets
// down and turned, both spinners' angles, the toys' bits) then each ball's body; a ball's owner is in its state, not
// the snapshot.
// (The pathways round the table are pinball-layout-test's.)
// Usage: npm run pinball-sim-test (or npx tsx tests/pinball-sim-test.ts)
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { initPhysics } from '@kit/server';
import { SNAP_STRIDE } from '@kit/shared';
import { DT, LOCK_IGNORE, LOCK_KICK, PinballSim, WALL_HALF, type Hit } from '../src/server/sim';
import { SNAP_PINBALL_HEADER, SNAP_TYPE_PINBALL, TOY } from '../src/shared/pinball';
import { TABLE_IN_USE, TABLE, isLockTarget, type Table, type Target } from '../src/shared/table';

await initPhysics();

// The same run every time: Math.random seeded with the claw's tests' generator (16807), so a failing shot can be run
// again to look into.
let seed = 1;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const rand = (lo: number, hi: number) => lo + (hi - lo) * Math.random();

const R = TABLE.ballRadius;

/** A sim on the table in use (the pyramid table), and every hit it reports. */
function make(table: Table = TABLE_IN_USE): { sim: PinballSim; hits: Hit[] } {
  const hits: Hit[] = [];
  return { sim: new PinballSim(table, (hit) => hits.push(hit)), hits };
}

/** A ball put down at (x, z) on the playfield moving at (vx, vz), as a launch then moved there. */
function place(sim: PinballSim, x: number, z: number, vx = 0, vz = 0): number {
  const id = sim.launch(null);
  const body = sim.items.get(id)!.body;
  body.setTranslation({ x, y: R, z }, true);
  body.setLinvel({ x: vx, y: 0, z: vz }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  return id;
}

/**
 * Has ball `id` touch the part `partId` now, through the sim's own touch path (as a contact in a substep would). For
 * flip targets, the mummy and other parts that act in touch itself: it passes touch an empty to-drop list that nothing
 * reads, so a drop target touched this way reports but never drops.
 */
function touch(sim: PinballSim, id: number, partId: string): void {
  const spec = TABLE_IN_USE.targets.find((t) => t.id === partId);
  assert.ok(!spec || spec.flip || spec.rise === 'hold', `touch() is for flip targets and the mummy, not the drop target ${partId}`);
  touchWhere(sim, id, (p) => p.id === partId, partId);
}

/**
 * Has ball `id` touch the first part `which` picks (`what`, to say so if there's none), now, through the sim's own
 * touch path, as touch() does: for the parts with no id (the lock, the saucers, the tomb's mouth).
 */
function touchWhere(sim: PinballSim, id: number, which: (part: any) => boolean, what = 'such'): void {
  const S = sim as any;
  const part = [...S.parts.values()].find(which);
  assert.ok(part, `no part ${what}`);
  S.touch(S.items.get(id), part, sim.time, []);
}

/** A slow ball rolled down into the Scarab saucer, stepped until the saucer holds it; returns its id. */
function intoSaucer(sim: PinballSim): number {
  const sc = TABLE_IN_USE.saucers.find((s) => s.id === 'saucer-scarab')!;
  const id = place(sim, sc.x, sc.z + 1.3, 0, -1.5);
  for (let i = 0; i < 2 / DT && sim.heldBy(id) !== 'saucer'; i++) sim.step();
  assert.equal(sim.heldBy(id), 'saucer', 'the saucer never caught the ball');
  return id;
}

const TOMB = TABLE_IN_USE.tomb!;
/**
 * The tomb's mouth: its two ends, `width` apart on the line z = tomb.z (table-test holds them to where the pyramid's
 * faces cross that line).
 */
const MOUTH: [number, number][] = [[TOMB.x - TOMB.width / 2, TOMB.z], [TOMB.x + TOMB.width / 2, TOMB.z]];

/**
 * A ball rolled up the centre lane at the tomb's mouth from below at `speed`, already rolling (so none of its speed
 * goes into getting it to roll): by default fast enough to pass over the magnet below the tomb, which holds a ball
 * under 12 units/s. Returns its id.
 */
function rollAtTomb(sim: PinballSim, speed = 16): number {
  const id = place(sim, TOMB.x, 3.6, 0, speed);
  sim.items.get(id)!.body.setAngvel({ x: speed / R, y: 0, z: 0 }, true);
  return id;
}

/** A ball rolled into the tomb, opened, and stepped until the tomb holds it; returns its id. */
function intoTomb(sim: PinballSim): number {
  sim.openTomb();
  const id = rollAtTomb(sim);
  for (let i = 0; i < 1 / DT && sim.heldBy(id) !== 'tomb'; i++) sim.step();
  assert.equal(sim.heldBy(id), 'tomb', 'the tomb never caught the ball');
  return id;
}

/** The angle in degrees between a ball's velocity on the playfield and the direction (dx, dz). */
function offBy(sim: PinballSim, id: number, [dx, dz]: [number, number]): number {
  const v = sim.items.get(id)!.body.linvel();
  const cos = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz));
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

const GATE = TABLE_IN_USE.diverter!;
const GATE_RAMP = TABLE_IN_USE.ramps.find((r) => r.id === GATE.ramp)!;
const GAP = GATE_RAMP.opening!;
const DISH = TABLE_IN_USE.dishes[0];
/** Which way round the gate swings over: 1 is the table's way round (x toward z), -1 the other. */
const WAY = Math.sign(GATE.overDeg - GATE.restDeg);
/** The unit vector at a table angle (degrees, x toward z). */
const dirOf = (deg: number): [number, number] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
/** The sim's gate: its angle now (degrees) and the height it stands at (its ramp's floor at its pivot). */
const gateOf = (sim: PinballSim): { angle: number; y: number } => (sim as any).diverter;

/** A ball let go at (x, y, z), up off the playfield (in the dish, or on a ramp), moving at (vx, vz). */
function dropAt(sim: PinballSim, x: number, y: number, z: number, vx = 0, vz = 0): number {
  const id = place(sim, x, z, vx, vz);
  sim.items.get(id)!.body.setTranslation({ x, y, z }, true);
  return id;
}

/** Where (x, z) is beside the gate's ramp: its nearest centre-line segment, how far east of it, and the floor there. */
function besideRamp(x: number, z: number): { i: number; east: number; floor: number } {
  const P = GATE_RAMP.path;
  let best = { i: 0, east: 0, floor: 0, d: Infinity };
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, az, ay] = P[i], [bx, bz, by] = P[i + 1];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (l * l)));
    const d = Math.hypot(x - ax - u * dx, z - az - u * dz);
    if (d < best.d) best = { i, east: ((x - ax) * dz - (z - az) * dx) / l, floor: ay + u * (by - ay), d };
  }
  return best;
}
/**
 * Ball n of `count` rolled up the gate's ramp from its middle (path point 8), at 12 to 26 units/s, across the strip a
 * ball's centre has between its rails and heading up it or up to 6 degrees either side, rolling: evenly spread rather
 * than random, so the check runs the same whatever the checks before it drew. Returns its id.
 */
function upTheRamp(sim: PinballSim, n: number, count: number): number {
  const [ax, az, ay] = GATE_RAMP.path[8], [bx, bz] = GATE_RAMP.path[9];
  const l = Math.hypot(bx - ax, bz - az), [ux, uz] = [(bx - ax) / l, (bz - az) / l];
  const across = 0.24 * (((7 * n) % count) / (count - 1) - 0.5), v = 12 + (14 * n) / (count - 1);
  const turn = (6 * Math.PI) / 180 * (((3 * n) % count) / (count - 1) * 2 - 1);
  const [vx, vz] = [v * (ux * Math.cos(turn) - uz * Math.sin(turn)), v * (ux * Math.sin(turn) + uz * Math.cos(turn))];
  const id = dropAt(sim, ax + across * uz, ay + R + 0.005, az - across * ux, vx, vz);
  sim.items.get(id)!.body.setAngvel({ x: vz / R, y: 0, z: -vx / R }, true);
  return id;
}
/**
 * Follows ball `id`, up the gate's ramp, until it leaves the ramp (or `seconds` pass), and says where it left: 'the
 * opening' (off the ramp's east edge beside the gap in its rail), 'its mouth' (back down to the playfield at its foot),
 * 'the dish' (up on the dish's floor at its top), or anywhere else; and whether it went into the lock by `seconds`.
 */
function leaving(sim: PinballSim, hits: Hit[], id: number, seconds: number): { left: string; lock: boolean } {
  let left = '';
  for (let k = 0; k < seconds / DT && sim.items.has(id); k++) {
    sim.step();
    const p = sim.items.get(id)?.body.translation();
    if (!p || left) continue;
    const w = besideRamp(p.x, p.z);
    if (p.y > DISH.y + R - 0.05 && Math.hypot(p.x - DISH.x, p.z - DISH.z) < DISH.r) left = 'the dish';
    else if (w.floor < 0.05) left = 'its mouth';
    else if (Math.abs(w.east) > GATE_RAMP.width / 2 || p.y < w.floor + R - 0.15) {
      left = w.east > GATE_RAMP.width / 2 - 0.05 && w.i >= GAP.from && w.i < GAP.to ? 'the opening' : `elsewhere (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
    }
  }
  return { left, lock: hits.some((h) => h.kind === 'lock' && h.ball === id) };
}

/** A switch's hit, and which way up the table the ball was going as it came (as the game reads it, by its velocity). */
type Pass = { id: string; ball: number; up: boolean };
/** A sim on the table in use, its hits, and its switches' hits as passes. */
function withPasses(): { sim: PinballSim; hits: Hit[]; passes: Pass[] } {
  const hits: Hit[] = [];
  const passes: Pass[] = [];
  const sim: PinballSim = new PinballSim(TABLE_IN_USE, (hit) => {
    hits.push(hit);
    if (hit.kind === 'switch') passes.push({ id: hit.id, ball: hit.ball, up: sim.items.get(hit.ball)!.body.linvel().z > 0 });
  });
  return { sim, hits, passes };
}
/** Ball `id`'s passes in order, each as its switch and its way: 'orbit-left up'. */
const passesOf = (passes: Pass[], id: number) => passes.filter((p) => p.ball === id).map((p) => `${p.id} ${p.up ? 'up' : 'down'}`);
/** A seeded generator of a check's own for its spots, so it runs the same whatever the checks before it drew. */
function spotsFrom(start: number): () => number {
  let s = start;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
/** Whether p is inside a closed outline (its last point back at, or joined to, its first). */
function insideOutline(p: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** How far (x, z) is from the left ramp's centre line. */
function fromLeftRamp(x: number, z: number): number {
  const P = GATE_RAMP.path;
  let best = Infinity;
  for (let i = 0; i + 1 < P.length; i++) best = Math.min(best, segDist([x, z], [P[i][0], P[i][1]], [P[i + 1][0], P[i + 1][1]]));
  return best;
}

const targetIndex = (id: string) => TABLE_IN_USE.targets.findIndex((t) => t.id === id);
/** The rising targets (the pop-ups and the mummy) start down: their bits in a fresh sim's targetsDown(). */
const RISING = TABLE_IN_USE.targets.reduce((bits, t, i) => (t.rise ? bits | (1 << i) : bits), 0);

/** The unit normal of a target's face on the side toward the flippers' middle, the side the stage stands it. */
function faceNormal(g: Target): [number, number] {
  const a = ((g.angle ?? 0) * Math.PI) / 180;
  const [nx, nz] = [-Math.sin(a), Math.cos(a)];
  return nx * (-0.4 - g.x) + nz * (2 - g.z) < 0 ? [-nx, -nz] : [nx, nz];
}
/**
 * A ball put `from` in front of target `g` and rolled square at its face at `speed`: a new ball, or ball `again` rolled
 * once more. Returns its id.
 */
function rollAt(sim: PinballSim, g: Target, { from = 0.6, speed = 9, again }: { from?: number; speed?: number; again?: number } = {}): number {
  const [nx, nz] = faceNormal(g);
  const [x, z] = [g.x + from * nx, g.z + from * nz];
  if (again === undefined) return place(sim, x, z, -speed * nx, -speed * nz);
  const body = sim.items.get(again)!.body;
  body.setTranslation({ x, y: R, z }, true);
  body.setLinvel({ x: -speed * nx, y: 0, z: -speed * nz }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  return again;
}

const speedOf = (sim: PinballSim, id: number) => {
  const v = sim.items.get(id)!.body.linvel();
  return Math.hypot(v.x, v.y, v.z);
};

/** The distance from p to the segment a-b, in (x, z). */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Whether p is inside the outer wall (closed along the bottom). */
function insideOuter(p: [number, number], t: Table): boolean {
  const poly = t.walls[0].points;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a ball fits at p, clear of every wall, bumper, sling, target and flipper (with room to spare). */
function clearSpot(p: [number, number], t: Table): boolean {
  if (!insideOuter(p, t)) return false;
  const room = R + 0.2;
  for (const w of t.walls) for (let i = 0; i + 1 < w.points.length; i++) if (segDist(p, w.points[i], w.points[i + 1]) < room) return false;
  for (const b of t.bumpers) if (Math.hypot(p[0] - b.x, p[1] - b.z) < b.radius + room) return false;
  for (const s of t.slings) if (segDist(p, s.a, s.b) < room) return false;
  for (const g of t.targets) if (Math.hypot(p[0] - g.x, p[1] - g.z) < g.width / 2 + room) return false;
  for (const f of t.flippers) if (Math.hypot(p[0] - f.pivot[0], p[1] - f.pivot[1]) < f.length + room) return false;
  return true;
}

const checks: [string, () => void][] = [
  ['a launched ball goes up the plunger lane and onto the table', () => {
    const { sim } = make();
    const id = sim.launch(7);
    assert.equal(sim.items.get(id)!.owner, 7);
    let top = -Infinity;
    for (let i = 0; i < 2 / DT; i++) {
      sim.step();
      const ball = sim.items.get(id);
      if (ball) top = Math.max(top, ball.body.translation().z);
    }
    assert.ok(top > 15, `the launched ball got only to z ${top.toFixed(2)}`);
  }],
  ['no ball escapes the table', () => {
    const { sim, hits } = make();
    const t = TABLE_IN_USE;
    const aims: [number, number][] = [];
    for (const w of t.walls) for (const p of w.points) aims.push(p);
    for (const f of t.flippers) aims.push(f.pivot, [f.pivot[0] + Math.cos((f.restDeg * Math.PI) / 180), f.pivot[1] + Math.sin((f.restDeg * Math.PI) / 180)]);
    let escaped = 0, drained = 0;
    const first: string[] = [];
    for (let shot = 0; shot < 2000; shot++) {
      sim.clear();
      sim.resetTargets();
      let p: [number, number];
      do p = [rand(-4.9, 4.9), rand(0.4, TABLE.length - 0.4)]; while (!clearSpot(p, t));
      // Half the shots are aimed at a wall's corner or a flipper; the rest go any way.
      let angle: number;
      if (shot % 2 === 0) {
        const [ax, az] = aims[Math.floor(Math.random() * aims.length)];
        angle = Math.atan2(az - p[1], ax - p[0]);
      } else angle = rand(0, 2 * Math.PI);
      const speed = rand(5, 60);
      const id = place(sim, p[0], p[1], speed * Math.cos(angle), speed * Math.sin(angle));
      const up = { left: Math.random() < 0.5, right: Math.random() < 0.5 };
      hits.length = 0;
      for (let i = 0; i < 3 / DT; i++) {
        // The flippers flap now and then through the shot.
        for (const side of ['left', 'right'] as const) {
          if (Math.random() < 0.05) {
            up[side] = !up[side];
            sim.flip(side, up[side]);
          }
        }
        sim.step();
        const ball = sim.items.get(id);
        if (!ball) break;
        const at = ball.body.translation();
        if (Math.abs(at.x) > 5.2 || at.z < -1 || at.z > TABLE.length + 0.5 || at.y < 0 || at.y > TABLE.glassY) {
          escaped++;
          if (first.length < 5) first.push(`shot ${shot} from (${p.map((v) => v.toFixed(2))}) at ${speed.toFixed(1)} u/s, ${((angle * 180) / Math.PI).toFixed(0)} deg: at (${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)})`);
          sim.remove(id);
          break;
        }
      }
      if (hits.some((h) => h.kind === 'drain' && h.ball === id)) drained++;
    }
    assert.equal(escaped, 0, `${escaped} of 2000 shots got out:\n${first.join('\n')}`);
    // Some shots drain, and those are no escape.
    assert.ok(drained > 0, 'no shot drained at all');
  }],
  ['a ball left alone always drains', () => {
    const { sim, hits } = make();
    const late: string[] = [];
    for (let n = 0; n < 50; n++) {
      sim.clear();
      hits.length = 0;
      const id = sim.launch(null);
      let steps = 0;
      while (!hits.some((h) => h.kind === 'drain' && h.ball === id) && steps < 60 / DT) {
        sim.step();
        steps++;
      }
      if (sim.items.has(id)) {
        const at = sim.items.get(id)!.body.translation();
        late.push(`launch ${n} still at (${at.x.toFixed(2)}, ${at.z.toFixed(2)}) after 60 s`);
      }
    }
    assert.deepEqual(late, []);
  }],
  ["the right flipper's shots reach the upper table", () => {
    // The right flipper: on the pyramid table its shots go up the left ramp and round the left orbit, over z 12 (the pop
    // bumpers' level, as on the stand-in table); the left flipper's go round the right orbit (the next check).
    const flipper = TABLE_IN_USE.flippers.find((f) => f.side === 'right')!;
    const tops: number[] = [];
    for (let n = 0; n < 10; n++) {
      const { sim } = make();
      // The flipper up, and a ball dropped onto it: it rolls down to the flipper's base and sits there.
      sim.flip('right', true);
      const id = place(sim, flipper.pivot[0] - rand(0.5, 1.3), flipper.pivot[1] + rand(1.6, 2.4));
      for (let i = 0; i < 1.5 / DT; i++) sim.step();
      // Let go: the ball rolls down the flipper toward its tip; flip when it's between the flipper's middle and its tip,
      // as a player does (a ball still at the base goes up slow and straight, into bumper-3: a weak shot on any table).
      sim.flip('right', false);
      const at = rand(0.5, 0.95) * flipper.length;
      const along = () => {
        const p = sim.items.get(id)!.body.translation();
        const a = (sim.flipperAngle('right') * Math.PI) / 180;
        return (p.x - flipper.pivot[0]) * Math.cos(a) + (p.z - flipper.pivot[1]) * Math.sin(a);
      };
      for (let i = 0; i < 2 / DT && sim.items.has(id) && along() < at; i++) sim.step();
      assert.ok(sim.items.has(id), `drop ${n}: the ball drained before the flip`);
      sim.flip('right', true);
      let top = -Infinity;
      for (let i = 0; i < 2 / DT; i++) {
        sim.step();
        const ball = sim.items.get(id);
        if (!ball) break;
        top = Math.max(top, ball.body.translation().z);
      }
      tops.push(top);
    }
    const reached = tops.filter((z) => z > 12).length;
    assert.ok(reached >= 6, `only ${reached} of 10 shots got past z 12: ${tops.map((z) => z.toFixed(1)).join(', ')}`);
  }],
  ["the left flipper's shots reach the upper table, and the drop targets", () => {
    // The left flipper's most common shot (the ball flipped two thirds of the way along) goes round the right orbit to
    // the upper table, as the right flipper's goes round the left; its steeper ones hit the drop targets right of the
    // pyramid. Ten drops onto it, the same kind as the right flipper's but fixed (evenly spread over the drop spots and
    // the flip points; measured 2026-10-18: 6 of these 10 past z 12, 2 more on a drop target, 1 the sling, and the last
    // drop misses the flipper).
    const flipper = TABLE_IN_USE.flippers.find((f) => f.side === 'left')!;
    const drops = TABLE_IN_USE.targets.filter(isLockTarget).map((t) => t.id);
    const results: string[] = [];
    let up = 0, onDrop = 0;
    for (let n = 0; n < 10; n++) {
      const { sim, hits } = make();
      sim.flip('left', true);
      const id = place(sim, flipper.pivot[0] + 0.5 + (0.8 * n) / 9, flipper.pivot[1] + 1.6 + (0.8 * ((7 * n) % 10)) / 9);
      for (let i = 0; i < 1.5 / DT; i++) sim.step();
      sim.flip('left', false);
      const at = (0.5 + (0.45 * ((3 * n) % 10)) / 9) * flipper.length;
      const along = () => {
        const p = sim.items.get(id)!.body.translation();
        const a = (sim.flipperAngle('left') * Math.PI) / 180;
        return (p.x - flipper.pivot[0]) * Math.cos(a) + (p.z - flipper.pivot[1]) * Math.sin(a);
      };
      for (let i = 0; i < 2 / DT && sim.items.has(id) && along() < at; i++) sim.step();
      assert.ok(sim.items.has(id), `drop ${n}: the ball drained before the flip`);
      hits.length = 0;
      sim.flip('left', true);
      let top = -Infinity;
      for (let i = 0; i < 2 / DT && sim.items.has(id); i++) {
        sim.step();
        const ball = sim.items.get(id);
        if (ball) top = Math.max(top, ball.body.translation().z);
      }
      const drop = hits.some((h) => h.ball === id && drops.includes(h.id));
      if (top > 12) up++;
      else if (drop) onDrop++;
      results.push(top > 12 ? `up (${top.toFixed(1)})` : drop ? 'drop target' : `${top.toFixed(1)}`);
    }
    assert.ok(up >= 6, `only ${up} of 10 shots got past z 12: ${results.join(', ')}`);
    assert.ok(up + onDrop >= 8, `only ${up + onDrop} of 10 shots got past z 12 or hit a drop target: ${results.join(', ')}`);
  }],
  ['a bumper kicks and reports', () => {
    const { sim, hits } = make();
    const b = TABLE_IN_USE.bumpers[0];
    const id = place(sim, b.x - 1.5, b.z + 0.1, 6, 0);
    let before = 0, after = 0;
    for (let i = 0; i < 1 / DT; i++) {
      const s = speedOf(sim, id);
      sim.step();
      if (hits.some((h) => h.kind === 'bumper')) {
        before = s;
        sim.step();
        after = speedOf(sim, id);
        break;
      }
    }
    const hit = hits.find((h) => h.kind === 'bumper');
    assert.ok(hit, 'no bumper hit');
    assert.deepEqual(hit, { kind: 'bumper', id: b.id, ball: id });
    assert.ok(after > before, `speed ${before.toFixed(2)} before, ${after.toFixed(2)} after`);
  }],
  ['the kickback fires a ball back up, when the game says', () => {
    const { sim, hits } = make();
    const k = TABLE_IN_USE.kickback;
    // Down the right outlane (x 3.72) onto the kickback.
    const id = place(sim, k.x, k.z + 2, 0, -3);
    for (let i = 0; i < 1 / DT && !hits.some((h) => h.kind === 'kickback'); i++) sim.step();
    assert.deepEqual(hits.find((h) => h.kind === 'kickback'), { kind: 'kickback', id: 'kickback', ball: id });
    sim.kickback(id);
    let top = -Infinity;
    for (let i = 0; i < 1.5 / DT; i++) {
      sim.step();
      const ball = sim.items.get(id);
      if (ball) top = Math.max(top, ball.body.translation().z);
    }
    assert.ok(top > 8, `the kickback got the ball only to z ${top.toFixed(2)}`);
  }],
  ['the lock reports, holds and lets go', () => {
    const { sim, hits } = make();
    const l = TABLE_IN_USE.lock;
    const id = place(sim, l.x, l.z + 1.2, 0, -2);
    for (let i = 0; i < 1 / DT && !hits.some((h) => h.kind === 'lock'); i++) sim.step();
    assert.deepEqual(hits.find((h) => h.kind === 'lock'), { kind: 'lock', id: 'lock', ball: id });
    sim.holdInLock(id);
    for (let i = 0; i < 2 / DT; i++) sim.step();
    const held = sim.items.get(id)!.body.translation();
    assert.ok(Math.hypot(held.x - l.x, held.z - l.z) < 0.05, 'the held ball sits in the lock');
    sim.release(id);
    for (let i = 0; i < 1 / DT; i++) sim.step();
    const gone = sim.items.get(id)?.body.translation();
    assert.ok(!gone || Math.hypot(gone.x - l.x, gone.z - l.z) > 1, 'the released ball left the lock');
  }],
  ['the full lock kicks a second ball out along its kick, and never holds it', () => {
    const l = TABLE_IN_USE.lock;
    const [kx, kz] = LOCK_KICK.dir;
    const k = Math.hypot(kx, kz);
    /** Where the kicked ball is put: a ball's width and 0.02 out from the held ball's middle, along the kick. */
    const spot: [number, number] = [l.x + ((2 * R + 0.02) * kx) / k, l.z + ((2 * R + 0.02) * kz) / k];
    /** Whether ball `id` is where the kick puts a ball, as a step that kicked it ends (it has moved off a little). */
    const atSpot = (sim: PinballSim, id: number) => {
      const p = sim.items.get(id)!.body.translation();
      return Math.hypot(p.x - spot[0], p.z - spot[1]) < LOCK_KICK.speed * DT + 0.02;
    };
    /** A table with a ball held in the lock as multiball holds it, and a second rolled down onto it from up the table. */
    const full = () => {
      const { sim, hits } = make();
      const held = place(sim, l.x, l.z);
      sim.holdInLock(held);
      const id = place(sim, l.x, l.z + 1.2, 0, -2);
      return { sim, hits, held, id };
    };
    /** Steps until ball `id`'s touch of the lock is reported (at most 1 s). */
    const untilTouch = (sim: PinballSim, hits: Hit[], id: number, each = () => {}) => {
      for (let i = 0; i < 1 / DT && !hits.some((h) => h.kind === 'lock' && h.ball === id); i++) {
        each();
        sim.step();
      }
      assert.ok(hits.some((h) => h.kind === 'lock' && h.ball === id), 'the second ball reached the lock');
    };
    {
      // The kick's start is clear of every solid by 0.02 (as the tomb's held spot is): no ball is put into a wall.
      const { sim } = make();
      sim.step(); // Rapier's queries see the table's colliders once the world has stepped.
      const found: RAPIER.Collider[] = [];
      (sim as any).world.intersectionsWithShape({ x: spot[0], y: R, z: spot[1] }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Cylinder(0.1, R + 0.02 - 1e-4), (c: RAPIER.Collider) => {
        found.push(c);
        return true;
      }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      assert.deepEqual(found.map((c) => c.handle), [], 'where the kick puts a ball, it is 0.02 clear of everything');
    }
    {
      // Its touch is the lock's hit as ever (the game, in multiball while the lock holds a ball, does nothing with it).
      // In the same step it is put beside the held ball and kicked along LOCK_KICK, and it gets away down the table,
      // never held, while the lock keeps its ball.
      const { sim, hits, held, id } = full();
      untilTouch(sim, hits, id);
      assert.deepEqual(hits.filter((h) => h.kind === 'lock'), [{ kind: 'lock', id: 'lock', ball: id }], "its touch is the lock's hit");
      assert.equal(sim.heldBy(id), null, 'not held');
      assert.ok(atSpot(sim, id), 'kicked from beside the held ball');
      const off = offBy(sim, id, LOCK_KICK.dir);
      assert.ok(off < 5, `along the lock's kick (${off.toFixed(1)} degrees off it)`);
      assert.ok(Math.abs(speedOf(sim, id) - LOCK_KICK.speed) < 0.5, `at its speed (${speedOf(sim, id).toFixed(2)} units/s)`);
      for (let i = 0; i < 2 / DT && sim.items.has(id); i++) {
        sim.step();
        assert.equal(sim.heldBy(id), null, `never held (${sim.time.toFixed(2)} s)`);
      }
      const p = sim.items.get(id)?.body.translation();
      assert.ok(!p || Math.hypot(p.x - l.x, p.z - l.z) > 2, 'it got away from the lock');
      assert.equal(sim.heldBy(held), 'lock', 'and the lock keeps its ball');
      assert.equal(hits.filter((h) => h.kind === 'lock').length, 1, 'touched once');
    }
    {
      // Kept against the held ball in the lock's sensor (put back each step), the kicked ball is ignored there for
      // LOCK_IGNORE from its kick, as a released one is, and then kicked out again: so one that came back to rest
      // against the held ball would not stay.
      const { sim, hits, id } = full();
      untilTouch(sim, hits, id);
      // The kick came in the step just taken, on its start's clock.
      const until = sim.time - DT + LOCK_IGNORE;
      const body = sim.items.get(id)!.body;
      const back: [number, number] = [l.x - ((2 * R + 0.01) * kx) / k, l.z - ((2 * R + 0.01) * kz) / k];
      const park = () => {
        body.setTranslation({ x: back[0], y: R, z: back[1] }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      };
      let again = -1;
      for (let i = 0; i < 2 / DT && again < 0; i++) {
        park();
        const start = sim.time;
        sim.step();
        if (atSpot(sim, id)) again = start;
      }
      assert.ok(again >= until - 1e-6 && again < until + DT + 1e-6, `kicked again in the step from ${again.toFixed(3)} s, when its ignore was up (${until.toFixed(3)} s)`);
      assert.equal(sim.heldBy(id), null, 'and never held');
    }
    {
      // Not while another ball stands where the kicked one would be put: the second waits against the held ball, and
      // goes as soon as that ball has gone.
      const { sim, hits, id } = full();
      const third = place(sim, spot[0], spot[1]);
      const keep = () => {
        const body = sim.items.get(third)!.body;
        body.setTranslation({ x: spot[0], y: R, z: spot[1] }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      };
      untilTouch(sim, hits, id, keep);
      for (let i = 0; i < 0.5 / DT; i++) {
        keep();
        sim.step();
      }
      const p = sim.items.get(id)!.body.translation();
      assert.ok(Math.hypot(p.x - l.x, p.z - l.z) < l.radius + R, 'with the spot taken, it is still at the lock');
      sim.remove(third);
      sim.step();
      assert.ok(atSpot(sim, id) && offBy(sim, id, LOCK_KICK.dir) < 5, 'with the spot clear, it is kicked at once');
      assert.equal(sim.heldBy(id), null);
    }
    {
      // The lock empty, a ball's touch is only the lock's hit: no kick (the game holds the ball, if the lock is lit).
      const { sim, hits } = make();
      const id = place(sim, l.x, l.z + 1.2, 0, -2);
      untilTouch(sim, hits, id);
      assert.ok(!atSpot(sim, id) && speedOf(sim, id) < LOCK_KICK.speed - 1, 'not kicked');
    }
  }],
  ['a hit handler can take balls off mid-step: two drains together, cleared on the first', () => {
    const hits: Hit[] = [];
    const sim: PinballSim = new PinballSim(TABLE_IN_USE, (hit) => {
      hits.push(hit);
      if (hit.kind === 'drain') sim.clear();
    });
    // Two balls side by side between the flippers, falling into the drain in the same substep.
    const a = place(sim, -0.7, 0.4, 0, -8);
    const b = place(sim, -0.7 + 2.2 * R, 0.4, 0, -8);
    assert.doesNotThrow(() => {
      for (let i = 0; i < 30; i++) sim.step();
    });
    const drains = hits.filter((h) => h.kind === 'drain').map((h) => h.ball);
    assert.ok(drains.length >= 1 && drains.every((id) => id === a || id === b), `drains: ${drains}`);
    assert.equal(sim.items.size, 0);
  }],
  ['a hit handler can take balls off mid-step: a bumper hit clears the table', () => {
    let bumped = 0;
    const sim: PinballSim = new PinballSim(TABLE_IN_USE, (hit) => {
      if (hit.kind === 'bumper') {
        bumped++;
        sim.clear();
      }
    });
    const bp = TABLE_IN_USE.bumpers[0];
    place(sim, bp.x - 1.5, bp.z + 0.1, 6, 0);
    // Another ball on the table at the same time.
    place(sim, -0.4, 6, 0, 0);
    assert.doesNotThrow(() => {
      for (let i = 0; i < 60; i++) sim.step();
    });
    assert.equal(bumped, 1);
    assert.equal(sim.items.size, 0);
  }],
  ['flip targets turn and stay up; resetDropTargets raises only the drop targets', () => {
    const { sim, hits } = make();
    // The scarab drop target, right of the pyramid and facing the left flipper: a ball rolled square at its front (the
    // side toward the flippers' middle, as the stage and the picture stand it).
    const drop = TABLE_IN_USE.targets[targetIndex('target-scarab')];
    const shot = rollAt(sim, drop);
    for (let i = 0; i < 0.4 / DT && !hits.some((h) => h.id === drop.id); i++) sim.step();
    const plaque = TABLE_IN_USE.targets.find((t) => t.flip)!;
    const id = place(sim, -0.4, 3, 0, 0);
    touch(sim, id, plaque.id);
    sim.step();
    assert.ok(hits.some((h) => h.kind === 'target' && h.id === drop.id && h.ball === shot), 'the drop target reported');
    assert.ok(hits.some((h) => h.kind === 'target' && h.id === plaque.id && h.ball === id), 'the plaque reported');
    // (The rising targets stand down all along: their bits are set in every sim, and not this check's.)
    assert.equal(sim.targetsDown(), (1 << targetIndex(drop.id)) | RISING, 'the drop target is down');
    assert.equal(sim.targetsTurned(), 1 << targetIndex(plaque.id), 'the plaque is turned, and not down');
    sim.resetDropTargets();
    assert.equal(sim.targetsDown(), RISING, 'resetDropTargets raises the drop target and leaves the rising ones down');
    assert.equal(sim.targetsTurned(), 1 << targetIndex(plaque.id), 'resetDropTargets leaves the plaques');
    sim.resetTargets();
    assert.equal(sim.targetsTurned(), 0, 'resetTargets turns the plaques back too');
  }],
  ['the pop-ups and the mummy start down, rise when raised, and the pop-ups drop when hit', () => {
    const rising = ['target-popup-1', 'target-popup-2', 'target-popup-3', 'target-mummy'];
    const bit = (id: string) => 1 << targetIndex(id);
    {
      // A fresh sim has all four down; raising each clears its bit.
      const { sim } = make();
      assert.equal(sim.targetsDown(), rising.reduce((bits, id) => bits | bit(id), 0), 'all four start down');
      for (const id of rising) {
        assert.equal(sim.raiseTarget(id), true, `${id} rises`);
        assert.equal(sim.targetsDown() & bit(id), 0, `${id}'s bit clears`);
      }
      assert.equal(sim.targetsDown(), 0, 'all four up');
    }
    for (const id of rising.slice(0, 3)) {
      const g = TABLE_IN_USE.targets[targetIndex(id)];
      {
        // Down, it is no wall: a ball rolled at it goes through its place, and nothing is reported.
        const { sim, hits } = make();
        const [nx, nz] = faceNormal(g);
        const ball = rollAt(sim, g);
        for (let i = 0; i < 0.25 / DT; i++) sim.step();
        const p = sim.items.get(ball)!.body.translation();
        assert.ok((p.x - g.x) * nx + (p.z - g.z) * nz < -0.3, `${id} down: the ball went through its place`);
        assert.deepEqual(hits.filter((h) => h.id === id), [], `${id} down: nothing to hit`);
      }
      // Raised, a ball rolled square at its face drops it and reports the one hit.
      const { sim, hits } = make();
      assert.equal(sim.raiseTarget(id), true);
      const shot = rollAt(sim, g);
      for (let i = 0; i < 0.4 / DT && !(sim.targetsDown() & bit(id)); i++) sim.step();
      assert.equal(sim.targetsDown() & bit(id), bit(id), `${id} dropped`);
      assert.deepEqual(hits.filter((h) => h.id === id), [{ kind: 'target', id, ball: shot }], `${id}: one hit`);
      assert.equal(sim.targetsTurned(), 0, `${id} drops, it does not turn`);
      // Dropped, it is no wall again, and it reports nothing more.
      for (let i = 0; i < 0.3 / DT; i++) sim.step();
      assert.equal(hits.filter((h) => h.id === id).length, 1, `${id} reports once`);
    }
  }],
  ['the mummy stays up when hit and reports every hit, a cool-down apart', () => {
    const { sim, hits } = make();
    const mummy = TABLE_IN_USE.targets[targetIndex('target-mummy')];
    const bit = 1 << targetIndex(mummy.id);
    const mummyHits = () => hits.filter((h) => h.kind === 'target' && h.id === mummy.id);
    assert.equal(sim.raiseTarget(mummy.id), true);
    // A ball rolled at it twice, the second roll a cool-down after the first: two hits, and it stands there, up.
    const ball = rollAt(sim, mummy);
    for (let i = 0; i < 0.6 / DT && mummyHits().length < 1; i++) sim.step();
    assert.equal(mummyHits().length, 1, 'the first roll hit it');
    // Its wall is as thick as its depth (0.3, half of it each side of its face): the ball met it a ball's radius and
    // 0.15 out, where a wall of the usual 0.2 is met 0.37 out.
    const [fx, fz] = faceNormal(mummy);
    const first = sim.items.get(ball)!.body.translation();
    assert.ok((first.x - mummy.x) * fx + (first.z - mummy.z) * fz > 0.41, 'the mummy is 0.3 thick');
    assert.equal(sim.targetsDown() & bit, 0, 'still up after the first');
    for (let i = 0; i < 0.15 / DT; i++) sim.step();
    rollAt(sim, mummy, { again: ball });
    for (let i = 0; i < 0.6 / DT && mummyHits().length < 2; i++) sim.step();
    assert.deepEqual(mummyHits(), [{ kind: 'target', id: mummy.id, ball }, { kind: 'target', id: mummy.id, ball }], 'the second roll hit it too');
    assert.equal(sim.targetsDown() & bit, 0, 'still up after the second');
    assert.equal(sim.targetsTurned() & bit, 0, 'and it never turns');
    // The bumpers' cool-down: two touches in one moment are one hit, a touch a cool-down later another.
    const held = place(sim, -0.4, 9.5);
    sim.holdInLock(held);
    const before = mummyHits().length;
    touch(sim, held, mummy.id);
    touch(sim, held, mummy.id);
    sim.step();
    assert.equal(mummyHits().length - before, 1, 'two touches inside the cool-down are one hit');
    for (let i = 0; i < 0.2 / DT; i++) sim.step();
    touch(sim, held, mummy.id);
    sim.step();
    assert.equal(mummyHits().length - before, 2, 'a touch after the cool-down is another');
    assert.equal(sim.targetsDown() & bit, 0, 'up all along');
    // Lowered, it is down (its collider off): lowerTarget sets its bit, and a ball rolled at it goes through.
    sim.lowerTarget(mummy.id);
    assert.equal(sim.targetsDown() & bit, bit, 'lowerTarget puts it down');
    const count = mummyHits().length;
    const [nx, nz] = faceNormal(mummy);
    const through = rollAt(sim, mummy);
    for (let i = 0; i < 0.25 / DT; i++) sim.step();
    const p = sim.items.get(through)!.body.translation();
    assert.ok((p.x - mummy.x) * nx + (p.z - mummy.z) * nz < -0.3, 'the ball went through the place where it stood');
    assert.equal(mummyHits().length, count, 'and nothing was hit');
  }],
  ['a rising target never rises into a ball', () => {
    for (const id of ['target-popup-2', 'target-mummy']) {
      const g = TABLE_IN_USE.targets[targetIndex(id)];
      const bit = 1 << targetIndex(id);
      const [nx, nz] = faceNormal(g);
      const u = [Math.cos(((g.angle ?? 0) * Math.PI) / 180), Math.sin(((g.angle ?? 0) * Math.PI) / 180)];
      {
        // A ball held still at its spot: it stays down, and says so. With the ball moved away, it rises.
        const { sim } = make();
        const ball = place(sim, g.x, g.z);
        assert.equal(sim.raiseTarget(id), false, `${id} stays down under a ball`);
        assert.equal(sim.targetsDown() & bit, bit, `${id}'s bit is still set`);
        sim.items.get(ball)!.body.setTranslation({ x: g.x + 2 * nx, y: R, z: g.z + 2 * nz }, true);
        assert.equal(sim.raiseTarget(id), true, `${id} rises once the ball has gone`);
        assert.equal(sim.targetsDown() & bit, 0, `${id}'s bit clears`);
        assert.equal(sim.raiseTarget(id), true, 'raised already, it stays raised');
      }
      // Its reach: a ball's radius, half its depth and 0.05, from its face (the segment, not the line it runs along).
      const reach = TABLE.ballRadius + (g.depth ?? 0.2) / 2 + 0.05;
      const raisedWithBallAt = (along: number, across: number) => {
        const { sim } = make();
        place(sim, g.x + u[0] * along + nx * across, g.z + u[1] * along + nz * across);
        return sim.raiseTarget(id);
      };
      assert.equal(raisedWithBallAt(0, reach - 0.02), false, `a ball just inside ${id}'s reach blocks it`);
      assert.equal(raisedWithBallAt(0, -(reach - 0.02)), false, `... on its back too`);
      assert.equal(raisedWithBallAt(0, reach + 0.02), true, `a ball just outside ${id}'s reach does not`);
      assert.equal(raisedWithBallAt(g.width / 2 + 0.1, 0), false, `a ball beside ${id}'s end blocks it`);
      assert.equal(raisedWithBallAt(g.width / 2 + reach + 0.02, 0), true, `a ball further along its line than its reach from its end does not`);
    }
    // Only the rising targets rise: the others, and ids that aren't targets, are refused and nothing changes.
    const { sim } = make();
    assert.equal(sim.raiseTarget('target-scarab'), false, "the scarab isn't a rising target");
    assert.equal(sim.raiseTarget('nonsense'), false);
    assert.equal(sim.targetsDown(), RISING);
  }],
  ['ballAtDropTarget: a ball where the scarab or the eye would rise, and never one at a rising target', () => {
    const { sim, hits } = make();
    const scarab = TABLE_IN_USE.targets[targetIndex('target-scarab')];
    // Both drop targets up: a ball beside one of them, as near its face as a ball that would hold a down one down, is
    // no concern: it stands against a wall.
    const [nx, nz] = faceNormal(scarab);
    const beside = { x: scarab.x + 0.3 * nx, y: R, z: scarab.z + 0.3 * nz };
    const by = place(sim, beside.x, beside.z);
    assert.equal(sim.ballAtDropTarget(), false, 'nothing is down: a ball beside the up scarab does not count');
    sim.remove(by);
    // The scarab knocked down by a shot: a ball at its spot holds it down, and one beside it as the first stood...
    const shot = rollAt(sim, scarab);
    for (let i = 0; i < 0.4 / DT && !hits.some((h) => h.id === scarab.id); i++) sim.step();
    sim.remove(shot);
    const ball = place(sim, scarab.x, scarab.z);
    assert.equal(sim.ballAtDropTarget(), true, 'a ball where the scarab would rise');
    sim.items.get(ball)!.body.setTranslation(beside, true);
    assert.equal(sim.ballAtDropTarget(), true, 'a ball beside the down scarab, where the first stood');
    // ... and a ball at any of the rising targets (down all the while) does not.
    for (const g of TABLE_IN_USE.targets.filter((g) => g.rise)) {
      sim.items.get(ball)!.body.setTranslation({ x: g.x, y: R, z: g.z }, true);
      assert.equal(sim.ballAtDropTarget(), false, `a ball at ${g.id}, which is down`);
    }
  }],
  ['resetTargets puts the rising targets down; resetDropTargets raises only the scarab and the eye', () => {
    const lock = TABLE_IN_USE.targets.filter(isLockTarget);
    assert.deepEqual(lock.map((g) => g.id), ['target-scarab', 'target-eye']);
    const lockBits = lock.reduce((bits, g) => bits | (1 << targetIndex(g.id)), 0);
    const rising = TABLE_IN_USE.targets.filter((g) => g.rise);
    const plaque = TABLE_IN_USE.targets.find((t) => t.flip)!;
    /** A sim with the scarab and the eye knocked down by shots, every rising target raised and a plaque turned. */
    const knocked = () => {
      const { sim, hits } = make();
      for (const g of lock) {
        const shot = rollAt(sim, g);
        for (let i = 0; i < 0.4 / DT && !hits.some((h) => h.id === g.id); i++) sim.step();
        sim.remove(shot);
      }
      for (const g of rising) assert.equal(sim.raiseTarget(g.id), true, `${g.id} rises`);
      const held = place(sim, -0.4, 9.5);
      sim.holdInLock(held);
      touch(sim, held, plaque.id);
      sim.step();
      sim.remove(held);
      assert.equal(sim.targetsDown(), lockBits, 'knocked: the scarab and the eye are down, the rising targets up');
      return { sim, hits };
    };
    {
      const { sim } = knocked();
      sim.resetDropTargets();
      assert.equal(sim.targetsDown(), 0, 'resetDropTargets raised the scarab and the eye, and left the rising ones up');
      assert.equal(sim.targetsTurned(), 1 << targetIndex(plaque.id), 'and the plaque turned');
      for (const g of rising) sim.lowerTarget(g.id);
      sim.resetDropTargets();
      assert.equal(sim.targetsDown(), RISING, 'with the rising ones down it leaves them down');
    }
    {
      const { sim, hits } = knocked();
      sim.resetTargets();
      assert.equal(sim.targetsDown(), RISING, 'resetTargets: the scarab and the eye up, the rising targets down');
      assert.equal(sim.targetsTurned(), 0, 'and the plaque turned back');
      // The eye is a wall again, and a pop-up that was up and is down now is none.
      const eye = TABLE_IN_USE.targets[targetIndex('target-eye')];
      hits.length = 0;
      const shot = rollAt(sim, eye);
      for (let i = 0; i < 0.4 / DT && !hits.some((h) => h.id === eye.id); i++) sim.step();
      assert.ok(hits.some((h) => h.id === eye.id && h.ball === shot), 'the eye is a wall again');
      sim.clear();
      hits.length = 0;
      const popup = TABLE_IN_USE.targets[targetIndex('target-popup-1')];
      rollAt(sim, popup);
      for (let i = 0; i < 0.3 / DT; i++) sim.step();
      assert.deepEqual(hits.filter((h) => h.id === popup.id), [], 'a pop-up put down is no wall');
    }
  }],
  ['a bank pays once: a plaque hit twice, and its last plaque hit by two balls in one step', () => {
    const { sim, hits } = make();
    const bank = TABLE_IN_USE.banks[0];
    const [t1, t2, t3] = bank.targets;
    const bankHits = () => hits.filter((h) => h.kind === 'bank');
    // The first two plaques, by a ball held still in the lock (so the steps between don't roll it into anything).
    const c = place(sim, -0.4, 9.5);
    sim.holdInLock(c);
    touch(sim, c, t1);
    sim.step();
    // The first plaque hit again, after the kick cool-down: it scores again and stays turned.
    for (let i = 0; i < 0.2 / DT; i++) sim.step();
    touch(sim, c, t1);
    touch(sim, c, t2);
    sim.step();
    assert.equal(hits.filter((h) => h.kind === 'target' && h.id === t1).length, 2, 'a turned plaque still scores');
    assert.equal(bankHits().length, 0, 'no match on two plaques');
    // Two balls on the last plaque's face, both touching it in the same step.
    const face = TABLE_IN_USE.targets[targetIndex(t3)];
    const u = [Math.cos(((face.angle ?? 0) * Math.PI) / 180), Math.sin(((face.angle ?? 0) * Math.PI) / 180)];
    let n = [-u[1], u[0]];
    if (n[0] * (-0.4 - face.x) + n[1] * (2 - face.z) < 0) n = [-n[0], -n[1]];
    const on = (k: number) => place(sim, face.x + n[0] * 0.38 + u[0] * k, face.z + n[1] * 0.38 + u[1] * k);
    const a = on(-0.27), b = on(0.27);
    touch(sim, a, t3);
    touch(sim, b, t3);
    sim.step();
    assert.deepEqual(bankHits(), [{ kind: 'bank', id: bank.id, ball: a }], 'the bank hit came once');
    assert.equal(hits.filter((h) => h.kind === 'target' && h.id === t3).length, 2, 'both balls scored the plaque');
    // A plaque hit while the bank shows its match pays no second bonus.
    for (let i = 0; i < 0.2 / DT; i++) sim.step();
    touch(sim, c, t2);
    touch(sim, c, t3);
    sim.step();
    assert.equal(bankHits().length, 1, 'no second bank hit while it shows its match');
  }],
  ['heldBy: the lock, a saucer, or nothing', () => {
    const { sim } = make();
    const free = place(sim, -0.4, 9.5);
    assert.equal(sim.heldBy(free), null);
    sim.holdInLock(free);
    assert.equal(sim.heldBy(free), 'lock');
    sim.release(free);
    assert.equal(sim.heldBy(free), null);
    const id = intoSaucer(sim);
    assert.equal(sim.heldBy(id), 'saucer');
    assert.equal(sim.heldBy(12345), null);
  }],
  ['remove() and clear() while a saucer holds a ball', () => {
    for (const how of ['remove', 'clear'] as const) {
      const { sim } = make();
      const id = intoSaucer(sim);
      const handle = sim.items.get(id)!.body.handle;
      if (how === 'remove') sim.remove(id);
      else sim.clear();
      assert.equal(sim.items.has(id), false, `${how}: the ball is gone`);
      assert.equal((sim as any).world.getRigidBody(handle), null, `${how}: its body is gone from the world`);
      assert.equal(sim.heldBy(id), null, `${how}: nothing holds it`);
      // Past the hold's end: nothing tries to kick a ball that's gone.
      assert.doesNotThrow(() => {
        for (let i = 0; i < 2 / DT; i++) sim.step();
      });
    }
  }],
  ["multiball on a saucer's ball: holdInLock takes it from the saucer, and release throws it out of the lock", () => {
    const { sim } = make();
    const l = TABLE_IN_USE.lock;
    const id = intoSaucer(sim);
    sim.holdInLock(id);
    assert.equal(sim.heldBy(id), 'lock');
    // Past the saucer's hold: the saucer doesn't throw it out of the lock.
    for (let i = 0; i < 2 / DT; i++) sim.step();
    assert.equal(sim.heldBy(id), 'lock', "still the lock's after the saucer's hold");
    const at = sim.items.get(id)!.body.translation();
    assert.ok(Math.hypot(at.x - l.x, at.z - l.z) < 0.05, 'it sits in the lock');
    sim.release(id);
    assert.equal(sim.heldBy(id), null);
    const v = sim.items.get(id)!.body.linvel();
    // The lock's eject: down and in, toward the flippers (0.6, -0.8).
    const cos = (v.x * 0.6 - v.z * 0.8) / Math.hypot(v.x, v.z);
    assert.ok(cos > 0.99, `it left along the lock's eject (cos ${cos.toFixed(2)} to it)`);
  }],
  ['release() on a ball a saucer holds does nothing; the saucer lets it go along its own eject', () => {
    const { sim } = make();
    const sc = TABLE_IN_USE.saucers.find((s) => s.id === 'saucer-scarab')!;
    const id = intoSaucer(sim);
    sim.release(id);
    assert.equal(sim.heldBy(id), 'saucer', 'still held by the saucer');
    sim.step();
    const at = sim.items.get(id)!.body.translation();
    assert.ok(Math.hypot(at.x - sc.x, at.z - sc.z) < 0.05, 'still sitting in the saucer');
    for (let i = 0; i < 2 / DT && sim.heldBy(id) === 'saucer'; i++) sim.step();
    assert.equal(sim.heldBy(id), null, 'the saucer let it go');
    const v = sim.items.get(id)!.body.linvel();
    const len = Math.hypot(sc.eject[0], sc.eject[1]);
    const along = (v.x * sc.eject[0] + v.z * sc.eject[1]) / (len * Math.hypot(v.x, v.z));
    assert.ok(along > 0.9, `it left along the saucer's eject (cos ${along.toFixed(2)} to it), not the lock's`);
  }],
  ['the shut tomb is a wall', () => {
    const { sim, hits } = make();
    assert.equal(sim.tombOpen, false, 'the tomb starts shut');
    const id = rollAtTomb(sim);
    let top = -Infinity, back = Infinity;
    for (let i = 0; i < 0.6 / DT && sim.items.has(id); i++) {
      sim.step();
      const z = sim.items.get(id)?.body.translation().z;
      if (z === undefined) break;
      if (z > top) [top, back] = [z, z];
      back = Math.min(back, z);
    }
    // The door stands across the mouth, a wall as thick as the rest, its face a wall's half-thickness in front of the
    // mouth's line: the ball met it there, a ball's radius out (measured 5.68, as the step ends; the pyramid's uncut
    // corner met it at 5.36, and with no door it got in between the jambs' ends, to 5.83), and came back.
    const face = TOMB.z - WALL_HALF;
    assert.ok(top > face - R - 0.06 && top < face - R + 0.01, `the ball got to z ${top.toFixed(3)}, where the door's face is at ${face}`);
    assert.ok(back < top - 0.3, `it bounced back down the table (to z ${back.toFixed(2)})`);
    assert.deepEqual(hits.filter((h) => h.kind === 'tomb'), [], 'and nothing caught it');
  }],
  ['the open tomb catches a ball, holds it, and kicks it out toward a flipper', () => {
    const { sim, hits } = make();
    sim.openTomb();
    assert.equal(sim.tombOpen, true, 'it opens');
    const id = rollAtTomb(sim);
    for (let i = 0; i < 1 / DT && sim.heldBy(id) !== 'tomb'; i++) sim.step();
    assert.deepEqual(hits.filter((h) => h.kind === 'tomb'), [{ kind: 'tomb', id: TOMB.id, ball: id }], 'one catch');
    // Held still at its spot for its hold...
    const caught = sim.time;
    while (sim.heldBy(id) === 'tomb' && sim.time < caught + TOMB.hold + 0.5) {
      const p = sim.items.get(id)!.body.translation();
      assert.ok(Math.hypot(p.x - TOMB.held[0], p.z - TOMB.held[1]) < 1e-3, `held at its spot, not at (${p.x.toFixed(3)}, ${p.z.toFixed(3)})`);
      sim.step();
    }
    const heldFor = sim.time - caught;
    assert.equal(sim.heldBy(id), null, 'then let go');
    assert.ok(Math.abs(heldFor - TOMB.hold) <= DT + 1e-9, `held ${heldFor.toFixed(3)} s, not ${TOMB.hold}`);
    // ... then kicked out along its eject...
    const off = offBy(sim, id, TOMB.eject);
    assert.ok(off < 10, `it left ${off.toFixed(1)} degrees off its eject`);
    // ... past the magnet just below the tomb (it holds a ball as slow) to a flipper, and not caught again on its way.
    let near: 'left' | 'right' | null = null;
    for (let i = 0; i < 1 / DT && sim.items.has(id) && !near; i++) {
      sim.step();
      near = sim.nearFlipper(id);
    }
    assert.ok(near, "it came within a flipper's reach");
    assert.deepEqual(hits.filter((h) => h.kind === 'saucer'), [], 'the magnet let it go by');
    assert.equal(hits.filter((h) => h.kind === 'tomb').length, 1, 'the tomb caught it once');
  }],
  ["the tomb won't shut on a ball", () => {
    {
      // While it holds a ball it stays open, every step of the hold; with the ball out and clear, it shuts.
      const { sim, hits } = make();
      const id = intoTomb(sim);
      // (Capped, as every wait here is: a hold that never let go would fail the check, not hang the suite.)
      for (let i = 0; i < 2 / DT && sim.heldBy(id) === 'tomb'; i++) {
        assert.equal(sim.closeTomb(), false, 'not on the ball it holds');
        assert.equal(sim.tombOpen, true, 'it stays open');
        sim.step();
      }
      assert.equal(sim.heldBy(id), null, 'the tomb let the ball go');
      for (let i = 0; i < 0.5 / DT; i++) sim.step();
      assert.equal(sim.closeTomb(), true, 'it shuts once the ball is out and clear');
      assert.equal(sim.tombOpen, false);
      assert.equal(sim.closeTomb(), true, 'shut already, it stays shut');
      // Shut again, its door is a wall again and its mouth no longer catches: the next ball comes back off the door.
      sim.remove(id);
      const next = rollAtTomb(sim);
      let top = -Infinity;
      for (let i = 0; i < 0.4 / DT && sim.items.has(next); i++) {
        sim.step();
        top = Math.max(top, sim.items.get(next)?.body.translation().z ?? -Infinity);
      }
      assert.ok(top < TOMB.z - WALL_HALF - R + 0.01, `shut again, the door stopped the next ball (it got to z ${top.toFixed(3)})`);
      assert.equal(hits.filter((h) => h.kind === 'tomb').length, 1, 'and the mouth caught only the first');
    }
    // Nor on a ball standing at its mouth: within a ball's radius and 0.05 of the door's face, anywhere along it.
    const reach = R + WALL_HALF + 0.05;
    for (const x of [MOUTH[0][0], TOMB.x, MOUTH[1][0]]) {
      const shutWithBallAt = (out: number) => {
        const { sim } = make();
        sim.openTomb();
        place(sim, x, TOMB.z - out);
        return sim.closeTomb();
      };
      assert.equal(shutWithBallAt(reach - 0.02), false, `a ball just inside the door's reach at x ${x} keeps it open`);
      assert.equal(shutWithBallAt(reach + 0.02), true, `a ball just outside it at x ${x} does not`);
    }
  }],
  ['a fast ball is caught too', () => {
    // At 30 units/s a ball moves 0.125 a substep, and at the fastest the table lets a ball go (60) 0.25: neither gets
    // past the mouth's catch, nor wedges between the jambs' ends.
    for (const speed of [30, 60]) {
      const { sim, hits } = make();
      sim.openTomb();
      const id = rollAtTomb(sim, speed);
      for (let i = 0; i < 0.5 / DT && sim.heldBy(id) !== 'tomb'; i++) sim.step();
      assert.equal(sim.heldBy(id), 'tomb', `a ball at ${speed} units/s is caught`);
      assert.deepEqual(hits.filter((h) => h.kind === 'tomb'), [{ kind: 'tomb', id: TOMB.id, ball: id }]);
      const p = sim.items.get(id)!.body.translation();
      assert.ok(Math.hypot(p.x - TOMB.held[0], p.z - TOMB.held[1]) < 1e-3, `at ${speed} units/s it is held at its spot`);
    }
  }],
  ['the tomb holds its ball just in front of its door, centred on the mouth and clear of everything', () => {
    // The doorway is narrower than a ball (its jambs' ends are walls, so 0.44 is open between them, for a ball 0.54
    // across): a ball is caught at the mouth and held in front of the door's line, never inside, and none can get in
    // between the jambs.
    assert.ok(TOMB.width - 2 * WALL_HALF < 2 * R, `the doorway, ${(TOMB.width - 2 * WALL_HALF).toFixed(2)} between its jambs' walls, is narrower than a ball`);
    assert.ok(Math.abs(TOMB.held[0] - (MOUTH[0][0] + MOUTH[1][0]) / 2) < 1e-9, 'centred on the mouth');
    assert.ok(TOMB.held[1] < TOMB.z, 'in front of the mouth');
    // Every solid (no sensor) within a gap of a ball standing there, at the height a ball meets the walls. The tomb
    // starts shut, so its door is among them.
    const { sim } = make();
    sim.step(); // Rapier's queries see the table's colliders once the world has stepped.
    const S = sim as any;
    const within = (gap: number) => {
      const found: RAPIER.Collider[] = [];
      const at = { x: TOMB.held[0], y: R, z: TOMB.held[1] };
      S.world.intersectionsWithShape(at, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Cylinder(0.1, R + gap), (c: RAPIER.Collider) => {
        found.push(c);
        return true;
      }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      return found;
    };
    // (Less 1e-4: Rapier works in 32-bit floats.)
    assert.deepEqual(within(0.02 - 1e-4).map((c) => c.handle), [], 'a held ball is 0.02 clear of the door, the jambs and every other solid');
    assert.ok(within(0.05).some((c) => c.handle === S.tomb.door.handle), 'and just in front of the door: within 0.05 of it');
  }],
  ['a ball the tomb holds is its own: the lock and the saucers never take it, nor the tomb theirs', () => {
    {
      // The lock's sensor and each saucer's touched by the tomb's ball (through the sim's own touch path): nothing
      // happens, and the tomb kicks it out at its time, along its own eject.
      const { sim, hits } = make();
      const id = intoTomb(sim);
      touchWhere(sim, id, (p) => p.kind === 'lock', 'lock');
      TABLE_IN_USE.saucers.forEach((sc, index) => touchWhere(sim, id, (p) => p.kind === 'saucer' && p.index === index, sc.id));
      sim.step();
      assert.deepEqual(hits.filter((h) => h.kind === 'lock' || h.kind === 'saucer'), [], 'neither the lock nor a saucer reported it');
      assert.equal(sim.heldBy(id), 'tomb', "still the tomb's");
      for (let i = 0; i < 2 / DT && sim.heldBy(id) === 'tomb'; i++) sim.step();
      assert.equal(sim.heldBy(id), null, 'the tomb let it go');
      const off = offBy(sim, id, TOMB.eject);
      assert.ok(off < 10, `along the tomb's eject (${off.toFixed(1)} degrees off it)`);
    }
    {
      // A ball the lock holds and one a saucer holds, touching the open tomb's mouth, aren't caught.
      const { sim, hits } = make();
      sim.openTomb();
      const locked = place(sim, -0.4, 9.5);
      sim.holdInLock(locked);
      const saucered = intoSaucer(sim);
      for (const id of [locked, saucered]) touchWhere(sim, id, (p) => p.kind === 'tomb', "tomb's mouth");
      sim.step();
      assert.deepEqual(hits.filter((h) => h.kind === 'tomb'), [], 'the tomb caught neither');
      assert.equal(sim.heldBy(locked), 'lock');
      assert.equal(sim.heldBy(saucered), 'saucer');
    }
    {
      // Multiball on the tomb's ball: holdInLock takes it from the tomb, which neither kicks it out of the lock nor
      // keeps itself from shutting for it.
      const { sim } = make();
      const l = TABLE_IN_USE.lock;
      const id = intoTomb(sim);
      sim.holdInLock(id);
      assert.equal(sim.heldBy(id), 'lock');
      for (let i = 0; i < 2 / DT; i++) sim.step();
      assert.equal(sim.heldBy(id), 'lock', "still the lock's after the tomb's hold");
      const at = sim.items.get(id)!.body.translation();
      assert.ok(Math.hypot(at.x - l.x, at.z - l.z) < 0.05, 'it sits in the lock');
      assert.equal(sim.closeTomb(), true, 'the tomb shuts: it holds nothing');
    }
  }],
  ['the tomb catches one ball at a time, never into another ball, and not one it has just kicked out', () => {
    const mouth = (p: any) => p.kind === 'tomb';
    {
      // One at a time (a held ball fills the mouth): while it holds a ball, a second touching the mouth isn't caught,
      // and once the first is gone, it is.
      const { sim, hits } = make();
      const first = intoTomb(sim);
      const second = place(sim, -0.4, 3);
      touchWhere(sim, second, mouth, "tomb's mouth");
      assert.equal(sim.heldBy(second), null, 'not while it holds another');
      assert.equal(sim.heldBy(first), 'tomb', 'and it keeps the first');
      // The hold alone keeps it to one: with the held ball moved off the held spot, no ball stands within two radii
      // of the spot to refuse the second there, and still the second isn't caught.
      const held = sim.items.get(first)!.body;
      held.setTranslation({ x: 2, y: R, z: 3 }, true);
      held.setNextKinematicTranslation({ x: 2, y: R, z: 3 });
      assert.equal(sim.heldBy(first), 'tomb', "moved, the first is still the tomb's");
      touchWhere(sim, second, mouth, "tomb's mouth");
      assert.equal(sim.heldBy(second), null, 'nor with the held spot clear: it holds one at a time');
      sim.remove(first);
      touchWhere(sim, second, mouth, "tomb's mouth");
      assert.equal(sim.heldBy(second), 'tomb', 'with the first gone, it catches the second');
      sim.step(); // (A hit is passed on as its substep ends.)
      assert.deepEqual(hits.filter((h) => h.kind === 'tomb').map((h) => h.ball), [first, second], 'one catch each');
    }
    // Never into another: a ball standing within two balls' radii of the held spot, where the caught ball would be put,
    // keeps the next from being caught there; one just further off does not. (Down the table, to the right and down to
    // the left of the spot.)
    for (const [dx, dz] of [[0, -1], [1, 0], [-0.6, -0.8]]) {
      const caughtWithBallAt = (d: number) => {
        const { sim } = make();
        sim.openTomb();
        place(sim, TOMB.held[0] + d * dx, TOMB.held[1] + d * dz);
        const id = place(sim, -0.4, 3);
        touchWhere(sim, id, mouth, "tomb's mouth");
        return sim.heldBy(id) === 'tomb';
      };
      assert.equal(caughtWithBallAt(2 * R - 0.02), false, `a ball just inside 2R of the held spot (toward ${dx}, ${dz}) keeps it from catching`);
      assert.equal(caughtWithBallAt(2 * R + 0.02), true, `a ball just outside it (toward ${dx}, ${dz}) does not`);
    }
    {
      // Not one it has just kicked out: it ignores that ball for LOCK_IGNORE from the kick, then catches it again. The
      // ball is kept still well away from the tomb meanwhile (put back each step), so only the clock moves.
      const { sim } = make();
      const id = intoTomb(sim);
      for (let i = 0; i < 2 / DT && sim.heldBy(id) === 'tomb'; i++) sim.step();
      assert.equal(sim.heldBy(id), null, 'kicked out');
      // The kick came in the step just taken, on its start's clock.
      const until = sim.time - DT + LOCK_IGNORE;
      const park = () => {
        const body = sim.items.get(id)!.body;
        body.setTranslation({ x: -0.4, y: R, z: 9.5 }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      };
      park();
      touchWhere(sim, id, mouth, "tomb's mouth");
      assert.equal(sim.heldBy(id), null, 'not caught again right after the kick');
      for (let i = 0; i < 2 / DT && sim.time < until - 1.5 * DT; i++) {
        sim.step();
        park();
      }
      touchWhere(sim, id, mouth, "tomb's mouth");
      assert.equal(sim.heldBy(id), null, `nor a step before LOCK_IGNORE (${LOCK_IGNORE} s) is up`);
      sim.step();
      park();
      sim.step();
      park();
      touchWhere(sim, id, mouth, "tomb's mouth");
      assert.equal(sim.heldBy(id), 'tomb', 'once it is up, it is caught again');
    }
  }],
  ['remove() and clear() while the tomb holds a ball', () => {
    for (const how of ['remove', 'clear'] as const) {
      const { sim, hits } = make();
      const id = intoTomb(sim);
      const handle = sim.items.get(id)!.body.handle;
      if (how === 'remove') sim.remove(id);
      else sim.clear();
      assert.equal(sim.items.has(id), false, `${how}: the ball is gone`);
      assert.equal((sim as any).world.getRigidBody(handle), null, `${how}: its body is gone from the world`);
      assert.equal(sim.heldBy(id), null, `${how}: nothing holds it`);
      // Past the hold's end: nothing tries to kick a ball that's gone, and the tomb catches the next one.
      assert.doesNotThrow(() => {
        for (let i = 0; i < 2 / DT; i++) sim.step();
      });
      const next = rollAtTomb(sim);
      for (let i = 0; i < 1 / DT && sim.heldBy(next) !== 'tomb'; i++) sim.step();
      assert.equal(sim.heldBy(next), 'tomb', `${how}: the tomb catches the next ball`);
      assert.equal(hits.filter((h) => h.kind === 'tomb').length, 2);
    }
  }],
  ['with the gate at rest the left ramp runs as before', () => {
    // Balls rolled up the left ramp from its middle each end as they do on the table with no gate and no gap in the
    // rail, up in the dish or back down at its mouth, and none leaves it anywhere else: at rest the gate stands along
    // the gap in the ramp's rail, in the rail's place, on the ramp's floor at its hinge (the gap's far end).
    const { sim, hits } = make();
    assert.equal(sim.diverterOver, false, 'the gate starts at rest');
    assert.ok(Math.abs(gateOf(sim).y - GATE_RAMP.path[GAP.to][2]) < 1e-9, `the gate stands at ${gateOf(sim).y}, not on the floor at the gap's far end (${GATE_RAMP.path[GAP.to][2]})`);
    const bare = make({ ...TABLE_IN_USE, diverter: undefined, ramps: TABLE_IN_USE.ramps.map((r) => (r.id === GATE.ramp ? { ...r, opening: undefined } : r)) });
    const ends: string[] = [], before: string[] = [];
    for (let n = 0; n < 20; n++) {
      for (const [s, h, out] of [[sim, hits, ends], [bare.sim, bare.hits, before]] as const) {
        s.clear();
        out.push(leaving(s, h, upTheRamp(s, n, 20), 4).left);
      }
    }
    assert.deepEqual(ends.filter((e) => e !== 'the dish' && e !== 'its mouth'), [], 'at rest a ball leaves the ramp only up into the dish or back down at its mouth');
    assert.deepEqual(ends, before, 'and each ends as it does with no gate');
    assert.ok(ends.includes('the dish') && ends.includes('its mouth'), `some make the dish and some don't (${ends.join(', ')})`);
  }],
  ['with the gate over, balls up the left ramp drop off it through the gap into the lock', () => {
    // Swung over, the gate stands across the ramp below the dish and turns a ball going up it out through the gap in
    // the ramp's rail, down onto the playfield and into the lock beside it. A ball leaves the ramp only through the
    // opening (or back down at its mouth, one too slow to get up to the gate), and none gets past the gate to the dish.
    // Each ball goes on a table with the one before it taken off (remove), so the gate stays as this check set it.
    const { sim, hits } = make();
    assert.equal(sim.setDiverter(true), true, 'with no ball near it, the gate swings over');
    for (let i = 0; i < 0.25 / DT; i++) sim.step();
    assert.equal(gateOf(sim).angle, GATE.overDeg, 'and gets there');
    const each: string[] = [];
    let id = -1;
    for (let n = 0; n < 20; n++) {
      sim.remove(id);
      hits.length = 0;
      id = upTheRamp(sim, n, 20);
      const { left, lock } = leaving(sim, hits, id, 4);
      assert.ok(left === 'the opening' || left === 'its mouth', `ball ${n} left the ramp at ${left || 'nowhere'}, not through the opening`);
      each.push(left === 'its mouth' ? '-' : lock ? 'L' : 'o');
    }
    const reached = each.filter((e) => e !== '-').length, locked = each.filter((e) => e === 'L').length;
    assert.ok(reached >= 10, `only ${reached} of 20 got up to the gate (per ball, L the lock, o out through the opening only, - back down: ${each.join('')})`);
    assert.ok(locked >= 0.9 * reached, `only ${locked} of the ${reached} that got up to the gate reached the lock (${each.join('')})`);
  }],
  ['the gate waits to swing over while a ball is on its ramp or in the dish it runs up into', () => {
    // Over, the gate shuts the ramp across: a ball beyond it then would come back down onto its back and be wedged
    // between it and the far rail, and one going up as it swung could get past it. So it won't swing over while a
    // ball is anywhere up on its ramp or in the dish at the ramp's top (it is asked again each step, as the game asks);
    // swinging back to rest it waits only for a ball in its sweep.
    const P = GATE_RAMP.path;
    const onRamp = (k: number): [number, number, number] => {
      const i = Math.floor(k), u = k - i;
      return [P[i][0] + u * (P[i + 1][0] - P[i][0]), P[i][2] + u * (P[i + 1][2] - P[i][2]) + R, P[i][1] + u * (P[i + 1][1] - P[i][1])];
    };
    const where: [string, [number, number, number], boolean][] = [
      ['in the dish', [DISH.x + 0.3, DISH.y + R, DISH.z + 0.2], false],
      ['on the ramp above the gate', onRamp(GAP.to + 0.5), false],
      ['on the ramp below the gate', onRamp(GAP.from - 3), false],
      ["at the ramp's foot", onRamp(1), false],
      ['in the lock beside it', [TABLE_IN_USE.lock.x, R, TABLE_IN_USE.lock.z], true],
      ['on the playfield beside the ramp', [-2.3, R, 10.5], true],
    ];
    for (const [what, [x, y, z], swings] of where) {
      const { sim } = make();
      const id = dropAt(sim, x, y, z);
      assert.equal(sim.setDiverter(true), swings, `a ball ${what}: ${swings ? 'it swings over' : 'it waits'}`);
      if (swings) continue;
      assert.equal(sim.diverterOver, false, `a ball ${what}: its goal stays at rest`);
      sim.remove(id);
      assert.equal(sim.setDiverter(true), true, `with the ball ${what} gone, it swings over`);
    }
    // Back to rest, a ball on the ramp below it is no matter.
    const { sim } = make();
    assert.equal(sim.setDiverter(true), true);
    for (let i = 0; i < 0.25 / DT; i++) sim.step();
    const [x, y, z] = onRamp(GAP.from - 3);
    dropAt(sim, x, y, z);
    assert.equal(sim.setDiverter(false), true, 'swinging back, it does not wait for a ball on its ramp out of its sweep');
  }],
  ['the gate never swings into a ball', () => {
    const y = gateOf(make().sim).y;
    /** A point `along` the gate's length out from its pivot at an angle, then `out` to one side: [x, z]. */
    const at = (deg: number, along: number, side: [number, number] = [0, 0], out = 0): [number, number] => {
      const [ux, uz] = dirOf(deg);
      return [GATE.pivot[0] + along * ux + out * side[0], GATE.pivot[1] + along * uz + out * side[1]];
    };
    /** The side the gate's face moves toward as it swings over, at an angle. */
    const ahead = (deg: number): [number, number] => {
      const [ux, uz] = dirOf(deg);
      return [-WAY * uz, WAY * ux];
    };
    const behind = (deg: number): [number, number] => {
      const [ax, az] = ahead(deg);
      return [-ax, -az];
    };
    {
      // A ball held still on the ramp against the gate at rest, halfway along it: asked to swing over, the gate says
      // no, every step it's asked, and stays at rest. With the ball gone it swings; over, a ball against the face it
      // turns balls out with keeps it over.
      const { sim } = make();
      const [sx, sz] = at(GATE.restDeg, GATE.length / 2, ahead(GATE.restDeg), R + WALL_HALF);
      const id = dropAt(sim, sx, y + R, sz);
      for (let k = 0; k < 10; k++) {
        assert.equal(sim.setDiverter(true), false, 'not into the ball');
        assert.equal(sim.diverterOver, false, 'its goal stays at rest');
        sim.step();
        const body = sim.items.get(id)!.body;
        body.setTranslation({ x: sx, y: y + R, z: sz }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        assert.equal(gateOf(sim).angle, GATE.restDeg, 'and it stays at rest');
      }
      sim.remove(id);
      assert.equal(sim.setDiverter(true), true, 'with the ball gone, it swings over');
      assert.equal(sim.setDiverter(true), true, 'over already, it stays over');
      for (let i = 0; i < 0.25 / DT; i++) sim.step();
      const [bx, bz] = at(GATE.overDeg, GATE.length / 2, behind(GATE.overDeg), R + WALL_HALF);
      const back = dropAt(sim, bx, y + R, bz);
      assert.equal(sim.setDiverter(false), false, 'nor back into a ball');
      assert.equal(sim.diverterOver, true, 'its goal stays over');
      sim.remove(back);
      assert.equal(sim.setDiverter(false), true, 'with that ball gone, it swings back');
      assert.equal(sim.setDiverter(false), true, 'at rest already, it stays at rest');
    }
    // Its reach: a ball's radius and 0.05 from where the gate sweeps (the sector between its two angles out to its
    // length, with a wall's half-thickness either side, from its ramp's floor up as high as the rails), so a ball
    // touching a face it sweeps through is well inside it. Measured swinging back from over, as the sweep is the same
    // both ways: swinging over it also waits for any ball on its ramp (the check above), which these all are.
    const reach = R + WALL_HALF + 0.05;
    const swingsWithBallAt = ([x, z]: [number, number], by = y + R) => {
      const { sim } = make();
      assert.equal(sim.setDiverter(true), true);
      for (let i = 0; i < 0.25 / DT; i++) sim.step();
      dropAt(sim, x, by, z);
      return sim.setDiverter(false);
    };
    const end = (out: number) => at(GATE.restDeg, GATE.length + out);
    assert.equal(swingsWithBallAt(end(reach - 0.02)), false, 'a ball on its line just inside its reach of its free end at rest stops it');
    assert.equal(swingsWithBallAt(end(reach + 0.02)), true, 'one just outside does not');
    const beside = (out: number) => at(GATE.overDeg, GATE.length / 2, ahead(GATE.overDeg), out);
    assert.equal(swingsWithBallAt(beside(reach - 0.02)), false, 'a ball just inside its reach beyond where it swings to stops it');
    assert.equal(swingsWithBallAt(beside(reach + 0.02)), true, 'one just outside does not');
    // At its height: a ball on the playfield under it is no matter (the left ramp is skirted, so none is ever there,
    // but under a wireform one passes), nor one just over its reach above its top; one just inside that is.
    const middle = at((GATE.restDeg + GATE.overDeg) / 2, GATE.length / 2);
    assert.equal(swingsWithBallAt(middle, R), true, 'a ball on the playfield under it does not stop it');
    const top = y + GATE_RAMP.rail;
    assert.equal(swingsWithBallAt(middle, top + R + 0.05 - 0.02), false, 'a ball just inside its reach above its top stops it');
    assert.equal(swingsWithBallAt(middle, top + R + 0.05 + 0.02), true, 'one just outside does not');
  }],
  ["the gate swings at 400 degrees a second; toys() has the tomb open and the gate's goal over", () => {
    const { sim } = make();
    assert.equal(sim.toys(), 0, 'a fresh table: the tomb shut and the gate at rest');
    sim.openTomb();
    assert.equal(sim.toys(), TOY.tombOpen);
    assert.equal(sim.setDiverter(true), true);
    assert.equal(sim.toys(), TOY.tombOpen | TOY.diverterOver, "the gate's bit is its goal: it's set at once");
    // A step at a time toward over, at 400 degrees a second (slow: a flipper swings at 1,800), and it stops there.
    const swing = Math.abs(GATE.overDeg - GATE.restDeg);
    for (let k = 1; k <= Math.ceil(swing / (400 * DT)) + 2; k++) {
      sim.step();
      const expect = GATE.restDeg + WAY * Math.min(400 * DT * k, swing);
      assert.ok(Math.abs(gateOf(sim).angle - expect) < 1e-6, `step ${k}: at ${gateOf(sim).angle.toFixed(3)} degrees, not ${expect.toFixed(3)}`);
    }
    assert.equal(sim.closeTomb(), true);
    assert.equal(sim.toys(), TOY.diverterOver);
    assert.equal(sim.setDiverter(false), true);
    assert.equal(sim.toys(), 0, 'and it clears at once, as the gate starts back');
    assert.deepEqual(TOY, { tombOpen: 1, diverterOver: 2 });
    // A table with no diverter has no gate to swing over, and none away from rest, and its toys' bits never say over.
    const none = make({ ...TABLE_IN_USE, diverter: undefined }).sim;
    assert.deepEqual([none.setDiverter(true), none.diverterOver, none.setDiverter(false), none.toys() & TOY.diverterOver], [false, false, true, 0], 'no diverter');
  }],
  ["an orbit shot up each side touches its lane's switch going up, once; a launch round the arch passes the left one going down, if at all", () => {
    // Shots straight up the middle of each orbit lane from its foot, as pinball-layout-test fires its orbit shots (34
    // units/s), here at 32 to 36 units/s: each touches its own lane's switch once, going up, goes round over the top
    // and comes down the other lane, touching that one's switch going down. (The game counts the shot there, going
    // down, and only after a pass up the other lane: game.ts's ORBIT_ROUND.)
    for (const [own, other, x, z] of [['orbit-left', 'orbit-right', -4.5, 6.8], ['orbit-right', 'orbit-left', 3.7, 8.0]] as const) {
      for (let n = 0; n < 5; n++) {
        const { sim, passes } = withPasses();
        const id = place(sim, x, z, 0, 32 + n);
        for (let i = 0; i < 3 / DT && sim.items.has(id); i++) sim.step();
        assert.deepEqual(passesOf(passes, id), [`${own} up`, `${other} down`], `a shot up the lane of ${own} at ${32 + n} units/s`);
      }
    }
    // A launch goes up the shooter lane, whose wall stands between it and the right lane's switch, round the arch and
    // down the left orbit lane: it touches no switch but the left lane's, going down, and that one once at most.
    for (let n = 0; n < 10; n++) {
      const { sim, passes } = withPasses();
      const id = sim.launch(null);
      for (let i = 0; i < 4 / DT && sim.items.has(id); i++) sim.step();
      const seen = passesOf(passes, id);
      assert.ok(seen.length <= 1 && seen.every((p) => p === 'orbit-left down'), `launch ${n}: ${seen.join(', ') || 'no switch'}`);
    }
  }],
  ["a left-ramp shot into the dish touches the dish switch; with the gate over, a shot turned out through the gap touches the gate's switch", () => {
    // The balls the gate's checks above roll up the left ramp from its middle (upTheRamp), each followed 4 s. With the
    // gate at rest, one that gets up into the dish touches the dish's switch first, going up the table; one too slow to
    // get there falls back to the ramp's mouth touching no switch. Every ball leaves the dish back down the ramp it
    // came up (none leaves it east), so one that stays in the dish longer than a pass's 0.5 s touches the dish's switch
    // again on its way out, going down. (The game counts the pass going in.)
    const rest = withPasses();
    const ends: string[] = [];
    let outAgain = 0;
    for (let n = 0; n < 20; n++) {
      rest.sim.clear();
      rest.hits.length = 0;
      const id = upTheRamp(rest.sim, n, 20);
      const { left } = leaving(rest.sim, rest.hits, id, 4);
      const seen = passesOf(rest.passes, id);
      ends.push(left);
      if (left === 'the dish') {
        assert.equal(seen[0], 'ramp-dish up', `ball ${n} went into the dish: ${seen.join(', ') || 'no switch'}`);
        assert.ok(seen.slice(1).every((p) => p === 'ramp-dish down'), `ball ${n} after the dish: ${seen.join(', ')}`);
        if (seen.length > 1) outAgain++;
      } else assert.deepEqual(seen, [], `ball ${n} left the ramp at ${left}`);
    }
    assert.ok(ends.includes('the dish') && ends.includes('its mouth'), `some make the dish and some don't (${ends.join(', ')})`);
    assert.ok(outAgain > 0, "a ball that stays in the dish more than 0.5 s touches the dish's switch again on its way out");
    // With the gate over: one the gate turns out through the gap touches the gate's switch, once, and no other; one too
    // slow to reach the gate falls back touching none. (The gate stays over: each ball is taken off before the next.)
    const over = withPasses();
    assert.equal(over.sim.setDiverter(true), true);
    for (let i = 0; i < 0.25 / DT; i++) over.sim.step();
    let id = -1, out = 0;
    for (let n = 0; n < 20; n++) {
      over.sim.remove(id);
      over.hits.length = 0;
      id = upTheRamp(over.sim, n, 20);
      const { left } = leaving(over.sim, over.hits, id, 4);
      const seen = passesOf(over.passes, id);
      if (left === 'the opening') {
        out++;
        assert.ok(seen.length === 1 && seen[0].startsWith('ramp-gate '), `ball ${n} went out through the gap: ${seen.join(', ') || 'no switch'}`);
      } else assert.deepEqual(seen, [], `ball ${n} left the ramp at ${left}`);
    }
    assert.ok(out >= 10, `only ${out} of 20 went out through the gap`);
  }],
  ['balls on the playfield, in the bumpers and round the lock touch no switch', () => {
    // Balls let go with a push of up to 2 units/s (4 in the bumpers) any way, each followed 6 s or until it drains, and
    // none touches a switch: on the playfield anywhere but up an orbit lane, in the shooter lane or on the left ramp;
    // among the three pop bumpers, which kick them about; and round the lock, beside the left ramp's top under the
    // gate's switch, with the gate at rest and over and the lock empty and holding a ball (which kicks a second out).
    const t = TABLE_IN_USE;
    const orbit = t.walls.find((w) => w.kind === 'orbit')!.points;
    const pyramid = t.walls.find((w) => w.kind === 'pyramid')!.points;
    const foot = Math.min(orbit[0][1], orbit[orbit.length - 1][1]);
    const offRamp = (x: number, z: number) => fromLeftRamp(x, z) > (GATE_RAMP.width + (GATE_RAMP.flare ?? 0)) / 2 + R + 0.05;
    // On the playfield: below the orbit lanes' feet, or above them inside the orbit's loop; not on the left ramp, under
    // the dish or in the pyramid.
    const onField = (x: number, z: number) =>
      clearSpot([x, z], t) && offRamp(x, z) && Math.hypot(x - DISH.x, z - DISH.z) > DISH.r + R && !insideOutline([x, z], pyramid) && (z < foot || insideOutline([x, z], orbit));
    const bumpers = t.bumpers.filter((b) => !b.y0);
    const { lock } = t;
    const groups: { name: string; count: number; box: [number, number, number, number]; push: number; fits: (x: number, z: number) => boolean; over?: boolean; held?: boolean }[] = [
      { name: 'on the playfield', count: 60, box: [-4.9, 4.9, 0.5, TABLE.length - 0.5], push: 2, fits: onField },
      { name: 'in the bumpers', count: 20, box: [Math.min(...bumpers.map((b) => b.x)) - 0.9, Math.max(...bumpers.map((b) => b.x)) + 0.9, Math.min(...bumpers.map((b) => b.z)) - 0.9, Math.max(...bumpers.map((b) => b.z)) + 0.9], push: 4, fits: onField },
    ];
    for (const over of [false, true]) {
      for (const held of [false, true]) {
        const fits = (x: number, z: number) => clearSpot([x, z], t) && offRamp(x, z) && (!held || Math.hypot(x - lock.x, z - lock.z) > 2 * R + 0.03);
        groups.push({ name: `round the lock (the gate ${over ? 'over' : 'at rest'}, the lock ${held ? 'holding a ball' : 'empty'})`, count: 10, box: [lock.x - 0.9, lock.x + 0.9, lock.z - 0.9, lock.z + 0.9], push: 2, fits, over, held });
      }
    }
    const touched: string[] = [];
    groups.forEach((g, k) => {
      const next = spotsFrom(101 + k);
      for (let n = 0; n < g.count; n++) {
        const { sim, passes } = withPasses();
        if (g.over) {
          assert.equal(sim.setDiverter(true), true);
          for (let i = 0; i < 0.25 / DT; i++) sim.step();
        }
        if (g.held) sim.holdInLock(place(sim, lock.x, lock.z));
        let x = 0, z = 0;
        do [x, z] = [g.box[0] + next() * (g.box[1] - g.box[0]), g.box[2] + next() * (g.box[3] - g.box[2])]; while (!g.fits(x, z));
        const a = next() * 2 * Math.PI, v = next() * g.push;
        const id = place(sim, x, z, v * Math.cos(a), v * Math.sin(a));
        for (let i = 0; i < 6 / DT && sim.items.has(id); i++) sim.step();
        const seen = passesOf(passes, id);
        if (seen.length) touched.push(`${g.name}: from (${x.toFixed(2)}, ${z.toFixed(2)}): ${seen.join(', ')}`);
      }
    });
    assert.deepEqual(touched, [], `${touched.length} touched a switch:\n${touched.slice(0, 6).join('\n')}`);
  }],
  ['every flipper and spinner has its angle', () => {
    const { sim } = make();
    assert.deepEqual(sim.flipperAngles(), TABLE_IN_USE.flippers.map((f) => f.restDeg));
    sim.flip('right', true);
    for (let i = 0; i < 10; i++) sim.step();
    // Both right flippers (the main one and the upper one) go up together.
    assert.deepEqual(sim.flipperAngles(), TABLE_IN_USE.flippers.map((f) => (f.side === 'right' ? f.upDeg : f.restDeg)));
    assert.equal(sim.spinnerAngles().length, 1 + TABLE_IN_USE.spinners.length);
    assert.equal(sim.spinnerAngles()[0], sim.spinnerAngle());
  }],
  ['the snapshot', () => {
    const { sim } = make();
    // The toys' word is the physics' own, as it stands when the snapshot is taken: none on a fresh table, and then the
    // tomb open and the gate set over, both set before any ball is on the table (the gate waits for a ball in its way).
    assert.equal(sim.snapshot(0).readUInt32LE(43), 0, 'a fresh table: the tomb shut and the gate at rest');
    sim.openTomb();
    assert.equal(sim.setDiverter(true), true);
    const a = sim.launch(3);
    const b = sim.launch(null);
    sim.flip('left', true);
    for (let i = 0; i < 10; i++) sim.step();
    assert.equal(sim.flipperAngle('left'), 30);
    assert.equal(sim.flipperAngle('right'), 210);
    const snap = sim.snapshot(0b101);
    const count = sim.items.size;
    assert.equal(count, 2);
    assert.equal(snap[0], SNAP_TYPE_PINBALL);
    assert.equal(snap[0], 4);
    assert.equal(snap.length, SNAP_PINBALL_HEADER + count * SNAP_STRIDE);
    assert.equal(snap.length, 47 + count * SNAP_STRIDE);
    assert.ok(Math.abs(snap.readDoubleLE(1) - sim.time) < 1e-9);
    assert.equal(snap.readUInt16LE(9), count);
    assert.ok(Math.abs(snap.readFloatLE(11) - sim.flipperAngle('left')) < 1e-4);
    assert.ok(Math.abs(snap.readFloatLE(15) - sim.flipperAngle('right')) < 1e-4);
    assert.ok(Math.abs(snap.readFloatLE(19) - sim.flipperAngles()[2]) < 1e-4);
    assert.equal(snap.readUInt32LE(23), 0b101);
    assert.equal(snap.readUInt32LE(27), sim.targetsDown());
    assert.equal(snap.readUInt32LE(31), sim.targetsTurned());
    assert.ok(Math.abs(snap.readFloatLE(35) - sim.spinnerAngle()) < 1e-4);
    assert.ok(Math.abs(snap.readFloatLE(39) - sim.spinnerAngles()[1]) < 1e-4);
    assert.equal(snap.readUInt32LE(43), TOY.tombOpen | TOY.diverterOver, 'the toys: the tomb open and the gate set over');
    assert.equal(snap.readUInt32LE(43), sim.toys());
    const ids = [0, 1].map((k) => snap.readUInt32LE(SNAP_PINBALL_HEADER + k * SNAP_STRIDE)).sort();
    assert.deepEqual(ids, [a, b].sort());
    const p = sim.items.get(a)!.body.translation();
    const o = SNAP_PINBALL_HEADER + (snap.readUInt32LE(SNAP_PINBALL_HEADER) === a ? 0 : SNAP_STRIDE);
    assert.ok(Math.abs(snap.readFloatLE(o + 4) - p.x) < 1e-4 && Math.abs(snap.readFloatLE(o + 12) - p.z) < 1e-4);
    // The owner goes in the ball's body state (for the 'spawn' message): the binary body has no room for it.
    assert.equal(sim.state(a).owner, 3);
    assert.equal(sim.state(b).owner, undefined);
  }],
];

const started = Date.now();
let failed = 0;
for (const [name, check] of checks) {
  const t0 = Date.now();
  try {
    check();
    console.log(`ok    ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}
console.log(failed ? `\n${failed} failed` : `\nall ${checks.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
