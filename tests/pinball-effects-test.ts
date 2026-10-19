// Tests the quest's particles. The sparks (stage/sparks.ts) come from a fixed pool of MAX_SPARKS that never grows and
// reuses the oldest spark when it is full; they fly up and out at 2.5 to 5 units a second, fall at 9 and are slowed by
// 1.5 a second, never go below the playfield, live 0.45 to 0.8 s and are parked out of sight after, fading as they go;
// a mote drifts up and never falls; a spark is 0.14 across wherever the stage draws it; and nothing moves while the
// table's clock stands still. The open tomb's beam fades in and out over 0.4 s with the tomb's bit and sends up motes
// while it is open. A payout's coin burst (stage/coin-burst.ts) grows with the payout, from a pool of 180. No page or
// graphics card is needed.
// Usage: npm run pinball-effects-test
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TABLE, TABLE_IN_USE, type Table } from '../src/shared/table';
// The stage's code loads in Node with its CSS and pictures stubbed (stub-assets.ts).
import './stub-assets';

const { CoinBurst } = await import('../src/stage/coin-burst');
const { MAX_SPARKS, Sparks, TombBeam } = await import('../src/stage/sparks');
const { doorway, pictureDepth } = await import('../src/stage/table-mesh');
type Sparks = InstanceType<typeof Sparks>;

// The same run every time: Math.random seeded with the claw's tests' generator (16807).
let seed = 1;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

/** The tomb's doorway on the table in use, where the beam stands. */
const way = doorway(TABLE_IN_USE)!;
/** The playfield's floor for a spark, as the buffers hold it (32-bit). */
const FLOOR = Math.fround(0.05);

/** Runs `fn` with Math.random always giving `value`: a spark takes the least (0) or most (nearly 1) of each range. */
function withRandom<T>(value: number, fn: () => T): T {
  const was = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = was;
  }
}

/** Spark i as the stage's renderer reads it: where it is, its colour, and how bright (0 once it is out). */
function slot(s: Sparks, i: number) {
  const pos = s.points.geometry.attributes.position.array;
  const col = s.points.geometry.attributes.color.array;
  return { x: pos[3 * i], y: pos[3 * i + 1], z: pos[3 * i + 2], r: col[4 * i], g: col[4 * i + 1], b: col[4 * i + 2], a: col[4 * i + 3] };
}

/** Steps `sparks` on by `seconds`, in steps of about `dt`. */
function run(sparks: Sparks, seconds: number, dt = 1 / 120): void {
  const n = Math.max(1, Math.ceil(seconds / dt - 1e-9));
  for (let k = 0; k < n; k++) sparks.update(seconds / n);
}

test('sparks come from a fixed pool: bursts of 1,000 never light more than MAX_SPARKS, and the buffers never grow', () => {
  assert.equal(MAX_SPARKS, 400);
  const sparks = new Sparks();
  const { position, color } = sparks.points.geometry.attributes;
  const made = { position: position.array, color: color.array, lengths: [position.array.length, color.array.length] };
  assert.equal(position.count, MAX_SPARKS, 'a point for each spark of the pool, made at the start');
  assert.equal(sparks.live(), 0, 'none alight to begin with');

  sparks.burst(0, 0.4, 5, 0xffd23f, 1000);
  assert.equal(sparks.live(), MAX_SPARKS, 'a burst of 1,000 lights the pool and no more');

  // The busiest table: bursts of 1,000 and motes on a pool that is already full, a step between each.
  for (let k = 0; k < 30; k++) {
    sparks.burst(k - 5, 0.4, 5, 0xff8a3a, 1000);
    sparks.mote(0, 0.1, 5, 0xffe8b0, 0.9);
    sparks.update(0.02);
    assert.ok(sparks.live() <= MAX_SPARKS, `${sparks.live()} alight after burst ${k}`);
  }
  assert.equal(sparks.live(), MAX_SPARKS, 'a pool kept full stays full');

  // Nothing was made: the attributes, their buffers and their sizes are the ones made at the start.
  assert.equal(sparks.points.geometry.attributes.position, position);
  assert.equal(sparks.points.geometry.attributes.color, color);
  assert.equal(position.array, made.position);
  assert.equal(color.array, made.color);
  assert.deepEqual([position.array.length, color.array.length], made.lengths);
  assert.equal(position.count, MAX_SPARKS);
  assert.equal(color.count, MAX_SPARKS);

  // clear() lets every spark go, and the pool is there for the next.
  sparks.clear();
  assert.equal(sparks.live(), 0);
  sparks.burst(0, 0.4, 5, 0xffd23f, 50);
  assert.equal(sparks.live(), 50);
});

