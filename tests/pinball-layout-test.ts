// The table in use (TABLE_IN_USE, the pyramid table) in the real physics (server/sim.ts): every way round it can be
// travelled at its rate, no ball gets off it, and nothing keeps a ball. These are the Blender spike's checks of the
// layout (spike/blender/validate-layout10.mts and check-upper.mts) turned into assertions. They run as the spike's did:
// one table, one seeded random (seed 7) drawn in the spike's order, and the drops round the upper flipper on a table of
// their own with seed 3. So they give the spike's numbers exactly, and a failing check can be run again to look into.
// (Some of the spike's runs aren't asserted here, but still run, so the draws after them stay the spike's: a shot's 5%
// spread decides some of these rates, the left ramp's most.) It runs for a minute or so, and prints one line per check.
// Usage: npm run pinball-layout-test (or npx tsx tests/pinball-layout-test.ts)
import assert from 'node:assert/strict';
import { initPhysics } from '@kit/server';
import { DT, PinballSim, type Hit } from '../src/server/sim';
import { TABLE, TABLE_IN_USE as L } from '../src/shared/table';

await initPhysics();

let seed = 7;
Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

type P = { x: number; y: number; z: number };
const LENGTH = TABLE.length;

let hits: Hit[] = [];
let sim = new PinballSim(L, (h) => hits.push(h));
const pos = (id: number) => sim.items.get(id)?.body.translation() as P | undefined;
/** A ball put down at (x, z) moving at (vx, vz): the sim's own addBall, as the spike's checks do. */
const add = (x: number, z: number, vx: number, vz: number): number => (sim as any).addBall(null, x, z, vx, vz);
/** A ball let go at (x, y, z), up off the playfield (on the dish, or on a ramp). */
function dropAt(x: number, y: number, z: number, vx: number, vz: number): number {
  const id = add(x, z, vx, vz);
  sim.items.get(id)!.body.setTranslation({ x, y, z }, true);
  return id;
}
const reset = () => {
  sim.clear();
  sim.resetTargets();
  hits = [];
};

/** The outer wall's outline, closed along the bottom below the drain. */
const OUTLINE = [...L.walls[0].points, [5, -2], [-5, -2]] as [number, number][];
function onPlayfield(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [ax, az] = OUTLINE[i], [bx, bz] = OUTLINE[j];
    if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
  }
  return inside;
}
/** Out of the cabinet, or down on the floor outside the outer wall (behind the arch: a ball there is lost). */
const escaped = (p: P) =>
  Math.abs(p.x) > 5.2 || p.z < -1 || p.z > LENGTH + 0.5 || p.y < -0.05 || p.y > TABLE.glassY + 0.05 || (p.y < 0.6 && !onPlayfield(p.x, p.z));

// Where a ball can't be put down: inside a solid nothing can get into (a slingshot, under a low ramp, the nook sealed
// under the dish, the pyramid, the island under the upper flipper), or off the playfield. The spike's, for this table.
function inSling(x: number, z: number): boolean {
  return L.walls.filter((w) => w.kind === 'slingback').some((w) => {
    const [a, c, b] = w.points;
    const s = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = s(a, c, [x, z]), d2 = s(c, b, [x, z]), d3 = s(b, a, [x, z]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) || Math.hypot(x - (a[0] + b[0] + c[0]) / 3, z - (a[1] + b[1] + c[1]) / 3) < 0.6;
  });
}
function underLowRamp(x: number, z: number): boolean {
  return L.ramps.some((r) => r.path.some(([px, pz, py], i) => i + 1 < r.path.length && Math.min(py, r.path[i + 1][2]) < 0.95 &&
    Math.hypot(x - (px + r.path[i + 1][0]) / 2, z - (pz + r.path[i + 1][1]) / 2) < r.width / 2 + Math.hypot(r.path[i + 1][0] - px, r.path[i + 1][1] - pz) / 2 + 0.3));
}
const inNook = (x: number, z: number) => z > 13.2 && z < 15.4 && x < -2.0 && x > -4.0 && (x + 3.24) * 1.8 - (z - 13.4) * 1.24 < 0;
const inSolid = (x: number, z: number) =>
  !onPlayfield(x, z) || underLowRamp(x, z) || inNook(x, z) || Math.abs(x + 0.4) + Math.abs(z - 7.1) < 1.55 || (x > 2.1 && z > 12.0 && z < 14.9 && x < 3.3) || inSling(x, z);

