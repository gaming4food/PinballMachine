// The table in use (TABLE_IN_USE, the pyramid table) in the real physics (server/sim.ts): every way round it can be
// travelled at its rate, no ball gets off it, and nothing keeps a ball. These are the Blender spike's checks of the
// layout (spike/blender/validate-layout10.mts and check-upper.mts) turned into assertions, at the spike's thresholds.
// Each check stands alone: a table of its own, and the seeded random started again (seed 7; seed 3 for the drops round
// the upper flipper, and a seed each for the drops and the shots round each of the quest's toys and for the drops round
// the full lock), so a failing check can be run again to look into, whatever the others do. The aimed shots (the
// orbits, the lock, the left ramp, the right spinner, the centre lane) have no random in them: ten shots each, with a
// fixed spread across ±5% of the aim (SPREAD). The quest's toys (the pop-ups, the mummy, the tomb and the diverter's
// gate) are checked up and down: no ball stuck or got off the table round them, the left ramp as it was with them
// down, the tomb's kick to a flipper, the gate's shots into the lock, and how the magnet and the tomb share the centre
// lane; and, with a ball held in the lock (which kicks a second one back out), none of the gate's shots and none of
// the balls dropped round the lock stays on the table. It runs in about a minute, and prints one line per check.
// Usage: npm run pinball-layout-test [-- <words>: only the checks whose names hold them]
import assert from 'node:assert/strict';
import { initPhysics } from '@kit/server';
import { DT, PinballSim, WALL_HALF, type Hit } from '../src/server/sim';
import { FLIPPER_SHAPE, flipperTip, TABLE, TABLE_IN_USE as L, wallsWithTomb, type Table, type Target } from '../src/shared/table';

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

/** Starts a check on a table of its own, with the seeded random started again: each check stands alone. */
function fresh(s: number): void {
  seed = s;
  hits = [];
  sim = new PinballSim(L, (h) => hits.push(h));
}

/** Shot n of 10's spread: vx and vz each scaled by a factor evenly spaced across ±5%, vz's in another order (7n mod 10),
 * so the ten shots cover the speeds and the angles either side of the aim. */
const SPREAD = Array.from({ length: 10 }, (_, n) => [1 + 0.05 * ((2 * n) / 9 - 1), 1 + 0.05 * ((2 * ((7 * n) % 10)) / 9 - 1)]);

/**
 * Fires 10 balls from (x, z) at about (vx, vz), with the fixed spread, on a table of its own. Each shot is
 * `{ ok, seen }`: whether it met `goal` in time (the shot stops there), and whether it met `seen` on the way.
 */
function fire(x: number, z: number, vx: number, vz: number, seconds: number, goal: (p: P, h: Hit[]) => boolean, seen: (p: P) => boolean = () => false): { ok: boolean; seen: boolean }[] {
  fresh(7);
  return SPREAD.map(([fx, fz]) => {
    reset();
    const id = add(x, z, vx * fx, vz * fz);
    let met = false;
    for (let i = 0; i < seconds / DT; i++) {
      sim.step();
      const p = pos(id);
      if (p && seen(p)) met = true;
      if (p && goal(p, hits)) return { ok: true, seen: met };
      if (!p) break;
    }
    return { ok: false, seen: met };
  });
}
const count = (shots: { ok: boolean }[]) => shots.filter((s) => s.ok).length;
const top = (p: P) => p.z > LENGTH - 1.4;
const has = (pred: (h: Hit) => boolean) => (_p: P, h: Hit[]) => h.some(pred);

// --- The quest's toys ---

const R = TABLE.ballRadius;
/** The walls as the physics builds them: the tomb's doorway cut into the pyramid, and its jambs. */
const WALLS = wallsWithTomb(L);
const RISING = L.targets.filter((t) => t.rise);
const POPUPS = RISING.filter((t) => t.rise === 'drop');
const MUMMY = RISING.find((t) => t.rise === 'hold')!;
const TOMB = L.tomb!;
const GATE = L.diverter!;
const GATE_RAMP = L.ramps.find((r) => r.id === GATE.ramp)!;