test("a spark flies up and out, falls back no lower than the playfield, and is out by its life's end", () => {
  const at = { x: 1, y: 0.05, z: 5 };
  const count = 60;
  const sparks = new Sparks();
  sparks.burst(at.x, at.y, at.z, 0xffd23f, count);
  // They are in the colour they are thrown in, as the stage reads colours (0xRRGGBB in sRGB), in full light.
  const gold = new THREE.Color(0xffd23f);
  for (const i of [0, count - 1]) {
    const s = slot(sparks, i);
    assert.ok(near(s.r, gold.r, 1e-6) && near(s.g, gold.g, 1e-6) && near(s.b, gold.b, 1e-6), `spark ${i} is ${s.r}, ${s.g}, ${s.b}`);
    assert.equal(s.a, 1);
  }

  // Step it every 1/240 s up to 0.44 s: no spark lives less than 0.45 s, so every one is alight all that time.
  const top = new Array<number>(count).fill(at.y);
  const reach = new Array<number>(count).fill(0);
  let lowest = Infinity;
  let t = 0;
  while (t < 0.44) {
    sparks.update(1 / 240);
    t += 1 / 240;
    for (let i = 0; i < count; i++) {
      const s = slot(sparks, i);
      assert.ok(s.a > 0, `spark ${i} is out at ${t.toFixed(3)} s, before its life can end`);
      lowest = Math.min(lowest, s.y);
      top[i] = Math.max(top[i], s.y);
      // Out: it never comes back toward where it was thrown from.
      const out = Math.hypot(s.x - at.x, s.z - at.z);
      assert.ok(out >= reach[i] - 1e-6, `spark ${i} came back toward the middle at ${t.toFixed(3)} s`);
      reach[i] = out;
    }
  }
  assert.equal(sparks.live(), count);
  for (let i = 0; i < count; i++) {
    assert.ok(top[i] > at.y + 0.02, `spark ${i} flew up: its top was ${top[i]}`);
    assert.ok(reach[i] > 0.05, `spark ${i} flew out: ${reach[i]}`);
  }
  assert.ok(lowest >= FLOOR, `no spark goes below the playfield (y 0.05): the lowest was ${lowest}`);
  // Some have fallen back to the playfield by now (the slow ones), and none has gone through it.
  const fallen = Array.from({ length: count }, (_, i) => slot(sparks, i).y).filter((y) => y === FLOOR).length;
  assert.ok(fallen > 0, 'some sparks fell back to the playfield');

  // Out by the end of the longest life, 0.8 s, and parked out of sight: dark, and far under the playfield.
  run(sparks, 0.37, 1 / 240);
  assert.equal(sparks.live(), 0, 'every spark is out by 0.81 s');
  for (let i = 0; i < count; i++) {
    const s = slot(sparks, i);
    assert.equal(s.a, 0, `spark ${i} is dark once it is out`);
    assert.ok(s.y < -10, `spark ${i} is parked out of sight: y ${s.y}`);
  }

  // A spark lives 0.45 to 0.8 s: the least and the most of that range, from a random that gives 0 and nearly 1. It
  // fades out with its life, from full light at its start to nothing.
  for (const [random, life] of [[0, 0.45], [0.999999, 0.8]] as const) {
    const s = withRandom(random, () => {
      const p = new Sparks();
      p.burst(0, 1, 0, 0xffffff, 5);
      return p;
    });
    assert.equal(slot(s, 0).a, 1, 'full light as it is thrown');
    run(s, life / 2);
    assert.ok(near(slot(s, 0).a, 0.5, 1e-4), `half faded by half its ${life} s life: ${slot(s, 0).a}`);
    run(s, life / 2 - 0.01);
    assert.equal(s.live(), 5, `still alight at ${life - 0.01} s`);
    assert.ok(slot(s, 0).a > 0 && slot(s, 0).a < 0.05, 'nearly out');
    run(s, 0.02);
    assert.equal(s.live(), 0, `out by ${life + 0.01} s`);
  }

  // It is thrown at 2.5 to 5 units a second, up and out: how each of `n` sparks just thrown goes in its first
  // millisecond (in which gravity and the slowing take under 1% of its speed): how fast, and how fast up and across.
  const launches = (p: Sparks, n: number) => {
    const from = Array.from({ length: n }, (_, i) => slot(p, i));
    p.update(0.001);
    return from.map((a, i) => {
      const b = slot(p, i);
      const [dx, dy, dz] = [(b.x - a.x) / 0.001, (b.y - a.y) / 0.001, (b.z - a.z) / 0.001];
      return { speed: Math.hypot(dx, dy, dz), up: dy, out: Math.hypot(dx, dz) };
    });
  };
  const thrown = (random: number) =>
    launches(
      withRandom(random, () => {
        const p = new Sparks();
        p.burst(0, 5, 0, 0xffffff, 1);
        return p;
      }),
      1,
    )[0];
  assert.ok(near(thrown(0).speed, 2.5, 2.5 * 0.01), 'the slowest is thrown at 2.5');
  assert.ok(near(thrown(0.999999).speed, 5, 5 * 0.01), 'the fastest is thrown at 5');
  // Five bursts of a whole pool: every spark is between those speeds, well up (none thrown flat or down) and well out
  // (none straight up).
  const pool = new Sparks();
  for (let k = 0; k < 5; k++) {
    pool.clear();
    pool.burst(0, 5, 0, 0xffffff, MAX_SPARKS);
    for (const { speed, up, out } of launches(pool, MAX_SPARKS)) {
      assert.ok(speed > 2.5 * 0.99 && speed < 5 * 1.01, `thrown at ${speed}`);
      assert.ok(up > 0.5, `thrown up at only ${up}`);
      assert.ok(out > 0.2, `thrown out at only ${out}`);
    }
  }

  // And a burst from the playfield itself starts no lower than the floor: nothing is thrown out of the table.
  const low = new Sparks();
  low.burst(0, 0, 0, 0xffffff, 10);
  low.mote(0, 0, 0, 0xffffff, 0.9);
  for (let i = 0; i < 11; i++) assert.ok(slot(low, i).y >= FLOOR, `spark ${i} starts at ${slot(low, i).y}`);
});