const onAFlipper = (p: P) => L.flippers.some((f) => Math.hypot(p.x - f.pivot[0], p.z - f.pivot[1]) < f.length + 0.4);
const LEFT_RAMP = L.ramps.find((r) => r.id === 'ramp-left')!;
const LEFT_RAMP_TOP = LEFT_RAMP.path[LEFT_RAMP.path.length - 1];
const DISH = L.dishes[0];
/** Up on the dish's floor. */
const onDish = (p: P) => p.y > 0.95 && Math.hypot(p.x - DISH.x, p.z - DISH.z) < DISH.r;
/** Up on the left ramp at its top end, where it meets the dish. */
const atLeftRampTop = (p: P) => p.y > LEFT_RAMP_TOP[2] + 0.1 && Math.hypot(p.x - LEFT_RAMP_TOP[0], p.z - LEFT_RAMP_TOP[1]) < 0.6;
const SAUCER = L.saucers.find((s) => s.id === 'saucer-scarab')!;
const MAGNET = L.saucers.find((s) => s.id === 'magnet-ra')!;

/**
 * Fires 10 balls from (x, z) at about (vx, vz) (each 5% off, either way), counting those that meet `goal` in time (each
 * run stops there). `seen` counts, as well, the runs that met it on the way.
 */
function fireSeen(x: number, z: number, vx: number, vz: number, seconds: number, goal: (p: P, h: Hit[]) => boolean, seen: (p: P) => boolean = () => false): { ok: number; seen: number } {
  let ok = 0, saw = 0;
  for (let n = 0; n < 10; n++) {
    reset();
    const id = add(x, z, vx * (1 + (Math.random() - 0.5) * 0.1), vz * (1 + (Math.random() - 0.5) * 0.1));
    let met = false;
    for (let i = 0; i < seconds / DT; i++) {
      sim.step();
      const p = pos(id);
      if (p && seen(p)) met = true;
      if (p && goal(p, hits)) { ok++; break; }
      if (!p) break;
    }
    saw += +met;
  }
  return { ok, seen: saw };
}
const fire = (x: number, z: number, vx: number, vz: number, seconds: number, goal: (p: P, h: Hit[]) => boolean): number =>
  fireSeen(x, z, vx, vz, seconds, goal).ok;

/** The spike's fan of shots from the flippers' line (asserted nothing; run so the table's clock and state after it are the
 * spike's): how many aims there were. */
function fan(...xs: number[]): number {
  let aims = 0;
  for (const x0 of xs) for (let vx = -8; vx <= 8; vx += 2) for (let vz = 14; vz <= 26; vz += 4) {
    aims++;
    reset();
    const id = add(x0, 3.3, vx, vz);
    for (let i = 0; i < 1.5 / DT && pos(id); i++) sim.step();
  }
  return aims;
}

// --- The runs, in the spike's order ---

const started = Date.now();

// Launches: each reaches the top, and none gets off or is left on the table (resting on a flipper is allowed: the
// game's auto-save flips it away).
const launches = { top: 0, escaped: 0, stuck: 0, onFlipper: 0 };
for (let n = 0; n < 60; n++) {
  reset();
  const id = sim.launch(null);
  let sawTop = false, gone = false;
  for (let i = 0; i < 90 / DT; i++) {
    sim.step();
    const p = pos(id);
    if (!p) { gone = true; break; }
    if (escaped(p)) { launches.escaped++; gone = true; break; }
    if (p.z > LENGTH - 1.6) sawTop = true;
  }
  launches.top += +sawTop;
  if (!gone) onAFlipper(pos(id)!) ? launches.onFlipper++ : launches.stuck++;
}