/** The distance from p to the segment a-b, in (x, z). */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz);
}
/** A target's face, end to end, as the physics stands it: at its angle, or along the wall nearest it. */
function faceOf(t: Target): [[number, number], [number, number]] {
  let ux: number, uz: number;
  if (t.angle !== undefined) [ux, uz] = [Math.cos((t.angle * Math.PI) / 180), Math.sin((t.angle * Math.PI) / 180)];
  else {
    let best = Infinity;
    [ux, uz] = [0, 1];
    for (const w of WALLS) for (let i = 0; i + 1 < w.points.length; i++) {
      const d = segDist([t.x, t.z], w.points[i], w.points[i + 1]);
      if (d >= best) continue;
      best = d;
      const [a, b] = [w.points[i], w.points[i + 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      [ux, uz] = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    }
  }
  const h = t.width / 2;
  return [[t.x - h * ux, t.z - h * uz], [t.x + h * ux, t.z + h * uz]];
}
/** The gate's middle line, from its pivot, at an angle. */
const gateLine = (deg: number): [[number, number], [number, number]] =>
  [GATE.pivot, [GATE.pivot[0] + GATE.length * Math.cos((deg * Math.PI) / 180), GATE.pivot[1] + GATE.length * Math.sin((deg * Math.PI) / 180)]];
/**
 * Whether a ball can be put down at (x, z) on the playfield: not in a solid (inSolid), and clear by a little more than
 * its radius of every wall (the doorway cut in), every target (each toy as if raised), every bumper, sling and flipper,
 * and the gate wherever it swings. A ball made inside a collider stays wedged there: not a trap of the table's.
 */
function fits(x: number, z: number): boolean {
  if (inSolid(x, z)) return false;
  const room = R + 0.03;
  const p: [number, number] = [x, z];
  for (const w of WALLS) for (let i = 0; i + 1 < w.points.length; i++) if (segDist(p, w.points[i], w.points[i + 1]) < room + WALL_HALF) return false;
  for (const t of L.targets) if (segDist(p, ...faceOf(t)) < room + (t.depth ?? 0.2) / 2) return false;
  for (const b of L.bumpers) if (!b.y0 && Math.hypot(x - b.x, z - b.z) < b.radius + room) return false;
  for (const s of L.slings) if (segDist(p, s.a, s.b) < room + WALL_HALF) return false;
  for (const f of L.flippers) if (segDist(p, f.pivot, flipperTip(f)) < room + FLIPPER_SHAPE.baseRadius) return false;
  return true;
}
/** A spot on the gate's ramp, `k` path points up it (fractional) and `across` east of its centre line, on its floor. */
function onGateRamp(k: number, across: number): P {
  const P = GATE_RAMP.path, i = Math.min(P.length - 2, Math.floor(k)), u = k - i;
  const [ax, az, ay] = P[i], [bx, bz, by] = P[i + 1];
  const l = Math.hypot(bx - ax, bz - az), ex = (bz - az) / l, ez = -(bx - ax) / l;
  return { x: ax + u * (bx - ax) + across * ex, y: ay + u * (by - ay) + R + 0.02, z: az + u * (bz - az) + across * ez };
}

/** Every toy up, as the game raises them, with no ball on the table yet: the pop-ups, the mummy, the tomb, the gate. */
function raiseToys(): void {
  for (const t of RISING) sim.raiseTarget(t.id);
  sim.openTomb();
  assert.ok(sim.setDiverter(true), 'with no ball on the table the gate swings over');
  for (let i = 0; i < 0.25 / DT; i++) sim.step();
}
/** Kept up, as pinball-play's toys=up keeps them: a pop-up knocked down rises again once the ball is clear of it. */
function keepUp(): void {
  for (const t of POPUPS) sim.raiseTarget(t.id);
}
/** Every toy down again: the pop-ups and the mummy lowered, the tomb shut and the gate back at rest. */
function lowerToys(): void {
  for (const t of RISING) sim.lowerTarget(t.id);
  assert.ok(sim.closeTomb(), 'with no ball on the table the tomb shuts');
  assert.ok(sim.setDiverter(false), 'and the gate swings back');
  for (let i = 0; i < 0.25 / DT; i++) sim.step();
}

/**
 * Where balls are dropped and fired round each toy, a spot at random each time (up: whether the toys are up). Round
 * the three pop-ups, the mummy and the tomb's mouth, anywhere a ball fits within 0.9 of them. Round the gate, half up
 * on its ramp (path points 10 to the top, across the strip a ball's centre has between the rails) and half on the
 * playfield where a ball the gate turns out drops (round the lock); with the gate over, only below it on the ramp: it
 * won't swing over while a ball is on its ramp or in the dish above it, and over, none gets past it (pinball-sim-test),
 * so no ball is ever above it then.
 */
const ZONES: { name: string; spot: (up: boolean) => P }[] = [
  { name: 'the pop-ups', spot: () => inBox(POPUPS, 0.9) },
  { name: 'the mummy', spot: () => inBox([MUMMY], 0.9) },
  { name: "the tomb's mouth", spot: () => inBox([{ x: TOMB.x, z: TOMB.z - 0.45 }], 0.9) },
  {
    name: 'the gate',
    spot: (up) => {
      if (Math.random() < 0.5) return inBox([{ x: -2.5, z: 12.5 }], 0.75);
      for (;;) {
        const p = onGateRamp(10 + Math.random() * ((up ? 12.8 : GATE_RAMP.path.length - 1.05) - 10), (Math.random() - 0.5) * 0.22);
        if (segDist([p.x, p.z], ...gateLine(up ? GATE.overDeg : GATE.restDeg)) > R + WALL_HALF + 0.03) return p;
      }
    },
  },
];
/** A spot where a ball fits within `pad` of the box round some parts, on the playfield. */
function inBox(parts: { x: number; z: number }[], pad: number): P {
  const xs = parts.map((p) => p.x), zs = parts.map((p) => p.z);
  const [x0, x1, z0, z1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...zs) - pad, Math.max(...zs) + pad];
  for (;;) {
    const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0);
    if (fits(x, z)) return { x, y: R, z };
  }
}