test('a spark falls at 9 and is slowed by 1.5 a second: its flight is the curve those make', () => {
  // Thrown from high up so it never reaches the floor, and followed every millisecond for the shortest life, 0.45 s.
  const sparks = new Sparks();
  sparks.burst(0, 5, 0, 0xffd23f, 1);
  const p0 = slot(sparks, 0);
  sparks.update(0.001);
  const p1 = slot(sparks, 0);
  const v0 = { x: (p1.x - p0.x) / 0.001, y: (p1.y - p0.y) / 0.001, z: (p1.z - p0.z) / 0.001 };
  const G = 9;
  const C = 1.5;
  let t = 0.001;
  while (t < 0.44) {
    sparks.update(0.001);
    t += 0.001;
    const s = slot(sparks, 0);
    const slow = (1 - Math.exp(-C * t)) / C;
    const want = {
      x: p0.x + v0.x * slow,
      z: p0.z + v0.z * slow,
      // The vertical speed settles toward -G / C; gravity and the slowing work on it together.
      y: p0.y + (v0.y + G / C) * slow - (G / C) * t,
    };
    if (near(t, 0.2, 5e-4) || near(t, 0.44, 5e-4)) {
      assert.ok(near(s.x, want.x, 0.02) && near(s.z, want.z, 0.02), `across at ${t.toFixed(3)} s: ${s.x}, ${s.z} against ${want.x}, ${want.z}`);
      assert.ok(near(s.y, want.y, 0.02), `up at ${t.toFixed(3)} s: ${s.y} against ${want.y}`);
    }
  }
});

