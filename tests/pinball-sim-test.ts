// The pinball's physics (server/sim.ts), headless with the real Rapier: a launch goes up the plunger lane and onto the
// table, no shot gets out through a wall, a ball left alone drains, the right flipper shoots to the upper table (up the
// left ramp and round the left orbit) and the left flipper into the pyramid's Eye bank and the sun bumper, a bumper
// kicks, the kickback and the lock do what the game asks, flip targets turn and their banks match once, a saucer's ball
// is held and let go cleanly, and the snapshot has the Task 2 layout. (The pathways round the table are
// pinball-layout-test's.)
// Usage: npm run pinball-sim-test (or npx tsx tests/pinball-sim-test.ts)
import assert from 'node:assert/strict';
import { initPhysics } from '@kit/server';
import { SNAP_STRIDE } from '@kit/shared';
import { DT, PinballSim, type Hit } from '../src/server/sim';
import { SNAP_PINBALL_HEADER, SNAP_TYPE_PINBALL } from '../src/shared/pinball';
import { TABLE_IN_USE, TABLE, type Table } from '../src/shared/table';

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
 * flip targets and other parts that act in touch itself: it passes touch an empty to-drop list that nothing reads, so a
 * drop target touched this way reports but never drops.
 */
function touch(sim: PinballSim, id: number, partId: string): void {
  const S = sim as any;
  const part = [...S.parts.values()].find((p: any) => p.id === partId);
  assert.ok(part, `no part ${partId}`);
  assert.ok(part.kind !== 'target' || TABLE_IN_USE.targets[part.index].flip, `touch() is for flip targets, not the drop target ${partId}`);
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

const targetIndex = (id: string) => TABLE_IN_USE.targets.findIndex((t) => t.id === id);

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
    // bumpers' level, as on the stand-in table); the left flipper's, from these drops, run into the pyramid's Eye bank.
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
  ["the left flipper's shots reach the Eye bank and the sun bumper", () => {
    // On the pyramid table the left flipper shoots at the pyramid's lower-right face (the Eye bank, facing it) and the sun
    // bumper above the right sling. Ten drops onto it, the same kind as the right flipper's but fixed (evenly spread over
    // the drop spots and the flip points; measured 2026-10-17: 8 of these 10 hit one or the other, 7 the sun bumper).
    const flipper = TABLE_IN_USE.flippers.find((f) => f.side === 'left')!;
    const eyeBank = TABLE_IN_USE.banks.find((b) => b.id === 'bank-eye')!.targets;
    const results: string[] = [];
    let reached = 0;
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
      for (let i = 0; i < 2 / DT && sim.items.has(id); i++) sim.step();
      const got = hits.filter((h) => h.ball === id && (h.id === 'bumper-sun' || eyeBank.includes(h.id))).map((h) => h.id);
      if (got.length) reached++;
      results.push([...new Set(got)].join('+') || 'neither');
    }
    assert.ok(reached >= 7, `only ${reached} of 10 shots hit the Eye bank or the sun bumper: ${results.join(', ')}`);
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
    // Down the left outlane onto the kickback.
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
    // The scarab drop target, on the pyramid's upper-left face (which runs at 45 degrees): a ball rolled square at it.
    const drop = TABLE_IN_USE.targets[targetIndex('target-scarab')];
    const shot = place(sim, drop.x - 0.6 * Math.SQRT1_2, drop.z + 0.6 * Math.SQRT1_2, 9 * Math.SQRT1_2, -9 * Math.SQRT1_2);
    for (let i = 0; i < 0.4 / DT && !hits.some((h) => h.id === drop.id); i++) sim.step();
    const plaque = TABLE_IN_USE.targets.find((t) => t.flip)!;
    const id = place(sim, -0.4, 3, 0, 0);
    touch(sim, id, plaque.id);
    sim.step();
    assert.ok(hits.some((h) => h.kind === 'target' && h.id === drop.id && h.ball === shot), 'the drop target reported');
    assert.ok(hits.some((h) => h.kind === 'target' && h.id === plaque.id && h.ball === id), 'the plaque reported');
    assert.equal(sim.targetsDown(), 1 << targetIndex(drop.id), 'the drop target is down');
    assert.equal(sim.targetsTurned(), 1 << targetIndex(plaque.id), 'the plaque is turned, and not down');
    sim.resetDropTargets();
    assert.equal(sim.targetsDown(), 0);
    assert.equal(sim.targetsTurned(), 1 << targetIndex(plaque.id), 'resetDropTargets leaves the plaques');
    sim.resetTargets();
    assert.equal(sim.targetsTurned(), 0, 'resetTargets turns the plaques back too');
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
    assert.equal(snap.length, 43 + count * SNAP_STRIDE);
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