/** Whether a ball at p touches a flipper as it stands now: within 0.02 of its shape (round at its pivot and tip). */
function touchesFlipper(p: P): boolean {
  const angles = sim.flipperAngles();
  return L.flippers.some((f, i) => {
    const a = (angles[i] * Math.PI) / 180, reach = f.length - FLIPPER_SHAPE.tipRadius;
    const ux = Math.cos(a), uz = Math.sin(a), rx = p.x - f.pivot[0], rz = p.z - f.pivot[1];
    const t = Math.max(0, Math.min(reach, rx * ux + rz * uz));
    const thick = FLIPPER_SHAPE.baseRadius + ((FLIPPER_SHAPE.tipRadius - FLIPPER_SHAPE.baseRadius) * t) / reach;
    return Math.hypot(rx - t * ux, rz - t * uz) < thick + R + 0.02;
  });
}

/** Up on the gate's ramp past the start of the gap in its rail: the shot has reached the gate. */
function atTheGate(p: P): boolean {
  const P = GATE_RAMP.path;
  for (let i = GATE_RAMP.opening!.from; i + 1 < P.length; i++) {
    const [ax, az, ay] = P[i], [bx, bz, by] = P[i + 1];
    const dx = bx - ax, dz = bz - az, u = ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz);
    if (u < 0 || u > 1) continue;
    if (Math.hypot(p.x - ax - u * dx, p.z - az - u * dz) < GATE_RAMP.width / 2 && p.y > ay + u * (by - ay) + R - 0.06) return true;
  }
  return false;
}
/** The left ramp's shots (the fixed spread, then the 5 x 5 grid), fired on a table: each one's end, and whether it
 * reached the gate and went into the lock on the way. */
const GRID = [0.95, 0.975, 1, 1.025, 1.05];
const RAMP_SHOTS: [number, number][] = [...SPREAD.map(([a, b]) => [a, b] as [number, number]), ...GRID.flatMap((a) => GRID.map((b) => [a, b] as [number, number]))];
function rampShots(table: Table, prepare: () => void): { dish: boolean; top: boolean; gate: boolean; lock: boolean }[] {
  return RAMP_SHOTS.map(([fx, fz]) => {
    // Each on a table of its own, so none depends on where an earlier one left the gate.
    hits = [];
    sim = new PinballSim(table, (h) => hits.push(h));
    prepare();
    const id = add(-0.1, 3.0, -23 * fx, 44 * fz);
    const shot = { dish: false, top: false, gate: false, lock: false };
    for (let i = 0; i < 3 / DT; i++) {
      sim.step();
      const p = pos(id);
      if (!p) break;
      if (atLeftRampTop(p)) shot.top = true;
      if (atTheGate(p)) shot.gate = true;
      if (hits.some((h) => h.kind === 'lock' && h.ball === id)) shot.lock = true;
      if (onDish(p)) { shot.dish = true; break; }
    }
    return shot;
  });
}
const code = (s: { dish: boolean; top: boolean }) => (s.dish ? 'D' : s.top ? 'T' : '-');