test("nothing moves while the table's clock stands still (update(0))", () => {
  // The sparks, motes among them, part way through their lives.
  const sparks = new Sparks();
  sparks.burst(0, 1, 5, 0xffd23f, 40);
  sparks.mote(0, 0.1, 5, 0xffe8b0, 0.9);
  run(sparks, 0.2);
  const still = () => [Array.from(sparks.points.geometry.attributes.position.array), Array.from(sparks.points.geometry.attributes.color.array), sparks.live()];
  const before = still();
  for (let k = 0; k < 10; k++) sparks.update(0);
  assert.deepEqual(still(), before, 'the sparks stand still');
  // A step that isn't forward in time (the clock going back) moves nothing either, nor sends them anywhere strange.
  sparks.update(-0.1);
  sparks.update(NaN);
  assert.deepEqual(still(), before, 'the sparks stand still for a step that is not forward');

  // The beam, part way through opening: its fade stops, and it sends up no motes.
  const beam = new TombBeam(TABLE_IN_USE, sparks);
  const shaft = beam.group.children[0] as THREE.Mesh;
  beam.set(false);
  beam.set(true);
  beam.update(0.1);
  const seen = () => ({ level: beam.level, opacity: (shaft.material as THREE.Material).opacity, visible: shaft.visible, motes: sparks.live() });
  const midway = seen();
  assert.ok(midway.level > 0 && midway.level < 1, `the beam is part way open: ${midway.level}`);
  for (let k = 0; k < 10; k++) beam.update(0);
  assert.deepEqual(seen(), midway, 'the beam stands still');

  // The coins, in the air.
  const coins = new CoinBurst();
  coins.burst(5, 0, 1);
  coins.update(0.3);
  const flying = () =>
    coins.group.children.map((c) => {
      const s = c as THREE.Sprite;
      return [s.position.x, s.position.y, s.position.z, s.visible, s.material.opacity, s.material.rotation];
    });
  const air = flying();
  assert.ok(air.some((c) => c[3]), 'coins are flying');
  for (let k = 0; k < 10; k++) coins.update(0);
  assert.deepEqual(flying(), air, 'the coins stand still');
});

