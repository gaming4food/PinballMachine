// The pinball's stand-in table and its rules, as data: the table is on the playfield, the flippers leave a gap a ball
// can't stop in, every piece has its own id, and chat commands are read the way the rules say.
// Usage: npm run table-test (or npx tsx tests/table-test.ts)
import assert from 'node:assert/strict';
import { STAND_IN, TABLE, flipperTip } from '../src/shared/table';
import { LIT, RULES, SNAP_PINBALL_HEADER, SNAP_TYPE_PINBALL, parsePinballCommands } from '../src/shared/pinball';

const checks: [string, () => void][] = [
  ['everything is on the playfield', () => {
    const t = STAND_IN;
    const spots: [string, number, number][] = [];
    t.walls.forEach((w, i) => w.points.forEach(([x, z], j) => spots.push([`wall ${i} point ${j}`, x, z])));
    for (const b of t.bumpers) spots.push([b.id, b.x, b.z]);
    for (const s of t.slings) spots.push([`${s.id} a`, ...s.a], [`${s.id} b`, ...s.b]);
    for (const g of t.targets) spots.push([g.id, g.x, g.z]);
    for (const r of t.rollovers) spots.push([r.id, r.x, r.z]);
    spots.push(['spinner', t.spinner.x, t.spinner.z], ['lock', t.lock.x, t.lock.z], ['kickback', t.kickback.x, t.kickback.z]);
    spots.push(['plunger from', t.plunger.x, t.plunger.zFrom], ['plunger to', t.plunger.x, t.plunger.zTo]);
    for (const f of t.flippers) spots.push([`${f.side} flipper pivot`, ...f.pivot], [`${f.side} flipper tip`, ...flipperTip(f)]);
    for (const [what, x, z] of spots) {
      assert.ok(Math.abs(x) <= TABLE.width / 2 && z >= 0 && z <= TABLE.length, `${what} at (${x}, ${z}) is off the playfield`);
    }
  }],
  ['the table is a classic one: counts and the drain', () => {
    const t = STAND_IN;
    assert.equal(t.bumpers.length, 3);
    assert.equal(t.slings.length, 2);
    assert.equal(t.targets.length, 4);
    assert.equal(t.rollovers.length, 3);
    assert.deepEqual(t.flippers.map((f) => f.side).sort(), ['left', 'right']);
    assert.ok(t.walls.every((w) => w.points.length >= 2 && w.restitution >= 0 && w.restitution <= 1));
    assert.ok(t.drainZ < Math.min(...t.flippers.map((f) => Math.min(f.pivot[1], flipperTip(f)[1]))), 'the drain is below the flippers');
    assert.ok(t.plunger.x > 4 && t.plunger.zTo > t.plunger.zFrom, 'the plunger lane is on the right');
  }],
  ["the flippers leave a gap a ball can't stop in", () => {
    const [a, b] = STAND_IN.flippers.map((f) => flipperTip(f));
    const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
    assert.ok(gap < 4 * TABLE.ballRadius, `gap ${gap} is wide enough to hold a ball`);
    assert.ok(gap > 2 * TABLE.ballRadius, `gap ${gap} is too narrow for a ball to drain`);
  }],
  ['the flippers are mirrors, resting down and swinging up', () => {
    const l = STAND_IN.flippers.find((f) => f.side === 'left')!;
    const r = STAND_IN.flippers.find((f) => f.side === 'right')!;
    assert.equal(l.length, r.length);
    assert.equal(l.restDeg, -30);
    assert.equal(l.upDeg, 30);
    assert.equal(r.restDeg, 210);
    assert.equal(r.upDeg, 150);
    assert.ok(l.pivot[0] < r.pivot[0] && l.pivot[1] === r.pivot[1]);
  }],
  ['a ball fits past every sling end', () => {
    // The gap between each sling's ends and any wall must be at least a ball across plus a margin, or a ball wedges.
    const need = 2 * TABLE.ballRadius + 0.2;
    const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
    };
    for (const s of STAND_IN.slings) {
      for (const end of [s.a, s.b]) {
        for (const w of STAND_IN.walls) {
          for (let i = 0; i + 1 < w.points.length; i++) {
            const d = dist(end, w.points[i], w.points[i + 1]);
            assert.ok(d >= need, );
          }
        }
      }
    }
  }],
  ['ids are unique', () => {
    const t = STAND_IN;
    const ids = [...t.bumpers, ...t.slings, ...t.targets, ...t.rollovers].map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(', ')}`);
  }],
  ['the rules and the snapshot header', () => {
    assert.deepEqual(RULES, {
      autoSaveAfter: 3, flipHold: 0.25, ballSaverStart: 5, saverHype: 15, doubleHype: 30, maxExtraBalls: 2,
      pointsPerCoin: 150, ownerShare: 0.7, stuckSeconds: 4, launchDelay: 2,
    });
    assert.equal(SNAP_TYPE_PINBALL, 4);
    // u8 + f64 + u16 + f32 + f32 + u32 + u8 + f32
    assert.equal(SNAP_PINBALL_HEADER, 1 + 8 + 2 + 4 + 4 + 4 + 1 + 4);
    const bits = Object.values(LIT);
    assert.equal(new Set(bits).size, bits.length);
    assert.ok(bits.every((b) => b > 0 && (b & (b - 1)) === 0), 'each lit insert is one bit');
  }],
  ['parsePinballCommands: joining', () => {
    assert.equal(parsePinballCommands('ball').join, true);
    assert.equal(parsePinballCommands('!ball').join, true);
    assert.equal(parsePinballCommands('!BALL').join, true);
    assert.deepEqual(parsePinballCommands('hello'), { join: false, left: 0, right: 0 });
  }],
  ['parsePinballCommands: flips', () => {
    assert.deepEqual(parsePinballCommands('left left r'), { join: false, left: 2, right: 1 });
    assert.equal(parsePinballCommands('L').left, 1);
    assert.equal(parsePinballCommands('!left !right').left, 1);
    assert.equal(parsePinballCommands('!r').right, 1);
    assert.deepEqual(parsePinballCommands('  ball   Right\tRIGHT  '), { join: true, left: 0, right: 2 });
  }],
  ['parsePinballCommands: other words are ignored', () => {
    assert.deepEqual(parsePinballCommands('balloon'), { join: false, left: 0, right: 0 });
    assert.deepEqual(parsePinballCommands('leftover'), { join: false, left: 0, right: 0 });
    assert.deepEqual(parsePinballCommands('left,right'), { join: false, left: 0, right: 0 }, 'only whitespace splits words');
    assert.deepEqual(parsePinballCommands(''), { join: false, left: 0, right: 0 });
  }],
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').slice(0, 6).join('\n      ')}`);
  }
}
console.log(failed ? `\n${failed} failed` : `\nall ${checks.length} passed`);
process.exit(failed ? 1 : 0);
