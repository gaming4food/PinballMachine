// The pinball's pyramid table and its rules, as data: the table is on the playfield, the flippers leave a gap a ball
// can't stop in, every piece has its own id, it fits the snapshot header's room, the quest's toys (the pop-ups, the
// mummy, the tomb and the diverter) are there and the tomb's doorway is cut into the pyramid's wall, the four switches
// stand across the orbit lanes, the left ramp's top and the gate's gap, and chat commands are read as the rules say.
// Usage: npm run table-test (or npx tsx tests/table-test.ts)
import assert from 'node:assert/strict';
import { TABLE, TABLE_IN_USE, flipperTip, isLockTarget, tombMouth, wallsWithTomb, type Target } from '../src/shared/table';
import { LIT, RULES, SNAP_PINBALL_HEADER, SNAP_TYPE_PINBALL, parsePinballCommands } from '../src/shared/pinball';

/**
 * Where the uncut pyramid's two lower faces cross the line z = tomb.z, left end first: the doorway's mouth runs between
 * them (this reads the pyramid's data, not wallsWithTomb, so the two can be held against each other).
 */
function mouthEnds(): [[number, number], [number, number]] {
  const { tomb, walls } = TABLE_IN_USE;
  const pyramid = walls.find((w) => w.kind === 'pyramid')!;
  const ends: [number, number][] = [];
  for (let i = 0; i + 1 < pyramid.points.length; i++) {
    const [a, b] = [pyramid.points[i], pyramid.points[i + 1]];
    if ((a[1] - tomb!.z) * (b[1] - tomb!.z) < 0) ends.push([a[0] + ((tomb!.z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), tomb!.z]);
  }
  assert.equal(ends.length, 2, "the mouth's line crosses the pyramid's two lower faces");
  ends.sort((p, q) => p[0] - q[0]);
  return [ends[0], ends[1]];
}
const near = (p: [number, number], q: [number, number], eps = 1e-6) => Math.hypot(p[0] - q[0], p[1] - q[1]) < eps;
const deg = (a: number) => (a * 180) / Math.PI;
const rad = (a: number) => (a * Math.PI) / 180;

/** Where a wall's polyline crosses the line z, the crossing nearest x: the wall on one side of a lane there. */
function crossingNear(points: [number, number][], z: number, x: number): number {
  let best = NaN;
  for (let i = 0; i + 1 < points.length; i++) {
    const [[ax, az], [bx, bz]] = [points[i], points[i + 1]];
    if ((az - z) * (bz - z) > 0 || az === bz) continue;
    const at = ax + ((z - az) / (bz - az)) * (bx - ax);
    if (Number.isNaN(best) || Math.abs(at - x) < Math.abs(best - x)) best = at;
  }
  return best;
}

/** A target's face as the physics stands it (sim.ts): the rectangle `width` along its angle and `depth` thick. */
function faceOf(g: Target) {
  const a = ((g.angle ?? 0) * Math.PI) / 180;
  const u: [number, number] = [Math.cos(a), Math.sin(a)];
  return { c: [g.x, g.z] as [number, number], u, n: [-u[1], u[0]] as [number, number], hw: g.width / 2, ht: (g.depth ?? 0.2) / 2 };
}
/** The gap between two target faces along their best separating axis: negative when they overlap. */
function faceGap(a: ReturnType<typeof faceOf>, b: ReturnType<typeof faceOf>): number {
  const span = (f: ReturnType<typeof faceOf>, ax: [number, number]) => {
    const mid = f.c[0] * ax[0] + f.c[1] * ax[1];
    const reach = f.hw * Math.abs(f.u[0] * ax[0] + f.u[1] * ax[1]) + f.ht * Math.abs(f.n[0] * ax[0] + f.n[1] * ax[1]);
    return [mid - reach, mid + reach];
  };
  let best = -Infinity;
  for (const ax of [a.u, a.n, b.u, b.n]) {
    const [a0, a1] = span(a, ax), [b0, b1] = span(b, ax);
    best = Math.max(best, b0 - a1, a0 - b1);
  }
  return best;
}

const checks: [string, () => void][] = [
  ['everything is on the playfield', () => {
    const t = TABLE_IN_USE;
    const spots: [string, number, number][] = [];
    t.walls.forEach((w, i) => w.points.forEach(([x, z], j) => spots.push([`wall ${i} point ${j}`, x, z])));
    for (const b of t.bumpers) spots.push([b.id, b.x, b.z]);
    for (const s of t.slings) spots.push([`${s.id} a`, ...s.a], [`${s.id} b`, ...s.b]);
    for (const g of t.targets) spots.push([g.id, g.x, g.z]);
    for (const r of t.rollovers) spots.push([r.id, r.x, r.z]);
    for (const c of t.saucers) spots.push([c.id, c.x, c.z]);
    for (const p of t.spinners) spots.push([p.id, p.x, p.z]);
    for (const d of t.dishes) spots.push([d.id, d.x, d.z]);
    for (const r of t.ramps) r.path.forEach(([x, z], i) => spots.push([`${r.id} point ${i}`, x, z]));
    spots.push(['spinner', t.spinner.x, t.spinner.z], ['lock', t.lock.x, t.lock.z], ['kickback', t.kickback.x, t.kickback.z]);
    if (t.tomb) spots.push(['tomb', t.tomb.x, t.tomb.z], ['tomb held', ...t.tomb.held]);
    if (t.diverter) spots.push(['diverter pivot', ...t.diverter.pivot]);
    for (const s of t.switches) spots.push([s.id, s.x, s.z]);
    spots.push(['plunger from', t.plunger.x, t.plunger.zFrom], ['plunger to', t.plunger.x, t.plunger.zTo]);
    for (const f of t.flippers) spots.push([`${f.side} flipper pivot`, ...f.pivot], [`${f.side} flipper tip`, ...flipperTip(f)]);
    for (const [what, x, z] of spots) {
      assert.ok(Math.abs(x) <= TABLE.width / 2 && z >= 0 && z <= TABLE.length, `${what} at (${x}, ${z}) is off the playfield`);
    }
  }],
  ['the pyramid table is on the playfield, inside its walls', () => {
    const t = TABLE_IN_USE;
    const xs = t.walls.flatMap((w) => w.points.map((p) => p[0]));
    const zs = t.walls.flatMap((w) => w.points.map((p) => p[1]));
    assert.ok(Math.min(...xs) >= -5 && Math.max(...xs) <= 5);
    assert.ok(Math.min(...zs) >= 0 && Math.max(...zs) <= TABLE.length);
    assert.equal(t.walls[0].kind, 'outer');
    assert.ok(t.walls.every((w) => w.kind && w.points.length >= 2 && w.restitution >= 0 && w.restitution <= 1));
    assert.deepEqual(TABLE, { width: 10, length: 16.7, tiltDeg: 6.5, ballRadius: 0.27, glassY: 2.4, wallTop: 0.7 });
  }],
  ['the counts and the drain', () => {
    const t = TABLE_IN_USE;
    assert.equal(t.bumpers.length, 5);
    // The scarab and the eye, the three banks of plaques and the Ankh and Eye banks (14), then the quest's toys: three
    // pop-ups and the mummy.
    assert.equal(t.targets.length, 18);
    assert.equal(t.banks.length, 4);
    assert.equal(t.flippers.length, 3);
    assert.equal(t.saucers.length, 2);
    assert.equal(t.spinners.length, 1);
    assert.equal(t.slings.length, 2);
    assert.equal(t.ramps.length, 2);
    assert.equal(t.dishes.length, 1);
    assert.ok(t.drainZ < Math.min(...t.flippers.map((f) => Math.min(f.pivot[1], flipperTip(f)[1]))), 'the drain is below the flippers');
    assert.ok(t.plunger.x > 4 && t.plunger.zTo > t.plunger.zFrom, 'the plunger lane is on the right');
    assert.deepEqual(t.saucers.map((s) => [s.id, s.points]), [['saucer-scarab', 750], ['magnet-ra', 250]]);
  }],
  ['every bank names three flip targets of the table', () => {
    for (const b of TABLE_IN_USE.banks) {
      assert.equal(b.targets.length, 3);
      for (const id of b.targets) assert.equal(TABLE_IN_USE.targets.find((t) => t.id === id)?.flip, true, id);
    }
  }],
  ['every ramp starts on the playfield or at a dish, and stays under the glass', () => {
    const t = TABLE_IN_USE;
    for (const r of t.ramps) {
      for (const [, , y] of r.path) assert.ok(y + 2 * TABLE.ballRadius < TABLE.glassY, `${r.id} is too high at ${y}`);
      const [x, z, y] = r.path[0];
      const atDish = t.dishes.some((d) => Math.hypot(x - d.x, z - d.z) <= d.r + 0.01 && Math.abs(y - d.y) < 0.05);
      assert.ok(y === 0 || atDish, `${r.id} starts in the air at (${x}, ${z}, ${y})`);
    }
  }],
  ["the flippers leave a gap a ball can't stop in", () => {
    const [a, b] = TABLE_IN_USE.flippers.map((f) => flipperTip(f));
    const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
    assert.ok(gap < 4 * TABLE.ballRadius, `gap ${gap} is wide enough to hold a ball`);
    assert.ok(gap > 2 * TABLE.ballRadius, `gap ${gap} is too narrow for a ball to drain`);
  }],
  ["the main flippers are mirrored about the table's axis (x -0.4)", () => {
    const [l, r] = TABLE_IN_USE.flippers;
    assert.equal(l.side, 'left');
    assert.equal(r.side, 'right');
    assert.ok(Math.abs((l.pivot[0] + r.pivot[0]) / 2 - -0.4) < 1e-9, 'the pivots are mirrored about x -0.4');
    assert.equal(l.pivot[1], r.pivot[1]);
    assert.equal(l.length, r.length);
    assert.equal(l.restDeg, -30);
    assert.equal(l.upDeg, 30);
    assert.equal(r.restDeg, 210);
    assert.equal(r.upDeg, 150);
  }],
  ['a ball fits past every sling end', () => {
    // The gap between each sling's ends and any wall must be at least a ball across plus a margin, or a ball wedges.
    const need = 2 * TABLE.ballRadius + 0.2;
    const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
    };
    for (const s of TABLE_IN_USE.slings) {
      for (const end of [s.a, s.b]) {
        for (const w of TABLE_IN_USE.walls) {
          for (let i = 0; i + 1 < w.points.length; i++) {
            const d = dist(end, w.points[i], w.points[i + 1]);
            // A sling's back wall starts at the sling's own end (it closes the pocket behind the sling): that point is no gap.
            if (w.kind === 'slingback' && d < 1e-9) continue;
            assert.ok(d >= need, `${s.id} end (${end}) is ${d.toFixed(2)} from a wall; a ball needs ${need.toFixed(2)}`);
          }
        }
      }
    }
  }],
  ['ids are unique across every part', () => {
    const t = TABLE_IN_USE;
    const toys = [...(t.tomb ? [t.tomb] : []), ...(t.diverter ? [t.diverter] : [])];
    const ids = [...t.bumpers, ...t.slings, ...t.targets, ...t.rollovers, ...t.saucers, ...t.spinners, ...t.banks, ...t.ramps, ...t.dishes, ...toys, ...t.switches].map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(', ')}`);
  }],
  ['the toys: three pop-ups and the mummy start down, the lock keeps its two drop targets', () => {
    const t = TABLE_IN_USE;
    const rising = t.targets.filter((g) => g.rise);
    assert.deepEqual(rising.filter((g) => g.rise === 'drop').map((g) => g.id), ['target-popup-1', 'target-popup-2', 'target-popup-3']);
    assert.deepEqual(rising.filter((g) => g.rise === 'hold').map((g) => g.id), ['target-mummy']);
    assert.deepEqual(t.targets.filter(isLockTarget).map((g) => g.id), ['target-scarab', 'target-eye']);
    assert.ok(t.targets.length <= 32, 'the header has room for 32 targets');
    assert.equal(t.tomb?.id, 'tomb');
    // On the left ramp, where its shots reach it: no ball leaves the dish east, so on the right one it would never act.
    assert.equal(t.diverter?.ramp, 'ramp-left');
    assert.ok(t.tomb!.width > 2 * TABLE.ballRadius, 'the mouth is wider than a ball (the tomb catches at its mouth)');
  }],
  ["the first 14 targets keep their places in the snapshot header's bits; the rising ones come after them", () => {
    const ids = TABLE_IN_USE.targets.map((g) => g.id);
    assert.deepEqual(ids.slice(0, 14), [
      'target-scarab', 'target-ra-1', 'target-ra-2', 'target-ra-3', 'target-horus-1', 'target-horus-2', 'target-horus-3',
      'target-eye', 'target-ankh-1', 'target-ankh-2', 'target-ankh-3', 'target-eye-1', 'target-eye-2', 'target-eye-3',
    ]);
    assert.deepEqual(ids.slice(14), ['target-popup-1', 'target-popup-2', 'target-popup-3', 'target-mummy']);
  }],
  ['isLockTarget: a drop target that is neither a flip plaque nor a rising target', () => {
    const base: Target = { id: 'x', x: 0, z: 0, width: 1, points: 1 };
    assert.equal(isLockTarget(base), true);
    assert.equal(isLockTarget({ ...base, flip: true }), false);
    assert.equal(isLockTarget({ ...base, rise: 'drop' }), false);
    assert.equal(isLockTarget({ ...base, rise: 'hold' }), false);
  }],
  ['the tomb holds a ball at its mouth and kicks it out down the table; the diverter has its gap in the ramp', () => {
    const { tomb, diverter, ramps } = TABLE_IN_USE;
    // The doorway is narrower than a ball between its jambs' walls, so the tomb catches a ball at its mouth and holds
    // it there, in front of it (pinball-sim-test measures it clear of the door and the jambs).
    assert.ok(Math.abs(tomb!.held[0] - tomb!.x) < 1e-9, 'the held ball is centred on the mouth');
    assert.ok(tomb!.held[1] < tomb!.z && tomb!.held[1] > tomb!.z - 2 * TABLE.ballRadius, 'the held ball is just in front of the mouth');
    assert.ok(tomb!.eject[1] < 0, 'it is kicked out of the front corner, down the table');
    assert.ok(tomb!.hold > 0 && tomb!.speed > 0 && tomb!.points > 0);
    const ramp = ramps.find((r) => r.id === diverter!.ramp);
    assert.ok(ramp, `the diverter's ramp ${diverter!.ramp} is on the table`);
    const gap = ramp.opening;
    assert.ok(gap && gap.from >= 0 && gap.from < gap.to && gap.to <= ramp.path.length - 1, "the ramp's opening is between two of its path points");
    assert.ok(diverter!.length > 0 && diverter!.restDeg !== diverter!.overDeg, 'the gate swings between two angles');
  }],
  ['wallsWithTomb cuts the doorway out of the pyramid and adds its jambs', () => {
    const walls = wallsWithTomb(TABLE_IN_USE);
    const jambs = walls.filter((w) => w.kind === 'tomb');
    assert.equal(jambs.length, 2);
    // No pyramid wall crosses the doorway's mouth.
    const { x, z, width } = TABLE_IN_USE.tomb!;
    for (const w of walls.filter((w) => w.kind === 'pyramid')) for (const [px, pz] of w.points) assert.ok(Math.hypot(px - x, pz - z) >= width / 2 - 1e-9);
  }],
  ["the doorway's mouth runs between where the pyramid's lower faces cross z = tomb.z, tomb.width apart", () => {
    const { tomb } = TABLE_IN_USE;
    const [left, right] = mouthEnds();
    assert.ok(Math.abs(right[0] - left[0] - tomb!.width) < 1e-6, `the faces cross ${(right[0] - left[0]).toFixed(6)} apart, not ${tomb!.width}`);
    assert.ok(Math.abs((left[0] + right[0]) / 2 - tomb!.x) < 1e-6, "the mouth is centred on the tomb's x");
    // The cut outline runs from the mouth's right end round the right, top and left corners to its left end.
    const walls = wallsWithTomb(TABLE_IN_USE);
    const outline = walls.filter((w) => w.kind === 'pyramid');
    assert.equal(outline.length, 1, 'one pyramid wall');
    const pts = outline[0].points;
    const whole = TABLE_IN_USE.walls.find((w) => w.kind === 'pyramid')!.points;
    assert.ok(near(pts[0], right) && near(pts.at(-1)!, left), 'from the right end of the mouth to the left end');
    assert.deepEqual(pts.slice(1, -1), whole.slice(1, -1), 'round the right, top and left corners, which are where they were');
    assert.equal(outline[0].restitution, TABLE_IN_USE.walls.find((w) => w.kind === 'pyramid')!.restitution);
  }],
  ['tombMouth: the ends wallsWithTomb cuts the pyramid open between, or none', () => {
    const t = TABLE_IN_USE;
    const [left, right] = mouthEnds();
    const mouth = tombMouth(t);
    assert.ok(mouth, 'the pyramid table has a mouth');
    // On this table the outline runs from the right end of the mouth round the corners to the left end.
    assert.ok(near(mouth.a, right) && near(mouth.b, left), `a (${mouth.a}) is the right end and b (${mouth.b}) the left`);
    const outline = wallsWithTomb(t).find((w) => w.kind === 'pyramid')!.points;
    assert.deepEqual([outline[0], outline.at(-1)], [mouth.a, mouth.b], 'the cut outline runs from a to b');
    assert.equal(tombMouth({ ...t, tomb: undefined }), null, 'no tomb, no mouth');
    assert.equal(tombMouth({ ...t, walls: t.walls.filter((w) => w.kind !== 'pyramid') }), null, 'no pyramid, no mouth');
    // A mouth's line that misses the front corner's two faces can't cut it: below the corner, or above the corners the
    // faces rise to.
    for (const z of [5.7, 7.2]) {
      assert.throws(() => tombMouth({ ...t, tomb: { ...t.tomb!, z } }), /must cut the front corner/, `z ${z}`);
      assert.throws(() => wallsWithTomb({ ...t, tomb: { ...t.tomb!, z } }), /must cut the front corner/, `wallsWithTomb at z ${z}`);
    }
  }],
  ["the doorway's jambs run from the mouth's ends straight up the table as far as it is wide, and across to the middle", () => {
    // The pocket only has to close the pyramid's hollow behind the doorway: a ball is caught at the mouth, never
    // between the jambs (0.44 apart between their walls). It runs back as far as the mouth is wide, a square recess,
    // so the picture has a doorway to show. This check follows the shape wallsWithTomb gives it, and changes with it.
    const { tomb } = TABLE_IN_USE;
    const [left, right] = mouthEnds();
    const top = tomb!.z + (right[0] - left[0]);
    const jambs = wallsWithTomb(TABLE_IN_USE).filter((w) => w.kind === 'tomb');
    assert.equal(jambs.length, 2);
    for (const end of [left, right]) {
      const jamb = jambs.find((w) => near(w.points[0], end));
      assert.ok(jamb, `a jamb from the mouth's end at x ${end[0]}`);
      assert.equal(jamb.points.length, 3, 'a jamb is a 3-point polyline');
      assert.ok(near(jamb.points[1], [end[0], top]), 'straight up the table, as far as the mouth is wide');
      assert.ok(near(jamb.points[2], [tomb!.x, top]), "then along that line to the tomb's x");
    }
  }],
  ["the pyramid's outline and the two jambs make one closed loop: its hollow stays closed", () => {
    const key = (p: [number, number]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    const degree = new Map<string, number>();
    for (const w of wallsWithTomb(TABLE_IN_USE).filter((w) => w.kind === 'pyramid' || w.kind === 'tomb')) {
      for (let i = 0; i + 1 < w.points.length; i++) for (const p of [w.points[i], w.points[i + 1]]) degree.set(key(p), (degree.get(key(p)) ?? 0) + 1);
    }
    // Every corner of a closed loop is the end of exactly two of its segments.
    const loose = [...degree].filter(([, n]) => n !== 2).map(([k]) => k);
    assert.deepEqual(loose, [], `ends that join nothing: ${loose.join(' ')}`);
  }],
  ['wallsWithTomb leaves the other walls as they are, and a table without a tomb whole', () => {
    const t = TABLE_IN_USE;
    const other = (ws: typeof t.walls) => ws.filter((w) => w.kind !== 'pyramid' && w.kind !== 'tomb');
    assert.deepEqual(other(wallsWithTomb(t)), other(t.walls));
    assert.equal(wallsWithTomb(t)[0], t.walls[0], 'the outer wall is still first');
    assert.deepEqual(wallsWithTomb({ ...t, tomb: undefined }), t.walls);
  }],
  ['the Ankh and Eye plaques are at least 0.38 wide and stand clear of the doorway along their faces', () => {
    const t = TABLE_IN_USE;
    const front = t.walls.find((w) => w.kind === 'pyramid')!.points[0];
    const [left, right] = mouthEnds();
    const plaques = t.targets.filter((g) => /^target-(ankh|eye)-\d$/.test(g.id));
    assert.equal(plaques.length, 6);
    for (const g of plaques) {
      const a = (g.angle! * Math.PI) / 180;
      const along = (p: [number, number]) => (p[0] - front[0]) * Math.cos(a) + (p[1] - front[1]) * Math.sin(a);
      assert.ok(g.width >= 0.38, `${g.id} is ${g.width} wide`);
      // The Ankh bank runs up the lower-left face (angle 135), the Eye bank up the lower-right (45).
      const mouth = g.angle === 135 ? left : right;
      assert.ok(along([g.x, g.z]) - g.width / 2 >= along(mouth) - 1e-9, `${g.id} starts ${(along([g.x, g.z]) - g.width / 2).toFixed(3)} along its face, inside the doorway's ${along(mouth).toFixed(3)}`);
    }
  }],
  ['no two targets overlap, the rising ones included (up or down)', () => {
    // The Ra bank has no angle: it stands along the orbit's wall, which the physics finds by shape, far from the rest.
    const faced = TABLE_IN_USE.targets.filter((g) => g.angle !== undefined);
    for (let i = 0; i < faced.length; i++) {
      for (let j = i + 1; j < faced.length; j++) {
        const gap = faceGap(faceOf(faced[i]), faceOf(faced[j]));
        assert.ok(gap > 0, `${faced[i].id} and ${faced[j].id} overlap by ${(-gap).toFixed(3)}`);
      }
    }
  }],
  ["the four switches: one across each orbit lane, the left ramp's top into the dish, the gate's gap", () => {
    const t = TABLE_IN_USE;
    assert.deepEqual(t.switches.map((s) => [s.id, s.kind]), [['orbit-left', 'orbit'], ['orbit-right', 'orbit'], ['ramp-dish', 'ramp'], ['ramp-gate', 'ramp']]);
    const sw = (id: string) => t.switches.find((s) => s.id === id)!;
    const outer = t.walls[0].points, orbit = t.walls.find((w) => w.kind === 'orbit')!.points;
    // The shooter lane's inner wall is the one of its two that runs straight up the table (its floor runs across).
    const shooter = t.walls.find((w) => w.kind === 'shooter' && w.points[0][0] === w.points[1][0])!.points;
    // An orbit switch stands on the playfield square across its lane, from the wall on one side to the wall on the
    // other where it stands, so a ball going up or down the lane meets it wherever it is across the lane. The right
    // lane's stands below the top of the shooter lane's wall, which walls a launch off from it.
    for (const [id, sides] of [['orbit-left', [outer, orbit]], ['orbit-right', [orbit, shooter]]] as const) {
      const s = sw(id);
      assert.equal(s.y, undefined, `${id} stands on the playfield`);
      assert.equal(s.angle ?? 0, 0, `${id} is square across its lane`);
      const [a, b] = sides.map((w) => crossingNear(w, s.z, s.x)).sort((p, q) => p - q);
      assert.ok(Math.abs(s.x - s.width / 2 - a) < 0.01 && Math.abs(s.x + s.width / 2 - b) < 0.01, `${id} runs from x ${s.x - s.width / 2} to ${s.x + s.width / 2}, where its lane's walls are at ${a.toFixed(3)} and ${b.toFixed(3)}`);
    }
    assert.ok(sw('orbit-right').z < Math.max(shooter[0][1], shooter[1][1]), "the right lane's switch is below the top of the shooter lane's wall");
    // The dish's switch stands on the floor where the left ramp runs into the dish's south gap: square across the
    // ramp's last stretch, as wide as the ramp, on its line just past its last point, at the dish floor's height.
    const ramp = t.ramps.find((r) => r.id === 'ramp-left')!;
    const dish = t.dishes[0];
    const [lx, lz, ly] = ramp.path[ramp.path.length - 1], [px, pz] = ramp.path[ramp.path.length - 2];
    const heading = Math.atan2(lz - pz, lx - px);
    const d = sw('ramp-dish');
    const along = (d.x - lx) * Math.cos(heading) + (d.z - lz) * Math.sin(heading);
    const across = (d.z - lz) * Math.cos(heading) - (d.x - lx) * Math.sin(heading);
    assert.ok(Math.abs((d.angle ?? 0) - (deg(heading) - 90)) < 0.5, `ramp-dish runs at ${d.angle} degrees, and the ramp's top heads ${deg(heading).toFixed(2)}`);
    assert.equal(d.width, ramp.width, 'as wide as the ramp');
    assert.ok(d.y === ly && ly === dish.y, `ramp-dish stands at ${d.y}, the ramp's top and the dish's floor at ${ly} and ${dish.y}`);
    assert.ok(Math.abs(across) < 0.01 && along >= 0 && along < 0.5, `ramp-dish is ${along.toFixed(3)} past the ramp's last point and ${across.toFixed(3)} off its line`);
    const round = (deg(Math.atan2(d.z - dish.z, d.x - dish.x)) + 360) % 360;
    assert.ok(Math.hypot(d.x - dish.x, d.z - dish.z) < dish.r && dish.gaps.some(([a, b]) => round >= a && round <= b), `ramp-dish is inside the dish, in its south gap (at ${round.toFixed(1)} degrees round it)`);
    // The gate's switch stands beside the gap in the ramp's east rail, where the gate stands at rest in the rail's
    // place: along the gate's line and as long as it, out from it on the side away from the ramp, between it and the
    // lock, at the height of the ramp's floor in the gap, above a ball on the playfield.
    const gate = t.diverter!;
    const g = sw('ramp-gate');
    const [ux, uz] = [Math.cos(rad(gate.restDeg)), Math.sin(rad(gate.restDeg))];
    const mid: [number, number] = [gate.pivot[0] + (ux * gate.length) / 2, gate.pivot[1] + (uz * gate.length) / 2];
    const centre = ramp.path.reduce((best, p) => (Math.hypot(p[0] - mid[0], p[1] - mid[1]) < Math.hypot(best[0] - mid[0], best[1] - mid[1]) ? p : best));
    // The normal to the gate's line on the side away from the ramp's centre line.
    let [nx, nz] = [-uz, ux];
    if ((mid[0] - centre[0]) * nx + (mid[1] - centre[1]) * nz < 0) [nx, nz] = [-nx, -nz];
    const gAlong = (g.x - mid[0]) * ux + (g.z - mid[1]) * uz, out = (g.x - mid[0]) * nx + (g.z - mid[1]) * nz;
    const angleOff = Math.abs(((((g.angle ?? 0) - gate.restDeg) % 180) + 180) % 180);
    assert.ok(Math.min(angleOff, 180 - angleOff) < 0.5, `ramp-gate runs at ${g.angle} degrees, the gate at rest at ${gate.restDeg}`);
    assert.ok(Math.abs(g.width - gate.length) < 0.01 && Math.abs(gAlong) < 0.01, `ramp-gate is ${g.width} long and ${gAlong.toFixed(3)} along from the gate's middle`);
    const { lock } = t;
    assert.ok(out > 0 && Math.hypot(g.x - lock.x, g.z - lock.z) < Math.hypot(mid[0] - lock.x, mid[1] - lock.z), `ramp-gate is ${out.toFixed(3)} out from the gate's line, between it and the lock`);
    const [y0, y1] = [ramp.path[ramp.opening!.from][2], ramp.path[ramp.opening!.to][2]];
    assert.ok(g.y !== undefined && g.y >= y0 && g.y <= y1 && g.y > 2 * TABLE.ballRadius, `ramp-gate stands at ${g.y}, where the ramp's floor in the gap is ${y0} to ${y1}`);
  }],
  ['the rules and the snapshot header', () => {
    assert.deepEqual(RULES, {
      autoSaveAfter: 3, flipHold: 0.25, ballSaverStart: 5, saverHype: 15, doubleHype: 30,
      sandstormHype: 10, curseHype: 10, mummyHype: 20, summonPrize: 10000, maxExtraBalls: 2,
      pointsPerCoin: 530, ownerShare: 0.7, stuckSeconds: 4, launchDelay: 2,
      wind: { strength: 20, gustLow: 0.4, gustSeconds: 2.3, easeSeconds: 0.5 },
    });
    assert.equal(SNAP_TYPE_PINBALL, 4);
    // u8 + f64 + u16 + 3 f32 + u32 lit + u32 down + u32 turned + 2 f32 + u32 toys
    assert.equal(SNAP_PINBALL_HEADER, 1 + 8 + 2 + 12 + 4 + 4 + 4 + 8 + 4);
    const bits = Object.values(LIT);
    assert.equal(new Set(bits).size, bits.length);
    assert.ok(bits.every((b) => b > 0 && (b & (b - 1)) === 0), 'each lit insert is one bit');
  }],
  ["the table fits the snapshot header's room", () => {
    // The snapshot header (SNAP_PINBALL_HEADER, written by sim.ts's snapshot and read by the stage) has a fixed room: 3
    // flipper angles, 2 spinner angles (the table's spinner and one more) and 32 target bits (down, and turned). A table
    // with more would be cut off there without a word, so the header has to grow first.
    const t = TABLE_IN_USE;
    assert.ok(t.flippers.length <= 3, `${t.flippers.length} flippers, but the snapshot header carries 3 flipper angles`);
    assert.ok(t.spinners.length <= 1, `${t.spinners.length} extra spinners, but the snapshot header carries 2 spinner angles (the table's spinner and 1 more)`);
    assert.ok(t.targets.length <= 32, `${t.targets.length} targets, but the snapshot header carries 32 target bits (down, and turned)`);
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