test("the tomb's beam: dark while shut; opening fades it in over 0.4 s and sends up motes; shutting fades it out and they stop; open at the first look, it's lit at once", () => {
  const sparks = new Sparks();
  const beam = new TombBeam(TABLE_IN_USE, sparks);
  const shaft = beam.group.children[0] as THREE.Mesh;
  const light = shaft.material as THREE.MeshBasicMaterial;
  /** The table's clock moves on: the beam and the sparks its motes are, as the stage steps them. */
  const step = (seconds: number) => {
    beam.update(seconds);
    sparks.update(seconds);
  };

  // The shaft: as wide as the doorway and 2.2 tall, rising from the doorstep in front of the door's face; additive,
  // pale gold, at 0.55 opacity when it is all the way open.
  const box = new THREE.Box3().setFromObject(shaft);
  assert.ok(near(box.min.x, way.x0, 1e-6) && near(box.max.x, way.x1, 1e-6), `as wide as the doorway: ${box.min.x} to ${box.max.x}`);
  assert.ok(near(box.min.y, 0, 1e-6) && near(box.max.y, 2.2, 1e-6), `from the doorstep, 2.2 tall: ${box.min.y} to ${box.max.y}`);
  assert.ok(box.max.z <= way.front && box.max.z > way.front - 0.25, `at the doorway's face: ${box.max.z}, the door's face at ${way.front}`);
  // It stands clear of the picture's unseen shapes round the doorway (its lintel, pillars and the door's way up reach
  // a little in front of the door's face), which would hide it where it stood inside them. The playfield's own flat
  // planes (the floor and the shadow catcher) meet the shaft's foot, so those aside, no unseen shape meets it.
  for (const unseen of pictureDepth(TABLE_IN_USE, TABLE.width, TABLE.length).children) {
    const shape = new THREE.Box3().setFromObject(unseen);
    if (shape.max.y - shape.min.y < 0.01) continue;
    assert.ok(!shape.intersectsBox(box), `the shaft is inside an unseen shape: ${shape.min.toArray()} to ${shape.max.toArray()}`);
  }
  assert.equal(light.blending, THREE.AdditiveBlending);
  assert.equal(light.color.getHex(), 0xffe8b0);
  // Its light is brightest at its foot, fades toward its top and is soft at its sides, so it reads as light and not as
  // a lit panel (the first row of a texture is its foot).
  const map = light.map!.image as { data: Uint8Array; width: number; height: number };
  const alphaOf = (x: number, y: number) => map.data[(y * map.width + x) * 4 + 3];
  const middle = map.width / 2;
  assert.ok(alphaOf(middle, 0) > 240, 'bright at its foot');
  assert.ok(alphaOf(middle, 0) > alphaOf(middle, map.height / 2) && alphaOf(middle, map.height / 2) > alphaOf(middle, map.height - 1), 'fading up it');
  assert.ok(alphaOf(middle, map.height - 1) < 30, 'and nearly gone at its top');
  assert.ok(alphaOf(0, 0) < alphaOf(middle, 0) / 2, 'soft at its sides');

  // Shut at the first look it is dark, and stays so with no motes however long the table runs.
  beam.set(false);
  assert.equal(beam.level, 0);
  assert.equal(shaft.visible, false, 'dark while shut');
  for (let k = 0; k < 100; k++) step(0.01);
  assert.equal(beam.level, 0);
  assert.equal(shaft.visible, false);
  assert.equal(sparks.live(), 0, 'no motes while shut');

  // Opening: it fades in over 0.4 s, linearly, to 0.55 opacity...
  beam.set(true);
  for (const want of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
    step(0.05);
    assert.ok(near(beam.level, want), `level ${beam.level}, wanted ${want}`);
    assert.ok(near(light.opacity, 0.55 * want), `opacity ${light.opacity}, wanted ${0.55 * want}`);
    assert.equal(shaft.visible, true);
  }
  step(0.12);
  assert.equal(beam.level, 1, 'it stops at open');
  assert.ok(near(light.opacity, 0.55));

  // ...and sends up motes while it is open: 16 a second, from across the doorway, each rising 0.9 a second. (Counted
  // between whole motes, so that no check falls on the very moment of one.)
  assert.equal(sparks.live(), 8, '0.52 s in, 8 motes');
  for (let k = 0; k < 10; k++) step(0.05);
  assert.equal(sparks.live(), 16, 'and 1.02 s in, 16');
  const motes = Array.from({ length: sparks.live() }, (_, i) => slot(sparks, i));
  const pale = new THREE.Color(0xffe8b0);
  for (const m of motes) {
    assert.ok(near(m.r, pale.r, 1e-6) && near(m.g, pale.g, 1e-6) && near(m.b, pale.b, 1e-6), `a mote is ${m.r}, ${m.g}, ${m.b}`);
    assert.ok(m.x >= way.x0 - 1e-6 && m.x <= way.x1 + 1e-6, `a mote at x ${m.x}, outside the doorway ${way.x0} to ${way.x1}`);
    assert.ok(m.z <= way.front && m.z > way.front - 0.25, `a mote at z ${m.z}`);
    assert.ok(m.y >= FLOOR, `a mote at y ${m.y}`);
  }
  assert.ok(new Set(motes.map((m) => m.x)).size > 1, 'they come from across the doorway, not one spot');
  step(0.1);
  for (const [i, m] of motes.entries()) assert.ok(near(slot(sparks, i).y - m.y, 0.09, 1e-5), `mote ${i} rose ${slot(sparks, i).y - m.y} in 0.1 s`);

  // Shutting: it fades out over 0.4 s, and the motes stop (those in the air live on).
  const inAir = sparks.live();
  beam.set(false);
  for (const want of [0.75, 0.5, 0.25, 0]) {
    step(0.1);
    assert.ok(near(beam.level, want), `level ${beam.level}, wanted ${want}`);
    assert.ok(near(light.opacity, 0.55 * want), `opacity ${light.opacity}, wanted ${0.55 * want}`);
    assert.equal(shaft.visible, want > 0);
    assert.equal(sparks.live(), inAir, 'no new motes once the tomb shuts');
  }
  run(sparks, 1.7);
  assert.equal(sparks.live(), 0, 'the motes in the air are out within 1.6 s');

  // Open at the first look, it is lit at once: no fade in, though its motes begin only as the table runs.
  const first = new TombBeam(TABLE_IN_USE, sparks);
  const firstShaft = first.group.children[0] as THREE.Mesh;
  first.set(true);
  assert.equal(first.level, 1);
  assert.equal(firstShaft.visible, true);
  assert.ok(near((firstShaft.material as THREE.Material).opacity, 0.55));
  assert.equal(sparks.live(), 0);
  first.update(0.1);
  assert.equal(sparks.live(), 1, 'and it sends up motes as the table runs');

  // A table with no tomb has no beam: nothing to draw, and nothing it sends up.
  const bare: Table = { ...TABLE_IN_USE, tomb: undefined };
  const none = new TombBeam(bare, sparks);
  assert.equal(none.group.children.length, 0, 'an empty group');
  none.set(true);
  none.update(1);
  assert.equal(none.level, 0);
  assert.equal(sparks.live(), 1, 'it sent up no motes');
});