const checks: [string, () => string][] = [
  ['60 launches', () => {
    fresh(7);
    let tops = 0, esc = 0, stuck = 0, onFlipper = 0;
    for (let n = 0; n < 60; n++) {
      reset();
      const id = sim.launch(null);
      let sawTop = false, gone = false;
      for (let i = 0; i < 90 / DT; i++) {
        sim.step();
        const p = pos(id);
        if (!p) { gone = true; break; }
        if (escaped(p)) { esc++; gone = true; break; }
        if (p.z > LENGTH - 1.6) sawTop = true;
      }
      tops += +sawTop;
      if (!gone) onAFlipper(pos(id)!) ? onFlipper++ : stuck++;
    }
    assert.equal(esc, 0, `${esc} of 60 launches got off the table`);
    assert.equal(tops, 60, `only ${tops} of 60 launches reached the top`);
    assert.equal(stuck, 0, `${stuck} of 60 launches were still on the table after 90 s`);
    return `60/60 reached the top, 0 escaped, 0 stuck (${onFlipper} resting on a flipper)`;
  }],
  ['2000 random shots', () => {
    fresh(7);
    let esc = 0;
    const first: string[] = [];
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
          esc++;
          if (first.length < 5) first.push(`shot ${n} from (${x.toFixed(2)}, ${z.toFixed(2)}) at ${v.toFixed(1)} u/s: at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
          break;
        }
      }
    }
    assert.equal(esc, 0, `${esc} of 2000 shots got off the table:\n${first.join('\n')}`);
    return '0/2000 escaped';
  }],
  ['150 balls left alone', () => {
    fresh(7);
    let drained = 0, onFlipper = 0;
    const stuck: string[] = [];
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
      if (gone) { drained++; continue; }
      const p = pos(id)!;
      if (onAFlipper(p)) onFlipper++;
      else stuck.push(`from (${x.toFixed(2)}, ${z.toFixed(2)}) still at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
    }
    assert.deepEqual(stuck, [], `${stuck.length} of 150 were still on the table after 90 s`);
    return `${drained} drained, ${onFlipper} resting on a flipper, 0 stuck`;
  }],
  ['the left orbit, the right orbit and the lock', () => {
    const got = {
      leftOrbit: count(fire(-4.5, 6.8, 0, 34, 3, top)),
      rightOrbit: count(fire(3.7, 8.0, 0, 34, 3, top)),
      lock: count(fire(-2.2, 9.6, -0.1, 20, 3, has((h) => h.kind === 'lock'))),
    };
    assert.deepEqual(got, { leftOrbit: 10, rightOrbit: 10, lock: 10 });
    return `left orbit ${got.leftOrbit}/10 to the top, right orbit ${got.rightOrbit}/10, lock ${got.lock}/10`;
  }],
  ['the shot up the left ramp', () => {
    // Each shot runs until it reaches the dish, and counts whether it passed the ramp's top end on the way.
    const shots = fire(-0.1, 3.0, -23, 44, 3, onDish, atLeftRampTop);
    const atTop = shots.filter((s) => s.seen).length, onTheDish = count(shots);
    const each = shots.map((s) => (s.ok ? 'D' : s.seen ? 'T' : '-')).join('');
    // And a 5 x 5 grid across the same ±5% (vx's factor by vz's), each to the dish.
    fresh(7);
    const F = [0.95, 0.975, 1, 1.025, 1.05];
    let grid = 0;
    for (const a of F) {
      for (const b of F) {
        reset();
        const id = add(-0.1, 3.0, -23 * a, 44 * b);
        for (let i = 0; i < 3 / DT; i++) {
          sim.step();
          const p = pos(id);
          if (!p) break;
          if (onDish(p)) { grid++; break; }
        }
      }
    }
    // The table's rate on this fixed spread is 9/10, and 20 of 25 on the grid (it was 7/10 and 11/25 with the mouth's
    // wide flare and the ramp pointing 18 degrees off the shot's line, 2026-10-17). The misses are the steepest shots,
    // about 115 degrees, which clip the Ankh bank's top plaque before they reach the mouth.
    // The bars sit exactly at those measured rates on purpose: they are tripwires. The shots have no random in them, so
    // the rates move only when the physics or the table does. A failure here means one of them changed: investigate what
    // did (the ramp, the flippers, the pyramid, the sim), don't lower the bars.
    assert.ok(atTop >= 9, `only ${atTop}/10 reached the left ramp's top end (per shot, D dish, T top only, - neither: ${each})`);
    assert.ok(onTheDish >= 9, `only ${onTheDish}/10 reached the dish (per shot: ${each})`);
    assert.ok(grid >= 20, `only ${grid}/25 of the grid reached the dish`);
    return `${atTop}/10 reached its top end, ${onTheDish}/10 the dish (per shot: ${each}); ${grid}/25 of the grid the dish`;
  }],
  ['the dish and the right ramp', () => {
    fresh(7);
    let back = 0, rode = 0;
    for (let n = 0; n < 20; n++) {
      reset();
      const id = dropAt(DISH.x + (Math.random() - 0.5) * 1.2, 1.1, 13.9 + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      for (let i = 0; i < 20 / DT; i++) {
        sim.step();
        const p = pos(id);
        if (!p || p.y < 0.4) { back++; break; }
      }
    }
    // A ball leaving the dish east rides the wireform across the top and down the right, and drops off its end.
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
      if (high && down) rode++;
    }
    assert.deepEqual({ back, rode }, { back: 20, rode: 20 });
    return `${back}/20 left the dish, ${rode}/20 leaving east rode the right ramp down`;
  }],
  ['the Scarab saucer', () => {
    fresh(7);
    let caught = 0, out = 0, stillHeld = 0;
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
      caught += +got;
      out += +(got && gone);
      if (sim.heldBy(id) === 'saucer') stillHeld++;
    }
    assert.deepEqual({ caught, out, stillHeld }, { caught: 20, out: 20, stillHeld: 0 });
    return `${caught}/20 caught, ${out}/20 kicked out, ${stillHeld} still held`;
  }],
  ['the magnet', () => {
    fresh(7);
    let grabbed = 0, left = 0, right = 0, stillHeld = 0;
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
      grabbed += +got;
      if (side < 0) left++;
      if (side > 0) right++;
      if (sim.heldBy(id) === 'saucer') stillHeld++;
    }
    assert.deepEqual({ grabbed, left, right, stillHeld }, { grabbed: 20, left: 10, right: 10, stillHeld: 0 });
    return `${grabbed}/20 grabbed, ${left} flung left and ${right} right, ${stillHeld} still held`;
  }],
  ['the right spinner', () => {
    const orbit = count(fire(3.7, 8.0, 0, 34, 3, has((h) => h.id === 'spinner-right')));
    fresh(7);
    let ramp = 0;
    for (let k = 0; k < 10; k++) {
      reset();
      const id = dropAt(-2.75, 1.1, 14.35, 8, 0);
      for (let i = 0; i < 8 / DT && pos(id); i++) {
        sim.step();
        const p = pos(id);
        if (p && p.y < 0.4) break;
      }
      if (hits.some((x) => x.id === 'spinner-right')) ramp++;
    }
    assert.equal(orbit, 10, `only ${orbit}/10 right-orbit shots turned it`);
    assert.equal(ramp, 0, `${ramp}/10 balls riding the right ramp over it turned it`);
    return `${orbit}/10 right-orbit shots turned it, ${ramp}/10 riding the ramp over it`;
  }],
  ['the centre rollovers', () => {
    const n = count(fire(-0.4, 4.6, 0, -2, 3, (_p, h) => ['centre-1', 'centre-2', 'centre-3', 'centre-4'].every((c) => h.some((x) => x.id === c))));
    assert.equal(n, 10, `only ${n}/10 balls down the centre lane hit all four`);
    return `${n}/10 hit all four`;
  }],
  ['each bank, its three plaques hit in turn', () => {
    fresh(7);
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
      assert.deepEqual({ bank: b.id, hitEach, matchedEarly, matches, allTurned, backToFront }, { bank: b.id, hitEach: 3, matchedEarly: false, matches: 1, allTurned: true, backToFront: true });
    }
    return `${L.banks.map((b) => b.id).join(', ')}: 3/3 hit, matched once on the third, all turned, back 1.2 s later`;
  }],
  ['120 balls dropped round the upper flipper and the Horus bank', () => {
    fresh(3);
    const stuck: string[] = [];
    for (let k = 0; k < 120; k++) {
      reset();
      const x = 0.8 + Math.random() * 2.2, z = 8.6 + Math.random() * 3.4;
      // Not inside a plaque (a ball made inside a collider stays wedged there: not a trap of the table's).
      if (L.targets.some((t) => Math.hypot(x - t.x, z - t.z) < 0.5)) { k--; continue; }
      const id = add(x, z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
      let down = false;
      for (let i = 0; i < 30 / DT; i++) {
        sim.step();
        const p = pos(id);
        if (!p || p.z < 4) { down = true; break; }
      }
      if (!down) {
        const p = pos(id)!;
        stuck.push(`from (${x.toFixed(2)}, ${z.toFixed(2)}) still at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
      }
    }
    assert.deepEqual(stuck, [], `${stuck.length} of 120 were still above z 4 after 30 s`);
    return '0/120 still above z 4 after 30 s';
  }],
  ['60 balls dropped round each toy, up and down: none stuck, none out', () => {
    // Up is every toy up and kept so (a pop-up knocked down raised again once the ball is clear of it), as play with
    // the quest's modes will have them; down is the table as it plays today. A ball still on the table after 60 s and
    // not lying on a flipper is stuck (one lying still on a flipper for a second stays there: nothing flips here).
    const lines: string[] = [];
    const bad: string[] = [];
    ZONES.forEach((zone, z) => {
      for (const up of [false, true]) {
        fresh(21 + 2 * z + +up);
        let drained = 0, onFlipper = 0;
        for (let n = 0; n < 60; n++) {
          reset();
          if (up) raiseToys();
          const s = zone.spot(up);
          const id = dropAt(s.x, s.y, s.z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
          let end = 'stuck', still = 0;
          for (let i = 0; i < 60 / DT; i++) {
            sim.step();
            if (up) keepUp();
            const p = pos(id);
            if (!p) { end = 'drained'; break; }
            if (escaped(p)) { end = 'out'; break; }
            const v = sim.items.get(id)!.body.linvel();
            still = onAFlipper(p) && Math.hypot(v.x, v.y, v.z) < 0.05 ? still + 1 : 0;
            if (still > 1 / DT) { end = 'on a flipper'; break; }
          }
          if (end === 'drained') drained++;
          else if (end === 'on a flipper') onFlipper++;
          else {
            const p = pos(id)!;
            bad.push(`${zone.name} ${up ? 'up' : 'down'}: from (${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)}) ${end} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})${sim.heldBy(id) ? `, held by the ${sim.heldBy(id)}` : ''}`);
          }
        }
        lines.push(`${zone.name} ${up ? 'up' : 'down'} ${drained}+${onFlipper}`);
      }
    });
    assert.deepEqual(bad, [], `${bad.length} stuck or out:\n${bad.slice(0, 6).join('\n')}`);
    return `none stuck, none out (drained + lying on a flipper: ${lines.join(', ')})`;
  }],
  ['120 shots from round each toy, up and down: none gets off the table', () => {
    const lines: string[] = [];
    const bad: string[] = [];
    ZONES.forEach((zone, z) => {
      for (const up of [false, true]) {
        fresh(41 + 2 * z + +up);
        let esc = 0;
        for (let n = 0; n < 120; n++) {
          reset();
          if (up) raiseToys();
          const s = zone.spot(up);
          const a = Math.random() * Math.PI * 2, v = 5 + Math.random() * 55;
          const id = dropAt(s.x, s.y, s.z, Math.cos(a) * v, Math.sin(a) * v);
          for (let i = 0; i < 3 / DT; i++) {
            sim.step();
            if (up) keepUp();
            const p = pos(id);
            if (!p) break;
            if (escaped(p)) {
              esc++;
              if (bad.length < 5) bad.push(`${zone.name} ${up ? 'up' : 'down'}: from (${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)}) at ${v.toFixed(1)} u/s: at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
              break;
            }
          }
        }
        lines.push(`${zone.name} ${up ? 'up' : 'down'} ${esc}`);
      }
    });
    assert.deepEqual(bad, [], `shots got off the table:\n${bad.join('\n')}`);
    return `0 of 120 got off the table round each (${lines.join(', ')})`;
  }],
  ['the left ramp with the toys down', () => {
    // Every toy raised and then put away again (the gate swung over and back), and then the tripwire's shots, on one
    // table as 'the shot up the left ramp' fires them: down, the toys are no part of the ramp's way, and the gate at
    // rest is its rail.
    fresh(7);
    raiseToys();
    lowerToys();
    const shots = SPREAD.map(([fx, fz]) => {
      reset();
      const id = add(-0.1, 3.0, -23 * fx, 44 * fz);
      let met = false;
      for (let i = 0; i < 3 / DT; i++) {
        sim.step();
        const p = pos(id);
        if (!p) break;
        if (atLeftRampTop(p)) met = true;
        if (onDish(p)) return 'D';
      }
      return met ? 'T' : '-';
    }).join('');
    let grid = 0;
    for (const a of GRID) {
      for (const b of GRID) {
        reset();
        const id = add(-0.1, 3.0, -23 * a, 44 * b);
        for (let i = 0; i < 3 / DT; i++) {
          sim.step();
          const p = pos(id);
          if (!p) break;
          if (onDish(p)) { grid++; break; }
        }
      }
    }
    const dish = [...shots].filter((c) => c === 'D').length;
    // The tripwire's own bars ('the shot up the left ramp'): investigate a failure, don't lower them.
    assert.ok(dish >= 9, `only ${dish}/10 reached the dish (per shot: ${shots})`);
    assert.ok(grid >= 20, `only ${grid}/25 of the grid reached the dish`);
    return `${dish}/10 reached the dish (per shot: ${shots}); ${grid}/25 of the grid`;
  }],
  ['the tomb kicks a ball out to a flipper', () => {
    // Twenty balls rolled up the centre lane into the open tomb (from a spread of spots across the lane, fast enough
    // to pass over the magnet), each held and kicked out with the flippers in another state: each up or down at the
    // kick, and from then on flapping now and then, as the escape check's do. Each is followed from its kick until it
    // drains or 4 s have passed. Within a flipper's reach is where nearFlipper says (its sweep, and 15 degrees past
    // it), or touching a flipper: a flipper rising under a ball over its base bats it, or cradles it there, before
    // it's in the sweep (2 of these 20 kicks, measured 2026-10-18).
    fresh(7);
    let near = 0;
    const each: string[] = [];
    const bad: string[] = [];
    for (let n = 0; n < 20; n++) {
      reset();
      sim.openTomb();
      const up = { left: n % 2 === 1, right: n % 4 >= 2 };
      sim.flip('left', up.left);
      sim.flip('right', up.right);
      const v = 15 + (n % 5) * 2;
      const id = add(TOMB.x + ((n % 7) - 3) * 0.03, 3.6, 0, v);
      sim.items.get(id)!.body.setAngvel({ x: v / R, y: 0, z: 0 }, true);
      for (let i = 0; i < 1 / DT && sim.heldBy(id) !== 'tomb'; i++) sim.step();
      assert.equal(sim.heldBy(id), 'tomb', `ball ${n}: the tomb caught it`);
      for (let i = 0; i < 2 / DT && sim.heldBy(id) === 'tomb'; i++) sim.step();
      assert.equal(sim.heldBy(id), null, `ball ${n}: the tomb kicked it out`);
      hits = [];
      let reached = false, touched = false, end = 'on the table';
      for (let i = 0; i < 4 / DT; i++) {
        for (const side of ['left', 'right'] as const) {
          if (Math.random() < 0.04) {
            up[side] = !up[side];
            sim.flip(side, up[side]);
          }
        }
        sim.step();
        const p = pos(id);
        if (!p) { end = 'drained'; break; }
        const onFlipper = touchesFlipper(p);
        if (sim.nearFlipper(id) || onFlipper) reached = true;
        if (onFlipper || hits.some((h) => h.kind === 'sling' && h.ball === id)) touched = true;
      }
      near += +reached;
      each.push(reached ? 'F' : end === 'drained' ? 'd' : '-');
      if (end === 'drained' && !touched) bad.push(`ball ${n} drained without touching a flipper or a sling`);
    }
    assert.deepEqual(bad, [], bad.join('\n'));
    assert.ok(near >= 18, `only ${near}/20 came within a flipper's reach (per ball, F a flipper, d drained, - neither: ${each.join('')})`);
    return `${near}/20 came within a flipper's reach, none drained without touching a flipper or a sling (${each.join('')})`;
  }],
  ['the gate over sends 9 of 10 left-ramp shots into the lock; at rest the left ramp is as before', () => {
    // The tripwire's shots up the left ramp, the fixed spread and the grid, each on a table of its own: with the gate
    // at rest each ends as it does on the table with no gate and no gap in the rail (D the dish, T its top only, -
    // neither); with it over (and the other toys down: the mummy up stands in this shot), at least 9 in 10 of those
    // that reach the gate go into the lock, and the shots that make the dish today all reach it.
    const bare: Table = { ...L, diverter: undefined, ramps: L.ramps.map((r) => (r.id === GATE.ramp ? { ...r, opening: undefined } : r)) };
    const before = rampShots(bare, () => {}).map(code).join('');
    const rest = rampShots(L, () => {}).map(code).join('');
    const over = rampShots(L, () => {
      assert.ok(sim.setDiverter(true), 'with no ball on the table the gate swings over');
      for (let i = 0; i < 0.25 / DT; i++) sim.step();
    });
    const reached = over.filter((s) => s.gate), locked = reached.filter((s) => s.lock).length;
    const each = over.map((s) => (s.gate ? (s.lock ? 'L' : 'g') : s.dish ? 'D' : '-')).join('');
    assert.equal(rest, before, 'at rest, every shot ends as it does with no gate');
    assert.equal(over.filter((s) => s.dish).length, 0, `with the gate over no shot reaches the dish (${each})`);
    const dishToday = [...before].filter((c) => c === 'D').length;
    assert.ok(reached.length >= dishToday, `only ${reached.length} reached the gate, where ${dishToday} make the dish with no gate (${each})`);
    assert.ok(locked >= 0.9 * reached.length, `only ${locked} of the ${reached.length} that reached the gate went into the lock (per shot, L the lock, g the gate only, - neither: ${each})`);
    return `at rest as with no gate (${rest.slice(0, 10)} ${rest.slice(10)}); over, ${locked} of the ${reached.length} that reached the gate into the lock (${each.slice(0, 10)} ${each.slice(10)})`;
  }],
  ['with a ball held in the lock, the gate over leaves none of the left ramp\'s shots on the table', () => {
    // The gate sends the left ramp's shots into the lock, and from the first that starts multiball the lock holds that
    // ball: so over, with a ball held, is the gate's own state. The tripwire's shots up the left ramp (the fixed spread
    // and the grid), each on a table of its own with the gate over and a ball held in the lock as multiball holds it
    // (holdInLock), the flippers at rest, each followed 12 s: none is still on the table then but the held ball and
    // one lying still on a flipper.
    const stuck: string[] = [];
    let drained = 0, onFlipper = 0, metLock = 0;
    for (const [fx, fz] of RAMP_SHOTS) {
      hits = [];
      sim = new PinballSim(L, (h) => hits.push(h));
      assert.ok(sim.setDiverter(true), 'with no ball on the table the gate swings over');
      for (let i = 0; i < 0.25 / DT; i++) sim.step();
      const held = add(L.lock.x, L.lock.z, 0, 0);
      sim.holdInLock(held);
      const id = add(-0.1, 3.0, -23 * fx, 44 * fz);
      let end = 'still on the table', still = 0;
      for (let i = 0; i < 12 / DT; i++) {
        sim.step();
        const p = pos(id);
        if (!p) { end = 'drained'; break; }
        const v = sim.items.get(id)!.body.linvel();
        still = onAFlipper(p) && Math.hypot(v.x, v.y, v.z) < 0.05 ? still + 1 : 0;
        if (still > 1 / DT) { end = 'on a flipper'; break; }
      }
      assert.equal(sim.heldBy(held), 'lock', `shot (${fx}, ${fz}): the lock keeps the ball it holds`);
      if (hits.some((h) => h.kind === 'lock' && h.ball === id)) metLock++;
      if (end === 'drained') drained++;
      else if (end === 'on a flipper') onFlipper++;
      else {
        const p = pos(id)!, v = sim.items.get(id)!.body.linvel();
        stuck.push(`shot (${fx.toFixed(3)}, ${fz.toFixed(3)}) at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}), ${Math.hypot(p.x - L.lock.x, p.z - L.lock.z).toFixed(2)} from the lock, at ${Math.hypot(v.x, v.y, v.z).toFixed(2)} units/s`);
      }
    }
    assert.deepEqual(stuck, [], `${stuck.length} of the ${RAMP_SHOTS.length} still on the table after 12 s (${metLock} met the lock):\n${stuck.join('\n')}`);
    return `${metLock} of the ${RAMP_SHOTS.length} met the lock holding a ball; none still on the table after 12 s (${drained} drained, ${onFlipper} lying on a flipper)`;
  }],
  ['60 balls dropped round the lock while it holds a ball, the toys up and down: none stuck, none out', () => {
    // The ball the full lock kicks out must not come back to rest against the held ball, nor anywhere else. Balls let
    // go round the lock every which way (where the gate's check drops them on the playfield, clear of the held ball),
    // with a ball held in the lock as multiball holds it and every toy up (the gate over) or every toy down, the
    // flippers at rest, each followed until it drains, 60 s at most, as the drops round each toy are.
    const lines: string[] = [];
    const bad: string[] = [];
    for (const up of [false, true]) {
      fresh(61 + +up);
      let drained = 0, onFlipper = 0, metLock = 0;
      for (let n = 0; n < 60; n++) {
        hits = [];
        sim = new PinballSim(L, (h) => hits.push(h));
        if (up) raiseToys();
        const held = add(L.lock.x, L.lock.z, 0, 0);
        sim.holdInLock(held);
        let s: P;
        do s = inBox([{ x: -2.5, z: 12.5 }], 0.75); while (Math.hypot(s.x - L.lock.x, s.z - L.lock.z) < 2 * R + 0.03);
        const id = add(s.x, s.z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
        let end = 'stuck', still = 0;
        for (let i = 0; i < 60 / DT; i++) {
          sim.step();
          if (up) keepUp();
          const p = pos(id);
          if (!p) { end = 'drained'; break; }
          if (escaped(p)) { end = 'out'; break; }
          const v = sim.items.get(id)!.body.linvel();
          still = onAFlipper(p) && Math.hypot(v.x, v.y, v.z) < 0.05 ? still + 1 : 0;
          if (still > 1 / DT) { end = 'on a flipper'; break; }
        }
        assert.equal(sim.heldBy(held), 'lock', 'the lock keeps the ball it holds');
        if (hits.some((h) => h.kind === 'lock' && h.ball === id)) metLock++;
        if (end === 'drained') drained++;
        else if (end === 'on a flipper') onFlipper++;
        else {
          const p = pos(id)!;
          bad.push(`toys ${up ? 'up' : 'down'}: from (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) ${end} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}), ${Math.hypot(p.x - L.lock.x, p.z - L.lock.z).toFixed(2)} from the lock`);
        }
      }
      lines.push(`toys ${up ? 'up' : 'down'} ${drained}+${onFlipper}, ${metLock} met the lock`);
    }
    assert.deepEqual(bad, [], `${bad.length} stuck or out:\n${bad.slice(0, 6).join('\n')}`);
    return `none stuck, none out (drained + lying on a flipper: ${lines.join('; ')})`;
  }],
  ['the magnet and the tomb share the centre lane', () => {
    // With the tomb open: balls rolled up the centre lane from z 3.6 (across its middle, at 6 to 20 units/s, rolling)
    // are each the magnet's or the tomb's, the slow ones the magnet's (it holds a ball under 12 units/s) and the fast
    // ones the tomb's; none goes on past both. (The magnet's own check, above, is with the tomb shut.)
    fresh(7);
    const speeds = Array.from({ length: 15 }, (_, k) => 6 + k);
    const byMagnet: number[] = [], byTomb: number[] = [];
    const neither: string[] = [];
    for (const v of speeds) {
      for (const dx of [-0.06, 0, 0.06]) {
        reset();
        sim.openTomb();
        const id = add(TOMB.x + dx, 3.6, 0, v);
        sim.items.get(id)!.body.setAngvel({ x: v / R, y: 0, z: 0 }, true);
        let who = '';
        for (let i = 0; i < 1.5 / DT && !who && pos(id); i++) {
          sim.step();
          const h = hits.find((x) => x.ball === id && (x.kind === 'tomb' || (x.kind === 'saucer' && x.id === MAGNET.id)));
          if (h) who = h.kind;
        }
        if (who === 'tomb') byTomb.push(v);
        else if (who === 'saucer') byMagnet.push(v);
        else neither.push(`${v} at ${dx}`);
      }
    }
    assert.deepEqual(neither, [], `rolled up the lane, ${neither.length} went to neither (speed at offset): ${neither.join(', ')}`);
    const magnetMax = Math.max(...byMagnet), tombMin = Math.min(...byTomb);
    assert.ok(magnetMax < tombMin, `the magnet took one at ${magnetMax} and the tomb one at ${tombMin}: they don't split by speed`);
    return `of ${speeds.length * 3} rolled up the lane at 6 to 20 units/s, the magnet took ${byMagnet.length} (up to ${magnetMax}), the tomb ${byTomb.length} (from ${tombMin})`;
  }],
];

// `npm run pinball-layout-test -- <words>` runs only the checks whose names hold them.
const only = process.argv.slice(2).join(' ');
if (only) checks.splice(0, checks.length, ...checks.filter(([name]) => name.includes(only)));
const started = Date.now();
let failed = 0;
for (const [name, check] of checks) {
  const t0 = Date.now();
  try {
    console.log(`ok    ${name}: ${check()} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').slice(0, 8).join('\n      ')}`);
  }
}
console.log(failed ? `\n${failed} failed` : `\nall ${checks.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