// Shots at up to full speed from random spots: none may leave the table.
const shots = { escaped: 0, first: [] as string[] };
for (let n = 0; n < 2000; n++) {
  reset();
  let x = 0, z = 0;
  do { x = -4.6 + Math.random() * 8.6; z = 1 + Math.random() * (LENGTH - 2.5); } while (inSolid(x, z));
  const a = Math.random() * Math.PI * 2, v = 5 + Math.random() * 55;
  const id = add(x, z, Math.cos(a) * v, Math.sin(a) * v);
  for (let i = 0; i < 3 / DT; i++) {
    sim.step();
    const p = pos(id);
    if (!p) break;
    if (escaped(p)) {
      shots.escaped++;
      if (shots.first.length < 5) shots.first.push(`shot ${n} from (${x.toFixed(2)}, ${z.toFixed(2)}) at ${v.toFixed(1)} u/s: at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
      break;
    }
  }
}

// The pathways.
const top = (p: P) => p.z > LENGTH - 1.4;
const has = (pred: (h: Hit) => boolean) => (_p: P, h: Hit[]) => h.some(pred);
const paths = {
  leftOrbit: fire(-4.5, 6.8, 0, 34, 3, top),
  leftOrbitSpinner: fire(-4.5, 6.8, 0, 34, 3, has((h) => h.kind === 'spinner')),
  rightOrbit: fire(3.7, 8.0, 0, 34, 3, top),
  lock: fire(-2.2, 9.6, -0.1, 20, 3, has((h) => h.kind === 'lock')),
  saucerInLockLane: fire(-2.2, 9.6, -0.1, 20, 3, has((h) => h.kind === 'saucer')),
  topLanes: fire(-0.4, 13.2, 0, 9, 3, has((h) => h.kind === 'rollover')),
  bumpers: fire(-0.4, 9.15, 0, 12, 2, has((h) => h.kind === 'bumper')),
  aroundPyramidLeft: fire(-2.6, 6.0, 7, 26, 3, (p) => p.z > 10.2 && p.y < 0.4),
  // The shot up the left ramp from the right flipper's line, twice (as the spike's): first counting the balls that reach
  // the ramp's top end on the way to the dish, then (a second ten) those that reach the dish.
  leftRampTop: fireSeen(-0.1, 3.0, -23, 44, 3, onDish, atLeftRampTop).seen,
  aroundPyramidRight: fire(2.4, 5.2, 0, 26, 3, (p) => p.z > 10.2),
  fan: fan(-1.4, 0.6),
  leftRampDish: fire(-0.1, 3.0, -23, 44, 3, onDish),
  leftRampBumper4: fire(-0.1, 3.0, -23, 44, 4, has((h) => h.id === 'bumper-4')),
  inlaneLeft: fire(-3.7, 5.3, 0, -1, 2, has((h) => h.id === 'inlane-left')),
  inlaneRight: fire(2.75, 5.3, 0, -1, 2, has((h) => h.id === 'inlane-right')),
  outlaneRight: fire(3.72, 4.5, 0, -1, 2, has((h) => h.id === 'outlane-right')),
};

// Balls let go on the dish all leave it; balls leaving it east ride the right ramp (the wireform) down and off its end.
const dish = { back: 0, rode: 0 };
for (let n = 0; n < 20; n++) {
  reset();
  const id = dropAt(DISH.x + (Math.random() - 0.5) * 1.2, 1.1, 13.9 + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  for (let i = 0; i < 20 / DT; i++) {
    sim.step();
    const p = pos(id);
    if (!p || p.y < 0.4) { dish.back++; break; }
  }
}
for (let n = 0; n < 20; n++) {
  reset();
  const id = dropAt(-2.75, 1.1, 14.35, 6 + Math.random() * 4, (Math.random() - 0.5) * 1);
  let high = false, down = false;
  for (let i = 0; i < 12 / DT; i++) {
    sim.step();
    const p = pos(id);
    if (!p) { down = true; break; }
    if (p.y > 0.95 && p.x > 3.2 && p.z < 12) high = true;
    if (high && p.y < 0.35 && p.z < 7.5) { down = true; break; }
  }
  if (high && down) dish.rode++;
}

// Balls dropped anywhere and left alone all drain (or rest on a flipper).
const leftAlone = { drained: 0, onFlipper: 0, stuck: [] as string[] };
for (let n = 0; n < 150; n++) {
  reset();
  let x = 0, z = 0;
  do { x = -4.6 + Math.random() * 8.6; z = 2 + Math.random() * (LENGTH - 3.5); } while (inSolid(x, z));
  const id = add(x, z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
  let gone = false;
  for (let i = 0; i < 90 / DT; i++) {
    sim.step();
    if (!pos(id)) { gone = true; break; }
  }
  if (gone) { leftAlone.drained++; continue; }
  const p = pos(id)!;
  if (onAFlipper(p)) leftAlone.onFlipper++;
  else leftAlone.stuck.push(`from (${x.toFixed(2)}, ${z.toFixed(2)}) still at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
}

// (The spike's fan of shots at the Horus bank came here. It asserts nothing and draws no random numbers, but it runs, so
// the table's clock and state after it are the spike's.)
for (let vx = 2; vx <= 14; vx += 2) for (let vz = 16; vz <= 30; vz += 2) {
  reset();
  const id = add(-1.4, 3.3, vx, vz);
  for (let i = 0; i < 1.5 / DT && pos(id); i++) sim.step();
}
// The Scarab saucer: slow balls rolling down at it are caught, held and kicked out; nothing stays in it.
const saucer = { caught: 0, out: 0, stillHeld: 0 };
for (let n = 0; n < 20; n++) {
  reset();
  const id = add(SAUCER.x + (Math.random() - 0.5) * 0.3, SAUCER.z + 1.3, (Math.random() - 0.5) * 0.6, -1 - Math.random() * 2);
  let got = false, gone = false;
  for (let i = 0; i < 8 / DT; i++) {
    sim.step();
    if (hits.some((h) => h.kind === 'saucer' && h.id === SAUCER.id && h.ball === id)) got = true;
    const p = pos(id);
    if (!p) { gone = true; break; }
    if (got && sim.heldBy(id) === null && Math.hypot(p.x - SAUCER.x, p.z - SAUCER.z) > 1.2) { gone = true; break; }
  }
  saucer.caught += +got;
  saucer.out += +(got && gone);
  if (sim.heldBy(id) === 'saucer') saucer.stillHeld++;
}
// (The spike ran a fast ball over the saucer here: no random numbers, nothing asserted. It stays, for the table's state.)
sim.clear();
hits = [];
{
  const id = add(SAUCER.x, 8.6, 0, 24);
  for (let i = 0; i < 1 / DT && pos(id); i++) sim.step();
}
// The right spinner: right-orbit shots turn it; balls riding the right ramp over it don't.
const rightSpinner = { orbit: fire(3.7, 8.0, 0, 34, 3, has((h) => h.id === 'spinner-right')), ramp: 0 };
for (let k = 0; k < 10; k++) {
  sim.clear(); hits = [];
  const id = dropAt(-2.75, 1.1, 14.35, 8, 0);
  for (let i = 0; i < 8 / DT && pos(id); i++) {
    sim.step();
    const p = pos(id);
    if (p && p.y < 0.4) break;
  }
  if (hits.some((x) => x.id === 'spinner-right')) rightSpinner.ramp++;
}
const centre = fire(-0.4, 4.6, 0, -2, 3, (_p, h) => ['centre-1', 'centre-2', 'centre-3', 'centre-4'].every((c) => h.some((x) => x.id === c)));

// (The spike's runs at the Eye target, the sun bumper and the upper flipper came here: not asserted, but they draw
// random numbers, so they run.)
for (let n = 0; n < 20; n++) {
  reset();
  const id = add(0.9 + Math.random() * 0.8, 10.2, -1 - Math.random() * 3, -2 - Math.random() * 4);
  for (let i = 0; i < 3 / DT && pos(id); i++) sim.step();
}
fire(-1.4, 3.3, 13.5, 11.9, 2, has((h) => h.id === 'bumper-sun'));
for (let n = 0; n < 20; n++) {
  reset();
  const id = dropAt(-2.75, 1.1, 14.35, 6 + Math.random() * 4, (Math.random() - 0.5) * 1);
  for (let i = 0; i < 12 / DT && pos(id); i++) sim.step();
}
for (let n = 0; n < 40; n++) {
  reset();
  const id = add(2.0 + Math.random() * 0.5, 12.0 - Math.random() * 0.3, (Math.random() - 0.5) * 2, -1 - Math.random() * 2);
  const at = 0.1 + Math.random() * 0.5;
  let flipped = false;
  for (let i = 0; i < 4 / DT && pos(id); i++) {
    const t = i * DT;
    if (!flipped && t >= at) { sim.flip('right', true); flipped = true; }
    if (flipped && t >= at + 0.25) sim.flip('right', false);
    sim.step();
  }
  sim.flip('right', false);
}
// The magnet: slow balls over it are held and flung left and right in turn; none stays.
const magnet = { grabbed: 0, left: 0, right: 0, stillHeld: 0 };
for (let n = 0; n < 20; n++) {
  reset();
  const id = add(MAGNET.x + (Math.random() - 0.5) * 0.4, MAGNET.z + 0.3, (Math.random() - 0.5) * 0.4, -1 - Math.random());
  let got = false, side = 0;
  for (let i = 0; i < 3 / DT && pos(id); i++) {
    sim.step();
    if (hits.some((h) => h.id === MAGNET.id)) got = true;
    const p = pos(id);
    if (got && p && sim.heldBy(id) === null && Math.abs(p.x - MAGNET.x) > 0.8) { side = Math.sign(p.x - MAGNET.x); break; }
  }
  magnet.grabbed += +got;
  if (side < 0) magnet.left++;
  if (side > 0) magnet.right++;
  if (sim.heldBy(id) === 'saucer') magnet.stillHeld++;
}

// The banks: a bank's three plaques hit in turn each turn, the third matches the bank (one 'bank' hit), all three show
// their backs then, and they're back to the front 1.2 s later.
const banks: { id: string; hitEach: number; matchedEarly: boolean; matches: number; allTurned: boolean; backToFront: boolean }[] = [];
for (const b of L.banks) {
  reset();
  const idx = b.targets.map((id) => L.targets.findIndex((t) => t.id === id));
  let hitEach = 0, matchedEarly = false;
  for (const i of idx) {
    if (hits.some((h) => h.kind === 'bank')) matchedEarly = true;
    const t = L.targets[i];
    const a = ((t.angle ?? 90) * Math.PI) / 180;
    // In front of the plaque (toward the flippers' middle), aimed square at it.
    let nx = -Math.sin(a), nz = Math.cos(a);
    if (nx * (-0.4 - t.x) + nz * (2 - t.z) < 0) { nx = -nx; nz = -nz; }
    const id = add(t.x + nx * 0.7, t.z + nz * 0.7, -nx * 9, -nz * 9);
    const before = hits.length;
    for (let k = 0; k < 0.4 / DT && pos(id); k++) sim.step();
    if (hits.slice(before).some((h) => h.kind === 'target' && h.id === t.id)) hitEach++;
    sim.remove(id);
  }
  const matches = hits.filter((h) => h.kind === 'bank' && h.id === b.id).length;
  const allTurned = idx.every((i) => (sim.targetsTurned() >> i) & 1);
  for (let k = 0; k < 1.2 / DT; k++) sim.step();
  const backToFront = idx.every((i) => !((sim.targetsTurned() >> i) & 1));
  banks.push({ id: b.id, hitEach, matchedEarly, matches, allTurned, backToFront });
}

// Balls dropped round the upper flipper and the Horus bank, on a table of their own (seed 3): all come down.
seed = 3;
sim = new PinballSim(L, (h) => hits.push(h));
const upper = { tries: 0, stuck: [] as string[] };
for (let k = 0; k < 120; k++) {
  reset();
  const x = 0.8 + Math.random() * 2.2, z = 8.6 + Math.random() * 3.4;
  // Not inside a plaque (a ball made inside a collider stays wedged there: not a trap of the table's).
  if (L.targets.some((t) => Math.hypot(x - t.x, z - t.z) < 0.5)) { k--; continue; }
  upper.tries++;
  const id = add(x, z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
  let down = false;
  for (let i = 0; i < 30 / DT; i++) {
    sim.step();
    const p = pos(id);
    if (!p || p.z < 4) { down = true; break; }
  }
  if (!down) {
    const p = pos(id)!;
    upper.stuck.push(`from (${x.toFixed(2)}, ${z.toFixed(2)}) still at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  }
}

// --- The checks ---

const checks: [string, () => string][] = [
  ['60 launches', () => {
    assert.equal(launches.escaped, 0, `${launches.escaped} of 60 launches got off the table`);
    assert.equal(launches.top, 60, `only ${launches.top} of 60 launches reached the top`);
    assert.equal(launches.stuck, 0, `${launches.stuck} of 60 launches were still on the table after 90 s`);
    return `60/60 reached the top, 0 escaped, 0 stuck (${launches.onFlipper} resting on a flipper)`;
  }],
  ['2000 random shots', () => {
    assert.equal(shots.escaped, 0, `${shots.escaped} of 2000 shots got off the table:\n${shots.first.join('\n')}`);
    return '0/2000 escaped';
  }],
  ['150 balls left alone', () => {
    assert.deepEqual(leftAlone.stuck, [], `${leftAlone.stuck.length} of 150 were still on the table after 90 s`);
    return `${leftAlone.drained} drained, ${leftAlone.onFlipper} resting on a flipper, 0 stuck`;
  }],
  ['the left orbit, the right orbit and the lock', () => {
    const got = { leftOrbit: paths.leftOrbit, rightOrbit: paths.rightOrbit, lock: paths.lock };
    assert.deepEqual(got, { leftOrbit: 10, rightOrbit: 10, lock: 10 });
    return `left orbit ${got.leftOrbit}/10 to the top, right orbit ${got.rightOrbit}/10, lock ${got.lock}/10`;
  }],
  ['the shot up the left ramp', () => {
    assert.ok(paths.leftRampTop >= 9, `only ${paths.leftRampTop}/10 reached the left ramp's top end`);
    assert.ok(paths.leftRampDish >= 7, `only ${paths.leftRampDish}/10 reached the dish`);
    return `${paths.leftRampTop}/10 reached its top end, ${paths.leftRampDish}/10 the dish`;
  }],
  ['the dish and the right ramp', () => {
    assert.deepEqual(dish, { back: 20, rode: 20 });
    return `${dish.back}/20 left the dish, ${dish.rode}/20 leaving east rode the right ramp down`;
  }],
  ['the Scarab saucer', () => {
    assert.deepEqual(saucer, { caught: 20, out: 20, stillHeld: 0 });
    return `${saucer.caught}/20 caught, ${saucer.out}/20 kicked out, ${saucer.stillHeld} still held`;
  }],
  ['the magnet', () => {
    assert.deepEqual(magnet, { grabbed: 20, left: 10, right: 10, stillHeld: 0 });
    return `${magnet.grabbed}/20 grabbed, ${magnet.left} flung left and ${magnet.right} right, ${magnet.stillHeld} still held`;
  }],
  ['the right spinner', () => {
    assert.equal(rightSpinner.orbit, 10, `only ${rightSpinner.orbit}/10 right-orbit shots turned it`);
    assert.equal(rightSpinner.ramp, 0, `${rightSpinner.ramp}/10 balls riding the right ramp over it turned it`);
    return `${rightSpinner.orbit}/10 right-orbit shots turned it, ${rightSpinner.ramp}/10 riding the ramp over it`;
  }],
  ['the centre rollovers', () => {
    assert.equal(centre, 10, `only ${centre}/10 balls down the centre lane hit all four`);
    return `${centre}/10 hit all four`;
  }],
  ['each bank, its three plaques hit in turn', () => {
    for (const b of banks) {
      assert.deepEqual(b, { id: b.id, hitEach: 3, matchedEarly: false, matches: 1, allTurned: true, backToFront: true });
    }
    return `${banks.map((b) => b.id).join(', ')}: 3/3 hit, matched once on the third, all turned, back 1.2 s later`;
  }],
  ['120 balls dropped round the upper flipper and the Horus bank', () => {
    assert.equal(upper.tries, 120);
    assert.deepEqual(upper.stuck, [], `${upper.stuck.length} of 120 were still above z 4 after 30 s`);
    return '0/120 still above z 4 after 30 s';
  }],
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    console.log(`ok    ${name}: ${check()}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}
// The pathways not asserted, for the record (the spike's numbers).
console.log(`      (also: left orbit's spinner ${paths.leftOrbitSpinner}/10, lock lane's saucer ${paths.saucerInLockLane}/10, top lanes ${paths.topLanes}/10, ` +
  `bumpers ${paths.bumpers}/10, round the pyramid ${paths.aroundPyramidLeft}/10 left and ${paths.aroundPyramidRight}/10 right, ` +
  `bumper-4 off the left ramp ${paths.leftRampBumper4}/10, switches ${paths.inlaneLeft}/${paths.inlaneRight}/${paths.outlaneRight} of 10)`);
console.log(failed ? `\n${failed} failed` : `\nall ${checks.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