test("a payout's coin burst grows with the payout: 8 coins for 0, 17 for 9, 60 at most, from a pool of 180", () => {
  /** How many coins a burst of `coins` throws: those in the air once every one has begun (up to 0.12 s apart). */
  const thrown = (coins: number) => {
    const b = new CoinBurst();
    b.burst(coins, 0, 1);
    b.update(0.13);
    return b.group.children.filter((c) => c.visible).length;
  };
  assert.equal(new CoinBurst().group.children.length, 180, 'a pool of 180, made at the start');
  assert.equal(thrown(0), 8);
  assert.equal(thrown(9), 17);
  assert.equal(thrown(1), 9);
  assert.equal(thrown(40), 48);
  assert.equal(thrown(52), 60);
  assert.equal(thrown(53), 60, '60 at most');
  assert.equal(thrown(1000), 60);

  // Bursts on bursts never use more than the pool, and make nothing new.
  const b = new CoinBurst();
  for (let k = 0; k < 10; k++) b.burst(1000, k, 1);
  b.update(0.13);
  assert.equal(b.group.children.length, 180);
  assert.equal(b.group.children.filter((c) => c.visible).length, 180, 'the pool is all in the air, and no more');
  b.update(1.5);
  assert.equal(b.group.children.filter((c) => c.visible).length, 0, 'and every coin lands and goes out');
});

test('a mote drifts up at the rise it is given, never falls, and is out in 1.6 s', () => {
  const sparks = new Sparks();
  sparks.mote(1, 0.2, 5, 0xffe8b0, 0.9);
  assert.equal(sparks.live(), 1);
  let last = slot(sparks, 0);
  assert.equal(last.a, 1);
  for (let k = 0; k < 30; k++) {
    sparks.update(0.05);
    const now = slot(sparks, 0);
    assert.ok(near(now.y - last.y, 0.045, 1e-5), `rose ${now.y - last.y} in 0.05 s`);
    assert.ok(near(now.x, 1, 1e-6) && near(now.z, 5, 1e-6), 'it drifts straight up');
    assert.ok(now.a < last.a, 'and fades as it goes');
    last = now;
  }
  assert.equal(sparks.live(), 1, 'still alight at 1.5 s');
  sparks.update(0.15);
  assert.equal(sparks.live(), 0, 'out by 1.65 s');

  // A negative rise is no rise: a mote never falls.
  const sinking = new Sparks();
  sinking.mote(1, 5, 5, 0xffe8b0, -1);
  run(sinking, 0.5);
  assert.ok(slot(sinking, 0).y >= 5 - 1e-6, `a mote given a rise of -1 fell to ${slot(sinking, 0).y}`);

  // A mote that takes the place of a spark that was flying sideways drifts straight up all the same; and a spark that
  // takes a mote's place falls as a spark does.
  const reused = new Sparks();
  withRandom(0.5, () => reused.burst(1, 5, 5, 0xffd23f, 1));
  run(reused, 0.7);
  assert.equal(reused.live(), 0, 'the spark is out');
  reused.mote(1, 5, 5, 0xffe8b0, 0.9);
  run(reused, 0.5);
  const drifted = slot(reused, 0);
  assert.ok(near(drifted.x, 1, 1e-6) && near(drifted.z, 5, 1e-6) && near(drifted.y, 5.45, 1e-4), `the mote is at ${drifted.x}, ${drifted.y}, ${drifted.z}`);
  run(reused, 1.2);
  assert.equal(reused.live(), 0, 'the mote is out');
  withRandom(0, () => reused.burst(1, 5, 5, 0xffd23f, 1));
  run(reused, 0.44);
  assert.ok(slot(reused, 0).y < 4.8, `a spark in a mote's old place falls: it is at ${slot(reused, 0).y}`);
});

test('when all 400 are alight, a new spark takes the oldest one, and a dead place is taken before an old spark', () => {
  const sparks = new Sparks();
  const pos = sparks.points.geometry.attributes.position.array as Float32Array;
  // An old half, then a young one 0.1 s later: the pool is full.
  sparks.burst(-1, 1, 3, 0xffd23f, 200);
  run(sparks, 0.1);
  sparks.burst(1, 1, 3, 0xffd23f, 200);
  assert.equal(sparks.live(), MAX_SPARKS);
  const young = Array.from(pos.slice(3 * 200, 3 * 400));
  // 200 more go to the 200 oldest, and the young half is left as it was.
  sparks.burst(7, 1, 3, 0xff8a3a, 200);
  assert.equal(sparks.live(), MAX_SPARKS);
  for (let i = 0; i < 200; i++) assert.equal(slot(sparks, i).x, 7, `place ${i} is the newest burst's`);
  assert.deepEqual(Array.from(pos.slice(3 * 200, 3 * 400)), young, 'the younger half is not touched');

  // With one place free (the shortest life, long out) and the rest alight, the next spark takes the free place, so
  // none alight is cut short.
  const mixed = new Sparks();
  withRandom(0, () => mixed.burst(0, 1, 0, 0xffffff, 1));
  withRandom(0.999999, () => mixed.burst(0, 1, 0, 0xffffff, MAX_SPARKS - 1));
  run(mixed, 0.5);
  assert.equal(mixed.live(), MAX_SPARKS - 1, 'one spark is out, the rest alight');
  mixed.burst(7, 1, 3, 0xffffff, 1);
  assert.equal(mixed.live(), MAX_SPARKS, 'the free place was taken');
  assert.equal(slot(mixed, 0).x, 7);
});

test('the buffers are sent again whenever a spark is thrown, moves or goes out, and not while none is alight', () => {
  const sparks = new Sparks();
  const position = sparks.points.geometry.attributes.position as THREE.BufferAttribute;
  const color = sparks.points.geometry.attributes.color as THREE.BufferAttribute;
  let seen = [position.version, color.version];
  /** Whether both buffers were marked for sending since this was last asked. */
  const sent = () => {
    const now = [position.version, color.version];
    const did = now[0] > seen[0] && now[1] > seen[1];
    seen = now;
    return did;
  };
  sparks.update(0.1);
  assert.equal(sent(), false, 'with none alight, nothing is sent');
  sparks.burst(0, 1, 0, 0xffffff, 3);
  assert.equal(sent(), true, 'a burst is sent');
  sparks.mote(0, 1, 0, 0xffffff, 0.9);
  assert.equal(sent(), true, 'a mote is sent');
  sparks.burst(0, 1, 0, 0xffffff, 0);
  assert.equal(sent(), false, 'a burst of none is not');
  for (let k = 0; k < 30; k++) {
    const alight = sparks.live();
    sparks.update(0.1);
    if (alight > 0) assert.equal(sent(), true, `update ${k}, with ${alight} alight (the one in which the last goes out too)`);
  }
  assert.equal(sparks.live(), 0);
  sparks.update(0.1);
  assert.equal(sent(), false, 'with none alight again, nothing is sent');
  sparks.burst(0, 1, 0, 0xffffff, 3);
  sent();
  sparks.clear();
  assert.equal(sent(), true, 'letting them go is sent');
});

test('a spark is additive, with a map made in code, and 0.14 across wherever the stage draws it', () => {
  const sparks = new Sparks();
  const material = sparks.points.material as THREE.PointsMaterial;
  assert.equal(material.blending, THREE.AdditiveBlending);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(material.vertexColors, true);
  assert.ok(material.map instanceof THREE.DataTexture, 'the map is made in code');
  // Its dot is bright at the middle and gone at the edge (each pixel is four bytes, its alpha the fourth).
  const dot = material.map.image as { data: Uint8Array; width: number; height: number };
  const alphaOf = (img: typeof dot, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
  assert.equal(alphaOf(dot, dot.width / 2, dot.height / 2), 255, 'bright at its middle');
  assert.equal(alphaOf(dot, 0, 0), 0, 'gone at its corner');
  assert.ok(alphaOf(dot, dot.width / 2, 2) < 128, 'and fading toward its edge');
  assert.equal(sparks.points.frustumCulled, false, 'the sparks fly anywhere: the bounding sphere of the pool at the start is no guide');

  // three sizes a point in pixels from the renderer's own size (not the target it draws into) and the screen's height
  // alone (not the camera's lens), so a size of 0.14 is neither 0.14 across nor the same at every quality. The stage
  // draws into a target 3 times its size (supersampling) with a 32° lens. The size is set before each draw, from the
  // target and the lens, so that a spark is 0.14 across in the world wherever it is drawn.
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 200);
  const depth = 30;
  const world = (y: number) => new THREE.Vector3(0, y, -depth).project(camera);
  for (const { ratio, target } of [
    { ratio: 1, target: 1080 },
    { ratio: 1, target: 2160 },
    { ratio: 1, target: 3240 },
    { ratio: 2, target: null },
  ]) {
    const rendererHeight = 1080 / ratio;
    const fake = {
      getSize: (v: THREE.Vector2) => v.set(1920 / ratio, rendererHeight),
      getPixelRatio: () => ratio,
      getRenderTarget: () => (target === null ? null : { height: target }),
    } as unknown as THREE.WebGLRenderer;
    sparks.points.onBeforeRender(fake, new THREE.Scene(), camera, sparks.points.geometry, material, new THREE.Group());
    // What three then draws, in pixels of the target: size × pixel ratio × (renderer height ÷ 2) ÷ depth.
    const drawn = (material.size * ratio * rendererHeight) / 2 / depth;
    // What 0.14 across takes at that depth in a target of that height.
    const tall = target ?? 1080;
    const across = ((world(0.07).y - world(-0.07).y) / 2) * tall;
    assert.ok(near(drawn, across, across * 1e-6), `${drawn} pixels across, wanted ${across} (pixel ratio ${ratio}, target ${target})`);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').join('\n      ')}`);
  }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
