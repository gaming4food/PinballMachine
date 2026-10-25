// Tests the quest's particles. The sparks (stage/sparks.ts) come from a fixed pool of MAX_SPARKS that never grows and
// reuses the oldest spark when it is full; they fly up and out at 2.5 to 5 units a second, fall at 9 and are slowed by
// 1.5 a second, never go below the playfield, live 0.45 to 0.8 s and are parked out of sight after, fading as they go;
// a mote drifts up and never falls; a spark is 0.14 across wherever the stage draws it; and nothing moves while the
// table's clock stands still. The open tomb's beam fades in and out over 0.4 s with the tomb's bit and sends up motes
// while it is open, and after a fresh hello (reset) shows the tomb as it is at once. A payout's coin burst
// (stage/coin-burst.ts) grows with the payout, from a pool of 180. The screen flash (stage/screen-hits.ts) adds at
// most FLASH_CAP of its colour to the table's picture, peaks at its time and dies away by a factor of e every 1/7 s;
// of two at once the brighter shows. A flash asked for less than FLASH_GAP after the last one began is dropped, and so
// is one that would first show less than FLASH_GAP after the last first showed, so the picture never brightens sooner
// than that, at any frame rate, nor rises more than 3 times a second. Its amount still goes through a RiseLimit, which
// has nothing left to hold, and given the browser's clock through one more that counts real seconds, so that a table
// clock running fast still rises the picture at most 3 times in a real second; a hello never resets that one. The
// sandstorm's sand (stage/sand.ts) blows across from the windward edge from a pool of its own (240), and none enters
// with no wind; its haze (hazeAt) eases in and out over 0.8 s to at most 0.18, and the stage draws it through
// easeHaze, which never lets it change faster than that. A ball's trail (stage/ball-trail.ts) shows from 18 units a
// second and is full at 36, in its owner's colour (kept to its last frame) or gold, never for a held ball nor across a
// jump or a clock gone back; its glow lies under it. The trail and the glow go through RiseLimits on the real clock, so
// neither rises from dark to lit more than 3 times in a real second: not for a ball rattling between bumpers, a page
// dropping frames, nor anything that starts a trail again. No page or graphics card is needed.
// Usage: npm run pinball-effects-test
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TABLE, TABLE_IN_USE, type Table } from '../src/shared/table';
// The flash is numbers only, so it loads with no stubs.
import { DARK_BELOW, FLASH_GAP, LIT_ABOVE } from '../src/stage/light-show';
import { FLASH_CAP, ScreenFlash } from '../src/stage/screen-hits';
// The stage's code loads in Node with its CSS and pictures stubbed (stub-assets.ts).
import './stub-assets';

const { CoinBurst } = await import('../src/stage/coin-burst');
const { MAX_SPARKS, Sparks, TombBeam } = await import('../src/stage/sparks');
const { doorway, pictureDepth } = await import('../src/stage/table-mesh');
const { easeHaze, HAZE, hazeAt, HazeTracker, MAX_GRAINS, Sand } = await import('../src/stage/sand');
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

test("after reset() (a fresh hello) the beam stays as it is until the next set(), which shows the tomb as it is at once; then it fades again", () => {
  const sparks = new Sparks();
  const beam = new TombBeam(TABLE_IN_USE, sparks);
  const shaft = beam.group.children[0] as THREE.Mesh;
  const light = shaft.material as THREE.MeshBasicMaterial;

  // Open and all the way lit.
  beam.set(false);
  beam.set(true);
  for (let k = 0; k < 10; k++) beam.update(0.05);
  assert.equal(beam.level, 1);

  // A fresh hello: until the new connection's first header the beam stays lit, as the tomb's door stays up.
  beam.reset();
  assert.equal(beam.level, 1);
  assert.equal(shaft.visible, true);
  // That header has the tomb shut: the beam is dark at once, with no fade out.
  beam.set(false);
  assert.equal(beam.level, 0);
  assert.equal(shaft.visible, false);
  assert.equal(light.opacity, 0);
  // After that first set it fades with the bit again, as the table runs.
  beam.set(true);
  beam.update(0.1);
  assert.ok(near(beam.level, 0.25), `level ${beam.level}, wanted 0.25`);

  // The other way round: shut and dark, and a fresh hello on the tomb open lights it at once, with no fade in.
  beam.set(false);
  for (let k = 0; k < 10; k++) beam.update(0.05);
  assert.equal(beam.level, 0);
  beam.reset();
  assert.equal(shaft.visible, false, 'dark until the next set');
  beam.set(true);
  assert.equal(beam.level, 1);
  assert.equal(shaft.visible, true);
  assert.ok(near(light.opacity, 0.55));
  beam.set(false);
  beam.update(0.1);
  assert.ok(near(beam.level, 0.75), `and it fades out again after: level ${beam.level}, wanted 0.75`);

  // A table with no tomb has no beam, reset or not.
  const none = new TombBeam({ ...TABLE_IN_USE, tomb: undefined }, sparks);
  none.reset();
  none.set(true);
  assert.equal(none.level, 0);
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

test('a coin rain drops its coins over the table from above, from the pool, never more than 180 at once', () => {
  const inAir = (b: InstanceType<typeof CoinBurst>) => b.group.children.filter((c) => c.visible);
  const rained = (coins: number) => {
    const b = new CoinBurst();
    b.rain(coins);
    b.update(0.9);
    return b;
  };
  // Each coin asked for falls, none more than asked for, and none past the pool.
  assert.equal(inAir(rained(0)).length, 0, 'none asked, none fall');
  assert.equal(inAir(rained(100)).length, 100);
  assert.equal(inAir(rained(1000)).length, 180, 'the pool is the most');
  assert.equal(rained(1000).group.children.length, 180, 'and no coin is made');

  // They start high above the table, spread across its width and down its length, and come down to the playfield.
  const start = new CoinBurst();
  start.rain(150);
  start.update(0.01);
  const high = inAir(start);
  assert.ok(high.length > 0, 'some have begun at once');
  for (const c of high) assert.ok(c.position.y > 3, `begins high above the table (${c.position.y})`);
  const b = new CoinBurst();
  b.rain(150);
  b.update(0.5);
  const xs = inAir(b).map((c) => c.position.x);
  assert.ok(Math.min(...xs) < -3 && Math.max(...xs) > 3, 'across the width');
  for (const c of inAir(b)) {
    assert.ok(Math.abs(c.position.x) <= 5.1, `over the table's width (${c.position.x})`);
    assert.ok(c.position.z > 0 && c.position.z < 16.7, `over its length (${c.position.z})`);
  }
  b.update(0.7);
  for (const c of inAir(b)) assert.ok(c.position.y < 1.2 && c.position.y >= 0.2, `fallen to the playfield (${c.position.y})`);
  b.update(1.5);
  assert.equal(inAir(b).length, 0, 'and every coin is out');

  // Rain on rain, or on a payout's burst, never uses more than the pool either.
  const mixed = new CoinBurst();
  mixed.burst(1000, 0, 1);
  mixed.rain(180);
  mixed.rain(180);
  mixed.update(0.9);
  assert.equal(mixed.group.children.length, 180);
  assert.equal(inAir(mixed).length, 180, 'the pool is all in the air, and no more');
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

/** The flash is looked at every 1/240 s, finer than any frame the stage draws, so no brightening is missed. */
const LOOK = 1 / 240;
const GOLD = 0xffc23a;
const WHITE = 0xffffff;
const RED = 0xff3344;
const BLUE = 0x4a7dff;

/** The times of `n` looks, LOOK apart from 0. */
const lookTimes = (n: number): number[] => Array.from({ length: n }, (_, i) => i * LOOK);

/**
 * What the flash shows at `t` (with `real`, the browser's clock, if given), kept: at() returns the flash's own object,
 * which its next call fills in again.
 */
function look(flash: ScreenFlash, t: number, real?: number): { color: number; amount: number } {
  return { ...flash.at(t, real) };
}

/** The looks (their places in the list) at which a light is brighter than at the look before; the first has none. */
function brightenings(amounts: number[]): number[] {
  const at: number[] = [];
  let before = 0;
  amounts.forEach((amount, i) => {
    if (amount > before) at.push(i);
    before = amount;
  });
  return at;
}

/** The most of `times` (seconds, in order) that fall within any 1 s, as light-show-test counts a light's rises. */
function mostInASecond(times: number[]): number {
  let most = 0;
  for (let a = 0, b = 0; b < times.length; b++) {
    while (times[b] - times[a] >= 1) a++;
    most = Math.max(most, b - a + 1);
  }
  return most;
}

/**
 * When a light rises, from its levels (0 to 1 of its peak) looked at `times`: going above LIT_ABOVE after being below
 * DARK_BELOW, which is how a viewer sees a flash, and what RiseLimit holds to 3 a second. A light starts out dark.
 */
function riseTimes(levels: number[], times: number[]): number[] {
  const at: number[] = [];
  let dark = true;
  levels.forEach((level, i) => {
    if (level < DARK_BELOW) dark = true;
    else if (dark && level > LIT_ABOVE) {
      dark = false;
      at.push(times[i]);
    }
  });
  return at;
}

/** A flash as it is asked for. */
interface Ask {
  color: number;
  strength: number;
  at: number;
}

/**
 * What these flashes would show if every one asked for were let through and nothing held them back: each dies away by a
 * factor of e every 1/7 s from its start, and the brightest is the one seen. `looks` looks, LOOK apart, from 0.
 */
function unheld(asks: Ask[], looks: number): number[] {
  return Array.from({ length: looks }, (_, i) => {
    let most = 0;
    for (const ask of asks) {
      if (ask.at <= i * LOOK) most = Math.max(most, ask.strength * Math.exp(-7 * (i * LOOK - ask.at)));
    }
    return most * FLASH_CAP;
  });
}

/**
 * When the amount brightens by `least` or more, from its looks at `times`: the look at which each rise begins, where it
 * first goes up. A rise goes on while the amount does not fall, so one that comes in steps (a flash held, then let up)
 * is one brightening, counted once it has come to `least`.
 */
function brighteningStarts(times: number[], amounts: number[], least: number): number[] {
  const starts: number[] = [];
  let before = 0;
  let rise: { start: number; from: number; counted: boolean } | null = null;
  for (let i = 0; i < amounts.length; i++) {
    if (amounts[i] > before) {
      if (rise === null) rise = { start: times[i], from: before, counted: false };
      if (!rise.counted && amounts[i] - rise.from >= least) {
        rise.counted = true;
        starts.push(rise.start);
      }
    } else if (amounts[i] < before) {
      rise = null;
    }
    before = amounts[i];
  }
  return starts;
}

/**
 * The flash as the stage plays it for `seconds`: `rate` flashes a second, each asked for at a random time in its own
 * 1 / rate s and in a random strength from 0.2 to 1, and played at the first frame past its time, as the show book
 * plays a moment; looked at once a frame, `fps` a second (with frames of 0.5 to 1.5 of the usual length if `uneven`).
 * The same run for the same seed. It returns the looks' times and what each showed.
 */
function played(
  fps: number,
  rate: number,
  seconds: number,
  seed: number,
  uneven = false,
): { times: number[]; amounts: number[]; asked: number } {
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const asks: Ask[] = [];
  for (let k = 0; k < rate * seconds; k++) asks.push({ color: WHITE, strength: 0.2 + 0.8 * random(), at: (k + random()) / rate });
  const flash = new ScreenFlash();
  const times: number[] = [];
  const amounts: number[] = [];
  let next = 0;
  let t = 0;
  for (let frame = 1; t < seconds; frame++) {
    t = uneven ? t + (0.5 + random()) / fps : frame / fps;
    while (next < asks.length && asks[next].at <= t) {
      flash.flash(asks[next].color, asks[next].strength, asks[next].at);
      next++;
    }
    times.push(t);
    amounts.push(flash.at(t).amount);
  }
  return { times, amounts, asked: next };
}

test('a flash adds at most FLASH_CAP of its colour, at its peak, and is under 1% of the cap 0.7 s on', () => {
  assert.equal(FLASH_CAP, 0.3);
  const flash = new ScreenFlash();
  assert.equal(look(flash, 0).amount, 0, 'nothing is lit before a flash is asked for');

  // Asked for at 2 s at full strength: nothing before its time, then the whole cap in its colour at its peak...
  flash.flash(GOLD, 1, 2);
  assert.equal(look(flash, 1.999).amount, 0, 'nothing before its time');
  const peak = look(flash, 2);
  assert.equal(peak.color, GOLD);
  assert.equal(peak.amount, FLASH_CAP, 'the cap, and no more');
  // ...dying away by a factor of e every 1/7 s, in the same colour...
  for (let k = 1; k <= 4; k++) {
    const now = look(flash, 2 + k / 7);
    assert.equal(now.color, GOLD);
    assert.ok(near(now.amount, FLASH_CAP * Math.exp(-k), 1e-12), `${k}/7 s on it is ${now.amount}`);
  }
  // ...under 1% of the cap 0.7 s on, though not quite nothing yet...
  const tail = look(flash, 2.7);
  assert.ok(tail.amount > 0 && tail.amount < 0.01 * FLASH_CAP, `0.7 s on it is ${tail.amount}`);
  // ...and let go for good within 1.1 s: past that nothing is drawn for it.
  assert.equal(look(flash, 3.1).amount, 0);
  assert.equal(look(flash, 50).amount, 0);

  // A flash's strength is its share of the cap: at its peak it adds that much. One asked for above 1 adds the cap.
  for (const [strength, want] of [[0.5, 0.15], [0.25, 0.075], [0.8, 0.24], [1.5, FLASH_CAP], [1e9, FLASH_CAP]]) {
    const one = new ScreenFlash();
    one.flash(RED, strength, 0);
    const shown = look(one, 0);
    assert.ok(near(shown.amount, want, 1e-12), `strength ${strength} adds ${shown.amount}, wanted ${want}`);
    assert.equal(shown.color, RED);
  }

  // Whatever the strength and the time, the amount is between nothing and the cap.
  for (const strength of [0.01, 0.3, 0.5, 0.9, 1, 2, 50]) {
    const one = new ScreenFlash();
    one.flash(WHITE, strength, 1);
    for (let i = 0; i < 3 / LOOK; i++) {
      const { amount } = one.at(0.5 + i * LOOK);
      assert.ok(amount >= 0 && amount <= FLASH_CAP, `strength ${strength}: ${amount}`);
    }
  }
});

test('flashes asked 10 times a second rise at most 3 times in any second', () => {
  const looks = Math.round(5 / LOOK);
  // Asked every tenth of a second, in three colours in turn, at three kinds of strength: full; weak (a flash that is
  // never above LIT_ABOVE, which RiseLimit's own rule never counts as a rise, and that the picture still shows); and a
  // mix of half and full and between (the flash re-brightening from half to full).
  const kinds: [string, (k: number) => number][] = [
    ['full', () => 1],
    ['weak', () => 0.4],
    ['mixed', (k) => [0.5, 1, 0.8, 0.6, 1, 0.4, 0.9][k % 7]],
  ];
  for (const [kind, strengthOf] of kinds) {
    const flash = new ScreenFlash();
    const asks: Ask[] = [];
    const amounts: number[] = [];
    for (let i = 0; i < looks; i++) {
      if (i % 24 === 0) {
        const k = i / 24;
        asks.push({ color: [GOLD, WHITE, RED][k % 3], strength: strengthOf(k), at: i * LOOK });
        const ask = asks[k];
        flash.flash(ask.color, ask.strength, ask.at);
      }
      amounts.push(flash.at(i * LOOK).amount);
    }
    assert.equal(asks.length, 50, `${kind}: asked 10 times a second for 5 s`);

    // The flashes the rule lets through: each at least FLASH_GAP after the start of the last one let through.
    const accepted: Ask[] = [];
    for (const ask of asks) {
      if (accepted.length === 0 || ask.at - accepted[accepted.length - 1].at >= FLASH_GAP) accepted.push(ask);
    }
    assert.ok(accepted.length >= 12 && accepted.length <= 15, `${kind}: ${accepted.length} let through in 5 s`);

    // The picture is those flashes and no others: each at its peak at its start, dying away, the brightest seen. (A
    // flash is let go once it is a thousandth of the cap or less, which is why this is not to the last digit.)
    const want = unheld(accepted, looks);
    for (let i = 0; i < looks; i++) {
      assert.ok(near(amounts[i], want[i], 0.002 * FLASH_CAP), `${kind}: ${amounts[i]} at ${i * LOOK} s, wanted ${want[i]}`);
      assert.ok(amounts[i] <= FLASH_CAP);
    }

    // The amount rises only where one of those flashes begins, and nowhere between. They are FLASH_GAP or more apart.
    const starts = brightenings(amounts);
    assert.deepEqual(
      starts,
      accepted.map((ask) => Math.round(ask.at / LOOK)),
      `${kind}: the picture brightens where an accepted flash begins and nowhere else`,
    );
    for (let k = 1; k < starts.length; k++) {
      const apart = (starts[k] - starts[k - 1]) * LOOK;
      assert.ok(apart >= FLASH_GAP, `${kind}: flash ${k} begins ${apart} s after the last`);
    }
    const startTimes = starts.map((i) => i * LOOK);
    assert.ok(mostInASecond(startTimes) <= 3, `${kind}: brightens ${mostInASecond(startTimes)} times in a second`);

    // And by the rule RiseLimit keeps, going lit after being dark: at most 3 a second as well.
    const rises = riseTimes(amounts.map((amount) => amount / FLASH_CAP), lookTimes(looks));
    assert.ok(mostInASecond(rises) <= 3, `${kind}: ${mostInASecond(rises)} rises in a second`);
  }

  // The asks are a real test: let through, they would brighten the picture at every one, 10 times a second, and with
  // full flashes the dark-to-lit rule would count none of those as a rise (the flash only dips to about half between
  // two asks), which is why a flash is held by FLASH_GAP as well.
  const full: Ask[] = Array.from({ length: 50 }, (_, k) => ({ color: GOLD, strength: 1, at: k * 24 * LOOK }));
  const loose = unheld(full, looks);
  assert.equal(brightenings(loose).length, 50, 'every ask brightens the picture');
  assert.ok(mostInASecond(brightenings(loose).map((i) => i * LOOK)) >= 10, 'at least 10 a second');
  const looseRises = riseTimes(loose.map((amount) => amount / FLASH_CAP), lookTimes(looks));
  assert.equal(looseRises.length, 1, 'but only the first is a rise');
});

test('the picture never brightens sooner than FLASH_GAP after the last time it brightened, at any frame rate: 30 flashes a second, looked at 30 and 10 times a second', () => {
  // The show book plays a moment at the first frame past its time, so a flash is first drawn up to a frame after it
  // began, and two that began FLASH_GAP apart can first show less than that apart: 10 frames at 30 fps are 0.333 s, and
  // 3 frames at 10 fps are 0.3 s. So the gap counts from when a flash first shows. A brightening is a rise of the
  // amount by 10% of FLASH_CAP or more, and it starts at the look where the amount first goes up.
  for (const fps of [30, 10]) {
    const { times, amounts, asked } = played(fps, 30, 60, 20261020);
    assert.ok(asked >= 1790, `${asked} flashes asked in 60 s`);
    const starts = brighteningStarts(times, amounts, 0.1 * FLASH_CAP);
    assert.ok(starts.length >= 60, `${starts.length} brightenings in 60 s at ${fps} fps: it still flashes`);
    for (let k = 1; k < starts.length; k++) {
      const apart = starts[k] - starts[k - 1];
      assert.ok(apart >= FLASH_GAP, `${fps} fps: a brightening began ${apart} s after the last, at ${starts[k]} s`);
    }
    assert.ok(mostInASecond(starts) <= 3, `${fps} fps: ${mostInASecond(starts)} brightenings in a second`);
    for (const amount of amounts) assert.ok(amount >= 0 && amount <= FLASH_CAP, `${amount} at ${fps} fps`);
  }
});

test('with frames of any length and flashes asked a little after their time, the picture still rises at most 3 times in any second', () => {
  // The stage draws frames of 1/10 to 1/144 s, none of them even, and plays a moment at the first frame past its time.
  // So a flash is first drawn some time after it began, which the 1/240 s looks above never show. Flashes asked at
  // three rates and in strengths from 0.2 to 1, up to 3 frames late, over 20 s of the table's time each, with the same
  // run every time. In all of them the picture rises (dark to lit) at most 3 times in any second, and every
  // brightening of 10% of FLASH_CAP or more begins at least FLASH_GAP after the last.
  let seed = 20261019;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  let most = 0;
  let mostBrightening = 0;
  let asked = 0;
  for (const fps of [10, 20, 30, 60, 144]) {
    for (const rate of [3, 10, 30]) {
      for (let run = 0; run < 5; run++) {
        const flash = new ScreenFlash();
        const amounts: number[] = [];
        const times: number[] = [];
        for (let t = 0; t < 20; ) {
          t += (0.5 + random()) / fps;
          if (random() < rate / fps) {
            flash.flash(WHITE, 0.2 + 0.8 * random(), t - (3 * random()) / fps);
            asked++;
          }
          const { amount } = flash.at(t);
          assert.ok(amount >= 0 && amount <= FLASH_CAP, `${amount} at ${t} s`);
          amounts.push(amount);
          times.push(t);
        }
        most = Math.max(most, mostInASecond(riseTimes(amounts.map((amount) => amount / FLASH_CAP), times)));
        const starts = brighteningStarts(times, amounts, 0.1 * FLASH_CAP);
        for (let k = 1; k < starts.length; k++) {
          assert.ok(starts[k] - starts[k - 1] >= FLASH_GAP, `${fps} fps, ${rate} a second: a brightening at ${starts[k]} s`);
        }
        mostBrightening = Math.max(mostBrightening, mostInASecond(starts));
      }
    }
  }
  assert.ok(asked > 5000, `${asked} flashes asked`);
  assert.equal(most, 3, `the busiest second had ${most} rises`);
  assert.equal(mostBrightening, 3, `the busiest second had ${mostBrightening} brightenings`);
});

test('of two flashes at once the brighter wins, in its colour; one asked for later starts then; clear() ends it', () => {
  // Two flashes asked for the same time: the brighter wins, in its colour, whichever was asked first; on a tie the
  // first keeps it.
  const together: { asked: [number, number][]; color: number; strength: number }[] = [
    { asked: [[RED, 0.4], [BLUE, 0.9]], color: BLUE, strength: 0.9 },
    { asked: [[BLUE, 0.9], [RED, 0.4]], color: BLUE, strength: 0.9 },
    { asked: [[RED, 0.6], [BLUE, 0.6]], color: RED, strength: 0.6 },
    { asked: [[RED, 0.3], [GOLD, 0.7], [BLUE, 0.5]], color: GOLD, strength: 0.7 },
  ];
  for (const { asked, color, strength } of together) {
    const flash = new ScreenFlash();
    for (const [c, s] of asked) flash.flash(c, s, 2);
    const peak = look(flash, 2);
    assert.equal(peak.color, color);
    assert.ok(near(peak.amount, FLASH_CAP * strength, 1e-12), `${peak.amount} at the peak, wanted ${FLASH_CAP * strength}`);
    // ...and it dies away as that flash does alone.
    const dying = look(flash, 2 + 1 / 7);
    assert.equal(dying.color, color);
    assert.ok(near(dying.amount, (FLASH_CAP * strength) / Math.E, 1e-12));
  }
  // Asked for the same time before it comes, they merge as well.
  const early = new ScreenFlash();
  early.flash(RED, 0.4, 5);
  assert.equal(look(early, 1).amount, 0, 'nothing before its time');
  early.flash(BLUE, 0.9, 5);
  const merged = look(early, 5);
  assert.equal(merged.color, BLUE);
  assert.ok(near(merged.amount, FLASH_CAP * 0.9, 1e-12));

  // One asked for later starts then: nothing of it before, and its own peak at its time, as the one before dies away.
  const later = new ScreenFlash();
  later.flash(RED, 1, 0);
  later.flash(BLUE, 0.8, 0.6);
  assert.equal(look(later, 0).color, RED);
  const mid = look(later, 0.3);
  assert.equal(mid.color, RED);
  assert.ok(near(mid.amount, FLASH_CAP * Math.exp(-2.1), 1e-12), `red 0.3 s on is ${mid.amount}`);
  const just = look(later, 0.599);
  assert.equal(just.color, RED, 'red is still dying away a moment before blue begins');
  assert.ok(just.amount > 0 && just.amount < mid.amount);
  const then = look(later, 0.6);
  assert.equal(then.color, BLUE, 'blue begins at its time');
  assert.ok(near(then.amount, FLASH_CAP * 0.8, 1e-12), `blue at its peak is ${then.amount}`);
  // A long way ahead, it waits as long as it is asked to.
  const far = new ScreenFlash();
  far.flash(GOLD, 1, 5);
  assert.equal(look(far, 0).amount, 0);
  assert.equal(look(far, 4.9).amount, 0);
  assert.equal(look(far, 5).color, GOLD);
  assert.equal(look(far, 5).amount, FLASH_CAP);

  // A flash that is still brighter than a later one, dying away, stays the one seen: the later one never shows. It is
  // still the last flash begun, so one asked for 0.16 s after it is too soon.
  const hidden = new ScreenFlash();
  hidden.flash(RED, 1, 0);
  hidden.flash(BLUE, 0.05, FLASH_GAP); // red is 0.09 of its peak by then, and blue only 0.05
  hidden.flash(GOLD, 1, FLASH_GAP + 0.16);
  for (let i = 0; i * LOOK < 1.5; i++) {
    const shown = look(hidden, i * LOOK);
    assert.ok(shown.amount === 0 || shown.color === RED, `at ${i * LOOK} s the picture is ${shown.color.toString(16)}`);
  }

  // A flash asked for less than FLASH_GAP after the last one's start is dropped, and so is one asked for before it. One
  // asked for FLASH_GAP after is let through.
  const soon = new ScreenFlash();
  soon.flash(RED, 0.5, 0);
  soon.flash(BLUE, 1, 0.2);
  soon.flash(GOLD, 1, FLASH_GAP - 0.001);
  soon.flash(WHITE, 0.7, FLASH_GAP);
  soon.flash(BLUE, 1, 0.1);
  // The first shows as it begins, so the one FLASH_GAP after it first shows FLASH_GAP after it.
  assert.equal(look(soon, 0).color, RED);
  for (const t of [0.2, FLASH_GAP - 0.001]) {
    const shown = look(soon, t);
    assert.equal(shown.color, RED, `the flash asked for too soon does not show at ${t}`);
    assert.ok(near(shown.amount, FLASH_CAP * 0.5 * Math.exp(-7 * t), 1e-12));
  }
  const gap = look(soon, FLASH_GAP);
  assert.equal(gap.color, WHITE);
  assert.ok(near(gap.amount, FLASH_CAP * 0.7, 1e-12), `${gap.amount} FLASH_GAP after`);

  // clear() ends the flash showing and any waiting for its time.
  const cleared = new ScreenFlash();
  cleared.flash(RED, 1, 1);
  cleared.flash(BLUE, 1, 4);
  assert.ok(look(cleared, 1).amount > 0);
  cleared.clear();
  assert.equal(look(cleared, 1).amount, 0, 'the flash showing is gone');
  assert.equal(look(cleared, 4).amount, 0, 'and the one that was waiting');
});

test("clear() starts the clock again: a flash on the new clock is not dropped for the old clock's times", () => {
  // Dropped for when the last flash began or showed? The old flash shows as it begins, at 100, and the new clock's
  // flash begins at 0.1 s: nothing of the old clock may drop it.
  const early = new ScreenFlash();
  early.flash(GOLD, 0.4, 100);
  assert.ok(look(early, 100).amount > 0);
  early.clear();
  early.flash(RED, 1, 0.1);
  const fresh = look(early, 0.1);
  assert.equal(fresh.color, RED);
  assert.ok(near(fresh.amount, FLASH_CAP, 1e-12), `a flash on the new clock is ${fresh.amount}`);

  // Dropped for when the last flash first showed? The old flash first showed 0.09 s late, at 100.09. The next is asked
  // for more than FLASH_GAP after the old one began, which the start rule allows, but it would first show at 100.35,
  // 0.26 s after the old one did, so only clear() lets it show.
  const strong = new ScreenFlash();
  strong.flash(GOLD, 1, 100);
  look(strong, 100.09);
  look(strong, 100.3);
  strong.clear();
  strong.flash(RED, 1, 100.35);
  const shown = look(strong, 100.35);
  assert.ok(near(shown.amount, FLASH_CAP, 1e-12), `after clear() the next flash is ${shown.amount}`);
  // Without clear() it is dropped, and only the old flash's tail is seen.
  const kept = new ScreenFlash();
  kept.flash(GOLD, 1, 100);
  look(kept, 100.09);
  look(kept, 100.3);
  kept.flash(RED, 1, 100.35);
  const dropped = look(kept, 100.35);
  assert.equal(dropped.color, GOLD, 'dropped without clear()');
  assert.ok(dropped.amount < 0.1 * FLASH_CAP, `the old flash's tail is ${dropped.amount}`);
});

test('a flash that would first show less than FLASH_GAP after the last first showed is dropped, though it began FLASH_GAP after the last began', () => {
  const flash = new ScreenFlash();
  // Asked for 0.34 s after the first began, which the start rule allows, and for 0.7 s.
  flash.flash(GOLD, 1, 0);
  flash.flash(RED, 1, FLASH_GAP);
  flash.flash(WHITE, 1, 0.7);
  // The first is first drawn 0.09 s late, and by 0.3 s it is dark again.
  assert.ok(look(flash, 0.09).amount > LIT_ABOVE * FLASH_CAP);
  assert.ok(look(flash, 0.3).amount < DARK_BELOW * FLASH_CAP);
  // The second would first show at 0.34, only 0.25 s after the first did, so it is dropped. It is not put off to a
  // later look either: only the first's tail is seen until the third.
  for (let i = 0; i < 86; i++) {
    const shown = look(flash, FLASH_GAP + i * LOOK);
    assert.ok(shown.amount === 0 || shown.color === GOLD, `at ${FLASH_GAP + i * LOOK} s the picture is ${shown.color.toString(16)}`);
  }
  // A flash that was dropped did not show: the third, 0.61 s after the first showed, shows at its peak.
  const third = look(flash, 0.7);
  assert.equal(third.color, WHITE);
  assert.ok(near(third.amount, FLASH_CAP, 1e-12), `the third is ${third.amount}`);

  // Nor does a flash that is hidden by a brighter one dying away count as having shown. The first shows at 0; the
  // second (weak, begun FLASH_GAP after) is first looked at only at 0.5 and is hidden by the first's tail; the third,
  // begun FLASH_GAP after the second, shows at its peak, though that is 0.18 s after the second was first looked at.
  const hidden = new ScreenFlash();
  hidden.flash(GOLD, 1, 0);
  hidden.flash(RED, 0.05, FLASH_GAP);
  hidden.flash(WHITE, 1, 2 * FLASH_GAP);
  assert.equal(look(hidden, 0).color, GOLD);
  assert.equal(look(hidden, 0.5).color, GOLD, 'the weak flash is hidden by the first');
  const behind = look(hidden, 2 * FLASH_GAP);
  assert.equal(behind.color, WHITE);
  assert.ok(near(behind.amount, FLASH_CAP, 1e-12), `the third is ${behind.amount}`);

  // So flashes asked as soon as the start rule lets them (0.35 s apart), the first drawn 0.09 s late, lose the second:
  // the first shows at 0.09, the second would show at 0.3525, and the third, at 0.7025, is the next to show. The rest
  // show 0.35 s apart, and rise at most 3 times in any second.
  const stream = new ScreenFlash();
  for (let k = 0; k < 20; k++) stream.flash(GOLD, 1, k * 0.35);
  const levels: number[] = [];
  const times: number[] = [];
  for (let i = 0; 0.09 + i * LOOK < 6; i++) {
    times.push(0.09 + i * LOOK);
    levels.push(stream.at(times[i]).amount / FLASH_CAP);
  }
  const rises = riseTimes(levels, times);
  assert.ok(near(rises[0], 0.09) && near(rises[1], 0.7025), `the first rises are at ${rises.slice(0, 3)}`);
  for (let k = 1; k < rises.length; k++) assert.ok(rises[k] - rises[k - 1] >= FLASH_GAP, `rise ${k} at ${rises[k]}`);
  assert.ok(rises.length >= 12, `${rises.length} rises in 6 s: it still flashes`);
  assert.ok(mostInASecond(rises) <= 3, `${mostInASecond(rises)} rises in a second`);
});

test('the amount goes through a RiseLimit, though the two gaps leave it nothing to hold', () => {
  // The gaps keep the picture to 3 rises a second with no help, so RiseLimit is never left a flash to hold. It stays in
  // the path as the guard that every light on the table has. So stand in for it, and see that the amount is what it
  // gives, that it is asked at every look (nothing showing included, which is how it sees a light go dark), and that
  // clear() resets it. A stand-in that halves what it is asked shows each of those.
  const flash = new ScreenFlash();
  const limit = (flash as unknown as { limit: { level(raw: number, t: number): number; reset(): void } }).limit;
  const asked: number[][] = [];
  let resets = 0;
  limit.level = (raw, t) => {
    asked.push([raw, t]);
    return raw / 2;
  };
  limit.reset = () => {
    resets++;
  };
  assert.equal(flash.at(0).amount, 0);
  flash.flash(GOLD, 0.8, 1);
  assert.ok(near(look(flash, 1).amount, 0.4 * FLASH_CAP, 1e-12), 'the amount is what RiseLimit gives');
  flash.at(NaN);
  assert.deepEqual(asked, [[0, 0], [0.8, 1]], 'asked at every look with the light as it is, but not at a time that is no time');
  flash.clear();
  assert.equal(resets, 1, 'and reset by clear()');
});

test("one more RiseLimit counts real seconds: with the table's clock 1.5 times as fast, flashes as fast as the gaps allow rise at most 3 times in any real second, and a hello's clear() never resets it", () => {
  // The gaps and the first RiseLimit count the table's seconds, and the drawn table time can outrun real time (the
  // kit's render clock jumps its offset forward after a stall). So the stage passes the browser's own clock to at()
  // too, and the amount goes through one more RiseLimit on it. Here the table's clock runs 1.5 times as fast as real
  // time, looked at 60 times a real second, and a flash is asked at every look for its own time: the gaps let one
  // through every 0.35 table seconds, which is every 0.23 real seconds.
  const step = 1 / 60;
  const guarded = new ScreenFlash();
  const plain = new ScreenFlash();
  const times: number[] = [];
  const levels: number[] = [];
  const plainLevels: number[] = [];
  for (let k = 0; k < 600; k++) {
    const real = k * step;
    const t = 1.5 * real;
    for (const f of [guarded, plain]) f.flash(WHITE, 1, t);
    times.push(real);
    levels.push(guarded.at(t, real).amount / FLASH_CAP);
    plainLevels.push(plain.at(t).amount / FLASH_CAP);
  }
  // On the table's clock alone the picture rises more than 3 times in a real second...
  const loose = mostInASecond(riseTimes(plainLevels, times));
  assert.ok(loose > 3, `on the table's clock alone the picture rises ${loose} times in a real second`);
  // ...and with real seconds counted, at most 3, FLASH_GAP or more apart, and it still flashes.
  const rises = riseTimes(levels, times);
  assert.ok(mostInASecond(rises) <= 3, `${mostInASecond(rises)} rises in a real second`);
  for (let k = 1; k < rises.length; k++) assert.ok(rises[k] - rises[k - 1] >= FLASH_GAP, `rise ${k} at ${rises[k]} s`);
  assert.ok(rises.length >= 20, `${rises.length} rises in 10 real seconds: it still flashes`);
  for (const level of levels) assert.ok(level >= 0 && level <= 1, `${level} of the cap`);

  // A hello: clear() starts the table's clock again, but real time goes on, and so does the guard on it. A flash rose
  // at 50 real seconds and has gone dark; the next, on the new clock, is held until FLASH_GAP after that rise.
  const hello = new ScreenFlash();
  hello.flash(GOLD, 1, 100);
  assert.equal(look(hello, 100, 50).amount, FLASH_CAP, 'the first flash rises');
  assert.ok(look(hello, 100.3, 50.2).amount < DARK_BELOW * FLASH_CAP, 'and is dark 0.3 s on');
  hello.clear();
  hello.flash(RED, 1, 0.1);
  const held = look(hello, 0.1, 50.25);
  assert.ok(near(held.amount, DARK_BELOW * FLASH_CAP, 1e-12), `0.25 real seconds after the last rise the next is held: ${held.amount}`);
  hello.flash(BLUE, 1, 0.5);
  const free = look(hello, 0.5, 50.4);
  assert.equal(free.color, BLUE);
  assert.ok(near(free.amount, FLASH_CAP, 1e-12), `0.4 real seconds after it the next shows in full: ${free.amount}`);
  // Without the real clock, as before, the hello lets the next flash show in full at once.
  const bare = new ScreenFlash();
  bare.flash(GOLD, 1, 100);
  look(bare, 100);
  look(bare, 100.3);
  bare.clear();
  bare.flash(RED, 1, 0.1);
  assert.equal(look(bare, 0.1).amount, FLASH_CAP, 'on the table clock alone the hello lets it through');
});

test('a long run of flashes holds only the one showing and those still to begin, never a list that grows', () => {
  const flash = new ScreenFlash();
  /** How many flashes it holds (private: it is what keeps the list from growing without end). */
  const held = () => (flash as unknown as { held: unknown[] }).held.length;
  // 20 minutes of the table's time: a flash asked for as it begins every 0.4 s, in three strengths, looked at 60 times
  // a second. Of all those it holds the one showing and no more.
  let most = 0;
  for (let i = 0; i < 20 * 60 * 60; i++) {
    const t = i / 60;
    if (i % 24 === 0) flash.flash(GOLD, [0.3, 0.65, 1][(i / 24) % 3], t);
    flash.at(t);
    most = Math.max(most, held());
  }
  assert.equal(most, 1, 'the flash showing, and nothing before or after it');

  // Flashes asked for ahead of the clock are held till their time and let go after it.
  const ahead = new ScreenFlash();
  const heldAhead = () => (ahead as unknown as { held: unknown[] }).held.length;
  for (let k = 0; k < 5; k++) ahead.flash(WHITE, 1, 100 + k);
  for (const [t, want] of [[99, 5], [100.5, 5], [101.5, 4], [104.5, 1], [110, 0]]) {
    ahead.at(t);
    assert.equal(heldAhead(), want, `${want} held at ${t}`);
  }
});

test('at() refills one object, so nothing is made per frame, and shows the same while the clock stands still', () => {
  const flash = new ScreenFlash();
  const first = flash.at(0);
  assert.equal(first.amount, 0);
  flash.flash(GOLD, 1, 1);
  const second = flash.at(1);
  assert.equal(second, first, 'the same object');
  assert.equal(second.color, GOLD);
  assert.equal(second.amount, FLASH_CAP);
  const kept = { ...second };
  const third = flash.at(1.2);
  assert.equal(third, first, 'the same object again');
  assert.ok(near(third.amount, FLASH_CAP * Math.exp(-1.4), 1e-12), 'filled in again');
  assert.equal(kept.amount, FLASH_CAP, 'a copy kept is not changed by the next call');
  // The clock standing still: the table has stopped, and so has the flash.
  const still = { ...third };
  for (let k = 0; k < 10; k++) assert.deepEqual({ ...flash.at(1.2) }, still);
  flash.clear();
  assert.equal(flash.at(1.2), first, 'and after clear()');
  assert.equal(first.amount, 0);
});

test('a flash of no strength, or at a time that is not a number, does nothing and holds up no other', () => {
  const flash = new ScreenFlash();
  for (const strength of [0, -1, -Infinity, NaN, 1e-9]) flash.flash(RED, strength, 1);
  for (const at of [NaN, Infinity, -Infinity]) flash.flash(RED, 1, at);
  assert.equal(look(flash, 1).amount, 0, 'nothing is lit');
  // None of them counted as the last flash begun: one a moment after is let through.
  flash.flash(BLUE, 0.5, 1.05);
  const shown = look(flash, 1.05);
  assert.equal(shown.color, BLUE);
  assert.ok(near(shown.amount, 0.5 * FLASH_CAP, 1e-12));
  // A clock that is not a number draws nothing, and leaves what is showing as it was.
  for (const t of [NaN, Infinity, -Infinity]) {
    assert.equal(flash.at(t).amount, 0, `at ${t}`);
    assert.equal(flash.at(t).color, 0);
  }
  assert.deepEqual(look(flash, 1.05), shown);
});

test('a flash that has been drawn is not made brighter by one asked for its time later; one not yet drawn still merges', () => {
  // The flash begins at 5 and is drawn 0.1 s in. A flash for the same time that reaches the stage only now would
  // brighten it in the middle of its dying away, where no flash begins, so it is dropped.
  const flash = new ScreenFlash();
  flash.flash(RED, 0.5, 5);
  const before = look(flash, 5.1);
  flash.flash(BLUE, 1, 5);
  assert.deepEqual(look(flash, 5.1), before, 'the same picture');
  let last = before.amount;
  for (let i = 1; i * LOOK < 1.5; i++) {
    const shown = look(flash, 5.1 + i * LOOK);
    assert.ok(shown.amount <= last, `it brightened at ${5.1 + i * LOOK}`);
    assert.ok(shown.amount === 0 || shown.color === RED);
    last = shown.amount;
  }
  // Nor is it let through once the flash has gone: that time is still the last flash's start.
  flash.flash(BLUE, 1, 5);
  assert.equal(look(flash, 7).amount, 0);

  // A flash whose time is past but that has not been drawn is not drawn yet: its twin still merges by the brighter.
  const late = new ScreenFlash();
  late.at(9);
  late.flash(RED, 0.5, 8.95);
  late.flash(BLUE, 1, 8.95);
  const merged = look(late, 9);
  assert.equal(merged.color, BLUE);
  assert.ok(near(merged.amount, FLASH_CAP * Math.exp(-7 * 0.05), 1e-12));
});

/** Grain i of the sand as the stage's renderer reads it: where it is, and how bright (0 once it is out). */
function grain(s: InstanceType<typeof Sand>, i: number) {
  const pos = s.points.geometry.attributes.position.array;
  const col = s.points.geometry.attributes.color.array;
  return { x: pos[3 * i], y: pos[3 * i + 1], z: pos[3 * i + 2], a: col[4 * i + 3] };
}

test('sand blows across from the windward edge and leaves; none enter with no wind; the pool never grows', () => {
  const step = 1 / 120;
  const half = TABLE.width / 2;
  for (const dir of [1, -1] as const) {
    const sand = new Sand();
    const position = sand.points.geometry.attributes.position;
    const color = sand.points.geometry.attributes.color;
    assert.equal(MAX_GRAINS, 240);
    assert.equal(position.count, MAX_GRAINS, 'a pool of 240');
    assert.equal(sand.live(), 0, 'none alight at the start');
    // Each grain's place at the last frame, to see each move with the wind and down the table.
    const was = new Map<number, { x: number; z: number }>();
    let entered = 0;
    let most = 0;
    for (let k = 0; k * step < 6; k++) {
      sand.blow(dir, 100 + k * step);
      sand.update(step);
      most = Math.max(most, sand.live());
      for (let i = 0; i < MAX_GRAINS; i++) {
        const g = grain(sand, i);
        if (g.a === 0) {
          assert.ok(g.y < -100, `${dir}: grain ${i} out of sight once it is out`);
          was.delete(i);
          continue;
        }
        assert.ok(Math.abs(g.x) <= half + 1e-6 && g.z >= -1e-6 && g.z <= TABLE.length + 1e-6 && g.y > 0, `${dir}: grain ${i} over the table at (${g.x}, ${g.y}, ${g.z})`);
        const before = was.get(i);
        if (!before) {
          // A new grain comes in at the windward edge, a frame's flight in at most.
          entered++;
          assert.ok(Math.abs(g.x + dir * half) <= 6 * step + 1e-5, `${dir}: grain ${i} enters at the windward edge, at x ${g.x}`);
        } else {
          const dx = (g.x - before.x) * dir;
          assert.ok(dx >= 4 * step - 1e-5 && dx <= 6 * step + 1e-5, `${dir}: grain ${i} crosses at 4 to 6 a second (${dx / step})`);
          assert.ok(g.z <= before.z + 1e-6, `${dir}: grain ${i} drifts down the table, never up it`);
        }
        was.set(i, { x: g.x, z: g.z });
      }
    }
    // About 60 a second, steadily: 6 s of wind is about 360 grains, and the pool is never more than full.
    assert.ok(entered >= 340 && entered <= 380, `${dir}: ${entered} grains in 6 s`);
    assert.ok(most <= MAX_GRAINS, `${dir}: at most ${most} alight`);
    assert.ok(most >= 90, `${dir}: the table full of sand (${most} alight)`);
    // The wind drops: none enter, and those in flight finish crossing and leave.
    let left = sand.live();
    for (let k = 0; k * step < 3; k++) {
      sand.blow(0, 106 + k * step);
      sand.update(step);
      assert.ok(sand.live() <= left, `${dir}: no grain enters with no wind`);
      left = sand.live();
    }
    assert.equal(sand.live(), 0, `${dir}: all of them gone 3 s after the wind dropped`);
    // The buffers are the ones made at the start.
    assert.equal(sand.points.geometry.attributes.position, position);
    assert.equal(sand.points.geometry.attributes.color, color);
    assert.equal(position.array.length, MAX_GRAINS * 3);
    // Nothing moves while the table's clock stands still.
    sand.blow(dir, 200);
    sand.update(step);
    const still = Array.from({ length: MAX_GRAINS }, (_, i) => grain(sand, i));
    sand.blow(dir, 200);
    sand.update(0);
    still.forEach((g, i) => assert.deepEqual(grain(sand, i), g, `${dir}: grain ${i} still at update(0)`));
    sand.clear();
    assert.equal(sand.live(), 0, 'clear() lets every grain go');
  }
  // Sand is its own pool: sparks thrown while it blows have all the sparks' 400, and the sand's 240 are its own.
  const sparks = new Sparks();
  const sand = new Sand();
  for (let k = 0; k < 600; k++) {
    sand.blow(1, k * step);
    sand.update(step);
  }
  sparks.burst(0, 0.4, 8, 0xffffff, 1000);
  assert.equal(sparks.live(), MAX_SPARKS, 'the sparks have all of theirs');
  assert.ok(sand.live() > 0 && sand.live() <= MAX_GRAINS);
});

test('hazeAt eases in over 0.8 s, holds at most 0.18, eases out, and never changes faster', () => {
  assert.equal(HAZE.color, 0xd9a35a);
  assert.equal(HAZE.most, 0.18);
  assert.equal(HAZE.ease, 0.8);
  // No storm, no haze.
  assert.equal(hazeAt(null, null, 5), 0);
  assert.equal(hazeAt(null, 20, 5), 0);
  // A storm first seen at 10, until 20.
  const at = (t: number) => hazeAt(10, 20, t);
  assert.equal(at(9), 0, 'none before it was seen');
  assert.equal(at(10), 0, 'none at the moment it was seen');
  assert.ok(near(at(10.4), 0.09), `half way in at 0.4 s: ${at(10.4)}`);
  assert.ok(near(at(10.8), 0.18), 'all the way in at 0.8 s');
  assert.ok(near(at(15), 0.18), 'held at 0.18');
  assert.ok(near(at(19.6), 0.09), `half way out 0.4 s before its end: ${at(19.6)}`);
  assert.equal(at(20), 0, 'gone at its end');
  assert.equal(at(25), 0, 'and after');
  // A page opened in the middle of the storm shows it as if it began long ago.
  assert.ok(near(hazeAt(-Infinity, 20, 15), 0.18), 'opened mid-storm: eased in already');
  // Never more than 0.18, never below 0, and never faster than the ease (0.18 in 0.8 s), a short storm too.
  const fastest = HAZE.most / HAZE.ease;
  for (const [seen, until] of [[10, 20], [10, 11], [10, 10.5], [-Infinity, 12]] as const) {
    const dt = 1 / 240;
    let last = hazeAt(seen, until, 8);
    for (let t = 8 + dt; t < 22; t += dt) {
      const h = hazeAt(seen, until, t);
      assert.ok(h >= 0 && h <= HAZE.most + 1e-12, `${seen}-${until} at ${t}: ${h}`);
      assert.ok(Math.abs(h - last) <= fastest * dt + 1e-9, `${seen}-${until} at ${t}: ${last} to ${h} in ${dt} s`);
      last = h;
    }
  }
  // A second storm bought in the ease out moves its end on, so hazeAt jumps back up; easeHaze, which the stage draws it
  // through, takes it there no faster than the ease.
  const dt = 1 / 144;
  let shown = 0;
  let until = 20;
  let most = 0;
  for (let t = 10; t < 32; t += dt) {
    if (t >= 19.7) until = 30;
    const was = shown;
    shown = easeHaze(shown, hazeAt(10, until, t), dt);
    most = Math.max(most, Math.abs(shown - was) / dt);
    assert.ok(shown >= 0 && shown <= HAZE.most + 1e-12);
  }
  assert.ok(most <= fastest + 1e-9, `the drawn haze changes at most ${fastest} a second: ${most}`);
  assert.equal(shown, 0, 'gone after the second end');
  assert.equal(easeHaze(0.1, 0.18, 0), 0.1, 'it stands still while the clock does');
  assert.equal(easeHaze(0.1, 0.18, Number.NaN), 0.1, 'and at a step that is no number');
});

test("HazeTracker: a page opened mid-storm shows it at once, once; after that a hello, a clock going back or a storm's end only ease it, in real seconds too", () => {
  const fastest = HAZE.most / HAZE.ease;
  type Tracker = InstanceType<typeof HazeTracker>;
  /**
   * Frames from table time `from` to `to`, `step` apart on the table's clock and `real` apart on the browser's, with
   * `storm` the state's: every frame changes the haze by no more than the ease allows over the smaller step. Returns
   * the haze drawn at the last frame.
   */
  const run = (t: Tracker, storm: { until: number } | null, from: number, to: number, step = 1 / 60, real = step): number => {
    for (let now = from; now <= to + 1e-9; now += step) {
      const was = t.level;
      const h = t.frame(storm, now, step, real);
      assert.ok(h >= 0 && h <= HAZE.most + 1e-12, `${now}: ${h}`);
      assert.ok(Math.abs(h - was) <= fastest * Math.min(step, real) + 1e-12, `at ${now.toFixed(3)} the haze went ${was} to ${h} in one frame`);
    }
    return t.level;
  };

  // A page opened in the middle of a storm shows it eased in already, at its first look, and only then.
  const opened = new HazeTracker();
  assert.ok(near(opened.frame({ until: 20 }, 15, 0, 0), HAZE.most), 'opened mid-storm: eased in at once');
  assert.ok(near(run(opened, { until: 20 }, 15 + 1 / 60, 18), HAZE.most), 'and held');
  // The storm gone from the state early (a hello whose connection has none): eased out, not dropped.
  assert.ok(run(opened, null, 18, 18.4) > 0.05, 'still easing out 0.4 s on');
  assert.equal(run(opened, null, 18.4, 19.5), 0, 'and out');

  // A page opened before the storm: it eases in from when it was first seen.
  const plain = new HazeTracker();
  assert.equal(plain.frame(null, 5, 0, 0), 0);
  run(plain, null, 5, 10 - 1 / 60);
  const half = run(plain, { until: 20 }, 10, 10.4);
  assert.ok(Math.abs(half - HAZE.most / 2) < 0.01, `half way in 0.4 s on: ${half}`);

  // A hello in the middle of the ease in. The server carried on: the new connection's storm carries on easing in.
  const sameClock = new HazeTracker();
  sameClock.frame(null, 9.9, 0, 0);
  run(sameClock, { until: 20 }, 10, 10.4);
  assert.ok(near(run(sameClock, { until: 20 }, 10.4 + 1 / 60, 11), HAZE.most), 'the ease in goes on after the hello');
  // The server restarted, its clock back at 2, with a storm of its own: forgotten as the old clock's, and seen again
  // from where the picture is, so it goes on up with no dip.
  const restarted = new HazeTracker();
  restarted.frame(null, 9.9, 0, 0);
  const before = run(restarted, { until: 20 }, 10, 10.4);
  let low = before;
  for (let now = 2; now < 3; now += 1 / 60) {
    const was = restarted.level;
    const h = restarted.frame({ until: 9 }, now, now === 2 ? 0 : 1 / 60, 1 / 60);
    assert.ok(Math.abs(h - was) <= fastest / 60 + 1e-12, `restarted at ${now}: ${was} to ${h}`);
    low = Math.min(low, h);
  }
  assert.ok(near(low, before), `no dip after the restart (${low}, from ${before})`);
  assert.ok(near(restarted.level, HAZE.most), 'and all the way in');

  // A hello in the hold: a new connection with no storm eases it out, and one with its storm on keeps it.
  const held = new HazeTracker();
  held.frame(null, 9.9, 0, 0);
  run(held, { until: 20 }, 10, 15);
  assert.ok(near(held.level, HAZE.most));
  assert.ok(near(held.frame({ until: 7 }, 1, 0, 1 / 60), HAZE.most), 'restarted with the storm on: held, not eased in again');
  assert.ok(near(run(held, { until: 7 }, 1 + 1 / 60, 5), HAZE.most));
  assert.ok(held.frame(null, 5.02, 1 / 60, 1 / 60) > HAZE.most - 0.01, 'its storm gone: easing out, not dropped');

  // A hello in the ease out: easing on down to nothing with no storm, or back up for the new connection's longer one.
  for (const next of [null, { until: 30 }]) {
    const out = new HazeTracker();
    out.frame(null, 9.9, 0, 0);
    run(out, { until: 20 }, 10, 19.6);
    assert.ok(Math.abs(out.level - HAZE.most / 2) < 0.01, `half way out: ${out.level}`);
    const end = run(out, next, 19.6 + 1 / 60, 21);
    assert.ok(next ? near(end, HAZE.most) : end === 0, `then ${next ? 'back up' : 'out'}: ${end}`);
  }

  // A storm bought straight after a server restart, while the old clock's storm was still seen: it gets its haze.
  const bought = new HazeTracker();
  bought.frame(null, 49.9, 0, 0);
  run(bought, { until: 60 }, 50, 50.01);
  const fresh = run(bought, { until: 12 }, 2, 3);
  assert.ok(near(fresh, HAZE.most), `the new storm hazes the picture: ${fresh}`);

  // The table's clock running faster than real time: the ease still takes 0.8 real seconds. 60 frames a real second
  // with 0.1 s of table time each: after 0.4 real seconds (4 s of table time) it is only half way in.
  const fast = new HazeTracker();
  fast.frame(null, 9.9, 0, 0);
  const quick = run(fast, { until: 100 }, 10, 34, 0.1, 1 / 60);
  assert.ok(near(quick, HAZE.most), 'all the way in, in the end');
  const fast2 = new HazeTracker();
  fast2.frame(null, 9.9, 0, 0);
  const at = run(fast2, { until: 100 }, 10, 10 + 23 * 0.1, 0.1, 1 / 60);
  assert.ok(at <= (HAZE.most / HAZE.ease) * (24 / 60) + 1e-9, `0.4 real seconds in: ${at}`);
  // A frame with no time (the first, or a clock standing still) changes nothing.
  assert.equal(fast2.frame(null, 12.4, 0, 0), at);
  assert.equal(fast2.frame(null, 12.4, 0.1, 0), at);
});

// The balls' trails and glows (stage/ball-trail.ts), driven as the stage drives them: show() for each ball each frame on
// the drawn clock, then frame().
const { BALL_LOOK, BallTrails, GLOW_SEGMENTS } = await import('../src/stage/ball-trail');
type BallTrails = InstanceType<typeof BallTrails>;
const R = TABLE.ballRadius;
/** The ball's centre over the playfield, as the stage places it. */
const BALL_Y = R;

/** The trails' mesh and the glows' mesh, as the stage adds them to the table. */
function meshes(b: BallTrails) {
  const [trails, glows] = b.group.children as THREE.Mesh[];
  return { trails, glows };
}

/** Slot `s`'s trail as its vertices: two at each point, the head's first, each with where it is and its RGBA. */
function strip(b: BallTrails, s: number) {
  const g = meshes(b).trails.geometry;
  const pos = g.attributes.position.array;
  const col = g.attributes.color.array;
  const out: { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[] = [];
  for (let k = 0; k < 2 * BALL_LOOK.trailPoints; k++) {
    const v = 2 * BALL_LOOK.trailPoints * s + k;
    out.push({ x: pos[3 * v], y: pos[3 * v + 1], z: pos[3 * v + 2], r: col[4 * v], g: col[4 * v + 1], b: col[4 * v + 2], a: col[4 * v + 3] });
  }
  return out;
}

/** Slot `s`'s glow as its centre vertex (the fan's first): where it is and its RGBA. */
function glow(b: BallTrails, s: number) {
  const g = meshes(b).glows.geometry;
  const pos = g.attributes.position.array;
  const col = g.attributes.color.array;
  const v = (GLOW_SEGMENTS + 1) * s;
  return { x: pos[3 * v], y: pos[3 * v + 1], z: pos[3 * v + 2], r: col[4 * v], g: col[4 * v + 1], b: col[4 * v + 2], a: col[4 * v + 3] };
}

/**
 * Drives ball `id` along `path` (its place across and up the table at a time) from `from` to `to` seconds, a frame each
 * `dt`, and returns the time it ended at.
 */
function drive(
  b: BallTrails,
  id: number,
  path: (t: number) => [number, number],
  from: number,
  to: number,
  opts: { dt?: number; color?: number | null; held?: boolean } = {},
): number {
  const dt = opts.dt ?? 1 / 60;
  let last = from;
  for (let k = 0; from + k * dt <= to + 1e-9; k++) {
    last = from + k * dt;
    const [x, z] = path(last);
    b.show(id, x, BALL_Y, z, opts.color ?? null, opts.held ?? false, last);
    b.frame(last, last);
  }
  return last;
}

/** Straight up the table at `speed` units a second from (0, 2). */
const upAt =
  (speed: number) =>
  (t: number): [number, number] => [0, 2 + speed * t];

/**
 * An opacity read back from the buffers as a share of `peak`, to a millionth. A trail can stop at exactly LIT_ABOVE (at
 * 30 Hz it rises 0.1 a frame), which the 32-bit buffer holds as a hair over it, though what RiseLimit was given and
 * what a viewer sees is not over it.
 */
const share = (a: number, peak: number) => Math.round((a / peak) * 1e6) / 1e6;

/** A hex colour as the buffers hold it (three's working colour, in 32 bits). */
function rgbOf(hex: number) {
  const c = new THREE.Color().setHex(hex);
  return [Math.fround(c.r), Math.fround(c.g), Math.fround(c.b)];
}

test('a slow ball has no trail; a fast one has it, brighter with speed up to its peak', () => {
  assert.deepEqual(
    { ...BALL_LOOK },
    { trailFrom: 18, trailFull: 36, trailSeconds: 0.12, trailPoints: 8, trailPeak: 0.55, glowRadii: 1.6, glowOpacity: 0.22, houseColor: 0xffc23a },
  );
  const level = (speed: number) => {
    const b = new BallTrails(8, R);
    drive(b, 1, upAt(speed), 0, 1);
    return { b, opacity: b.trailOpacity(1) };
  };
  for (const speed of [0, 5, 12, 17]) {
    const { b, opacity } = level(speed);
    assert.equal(opacity, 0, `no trail at ${speed}`);
    assert.ok(
      strip(b, 0).every((v) => v.a === 0),
      `nothing drawn at ${speed}`,
    );
  }
  let last = 0;
  for (const speed of [20, 24, 27, 30, 34]) {
    const { opacity } = level(speed);
    const want = BALL_LOOK.trailPeak * ((speed - 18) / 18);
    assert.ok(Math.abs(opacity - want) < 0.01, `at ${speed}: ${opacity}, not ${want}`);
    assert.ok(opacity > last, `brighter at ${speed} than slower`);
    last = opacity;
  }
  for (const speed of [36, 50, 80]) assert.ok(near(level(speed).opacity, BALL_LOOK.trailPeak, 1e-6), `at its peak at ${speed}`);

  // At its peak the head is as bright as the peak and as wide as the ball, and the strip fades and narrows to nothing
  // at its tail; it lies along the path behind the ball, over the last 0.12 s of it.
  const { b } = level(40);
  const s = strip(b, 0);
  const head = [s[0], s[1]];
  const tail = [s[s.length - 2], s[s.length - 1]];
  assert.ok(near(head[0].a, BALL_LOOK.trailPeak, 1e-6) && near(head[1].a, BALL_LOOK.trailPeak, 1e-6), `head: ${head[0].a}`);
  assert.ok(near(Math.hypot(head[0].x - head[1].x, head[0].z - head[1].z), 2 * R, 1e-5), 'as wide as the ball at its head');
  assert.ok(tail[0].a === 0 && tail[1].a === 0, 'faded to nothing at its tail');
  assert.ok(near(Math.hypot(tail[0].x - tail[1].x, tail[0].z - tail[1].z), 0, 1e-5), 'and narrowed to nothing');
  for (let k = 2; k < s.length; k += 2) assert.ok(s[k].a <= s[k - 2].a, 'fading along the strip');
  assert.ok(head[0].z > tail[0].z, 'the head is ahead, up the table');
  const length = head[0].z - tail[0].z;
  assert.ok(length > 40 * 0.09 && length <= 40 * BALL_LOOK.trailSeconds + 1e-4, `the last 0.12 s of the path: ${length}`);

  // The same at 180 frames a second (the built stage's rate): the strip still covers about 0.12 s, not 8 frames.
  const quick = new BallTrails(8, R);
  drive(quick, 1, upAt(40), 0, 1, { dt: 1 / 180 });
  const q = strip(quick, 0);
  const qLength = q[0].z - q[q.length - 2].z;
  assert.ok(qLength > 40 * 0.09 && qLength <= 40 * BALL_LOOK.trailSeconds + 1e-4, `at 180 Hz: ${qLength}`);
});

test("each ball's trail and glow take its owner's colour; a house ball's, or a ball with no colour, are gold", () => {
  const b = new BallTrails(8, R);
  let t = 0;
  for (let k = 0; k < 60; k++) {
    t = k / 60;
    b.show(1, -2, BALL_Y, 2 + 40 * t, 0x3a7bff, false, t);
    b.show(2, 2, BALL_Y, 2 + 40 * t, null, false, t);
    b.frame(t, t);
  }
  const blue = rgbOf(0x3a7bff);
  const gold = rgbOf(BALL_LOOK.houseColor);
  for (const [s, want] of [
    [0, blue],
    [1, gold],
  ] as const) {
    const head = strip(b, s)[0];
    assert.deepEqual([head.r, head.g, head.b], want, `slot ${s}'s trail`);
    const g = glow(b, s);
    assert.deepEqual([g.r, g.g, g.b], want, `slot ${s}'s glow`);
    assert.ok(near(g.a, BALL_LOOK.glowOpacity, 1e-6), `its glow at ${BALL_LOOK.glowOpacity}: ${g.a}`);
    assert.ok(g.y > 0 && g.y <= 0.02, `the glow lies on the playfield: ${g.y}`);
  }
  // The glow is under its ball, a disc 1.6 ball radii out, lying flat and facing up, soft to its edge.
  const g = meshes(b).glows.geometry;
  const pos = g.attributes.position.array;
  const col = g.attributes.color.array;
  const c = glow(b, 0);
  assert.ok(near(c.x, -2, 1e-5) && near(c.z, 2 + 40 * t, 1e-4), 'under its ball');
  for (let k = 1; k <= GLOW_SEGMENTS; k++) {
    assert.ok(near(Math.hypot(pos[3 * k] - c.x, pos[3 * k + 2] - c.z), BALL_LOOK.glowRadii * R, 1e-5), 'its rim 1.6 radii out');
    assert.equal(pos[3 * k + 1], c.y, 'flat');
    assert.equal(col[4 * k + 3], 0, 'soft to its edge');
  }
  // Its triangles face up, so it is seen from above: each fan triangle's normal points up the y axis.
  const index = g.index!.array;
  for (let i = 0; i < GLOW_SEGMENTS * 3; i += 3) {
    const [a, p, q] = [index[i], index[i + 1], index[i + 2]];
    const ux = pos[3 * p] - pos[3 * a];
    const uz = pos[3 * p + 2] - pos[3 * a + 2];
    const vx = pos[3 * q] - pos[3 * a];
    const vz = pos[3 * q + 2] - pos[3 * a + 2];
    assert.ok(uz * vx - ux * vz > 0, 'facing up');
  }
  // The colour follows the ball: a ball taken over by a streamer turns their colour.
  b.show(2, 2, BALL_Y, 50, 0xff3a6e, false, t);
  b.frame(t, t);
  assert.deepEqual([glow(b, 1).r, glow(b, 1).g, glow(b, 1).b], rgbOf(0xff3a6e));
});

test("a ball keeps its owner's colour to the end when the state drops it before its despawn is drawn; the next ball in its slot starts gold", () => {
  // The state reaches the stage at once, the balls are drawn about 0.12 s behind it: a ball that drains is gone from
  // the state, so the stage finds no colour for it (null), for its last frames on the table.
  const b = new BallTrails(8, R);
  const blue = rgbOf(0x3a7bff);
  const gold = rgbOf(BALL_LOOK.houseColor);
  let t = drive(b, 1, upAt(40), 0, 0.5, { color: 0x3a7bff });
  t = drive(b, 1, upAt(40), t + 1 / 60, t + 0.12, { color: null });
  const head = strip(b, 0)[0];
  assert.ok(head.a > 0, 'its trail is still drawn');
  assert.deepEqual([head.r, head.g, head.b], blue, "its trail is still its owner's colour");
  assert.deepEqual([glow(b, 0).r, glow(b, 0).g, glow(b, 0).b], blue, 'and so is its glow');
  // Its despawn drawn, a house ball takes the slot: gold, not the last ball's colour.
  b.end(1);
  drive(b, 2, upAt(40), t + 1 / 60, t + 0.3, { color: null });
  assert.deepEqual([glow(b, 0).r, glow(b, 0).g, glow(b, 0).b], gold, 'the next ball in the slot is gold');
  // A ball the trails let go of without end() (missed for a frame) starts its colour again too.
  const c = new BallTrails(8, R);
  t = drive(c, 1, upAt(40), 0, 0.3, { color: 0x3a7bff });
  c.frame(t + 1 / 60, t + 1 / 60);
  drive(c, 3, upAt(40), t + 2 / 60, t + 0.3, { color: null });
  assert.deepEqual([glow(c, 0).r, glow(c, 0).g, glow(c, 0).b], gold);
});

test('the drawn clock going back without a clear() forgets the path: no streak is drawn back along the old one', () => {
  // The table's clock starting again (DrawnClock starts fresh when the drawn time goes back more than a second) with
  // the stage not calling clear(): the old path's times are all ahead of the new clock.
  const b = new BallTrails(8, R);
  let t = drive(b, 1, upAt(40), 100, 100.5);
  assert.ok(b.trailOpacity(1) > 0.5);
  // On the new clock the ball is a little on, as far as it flies in a frame, so no jump is seen.
  const z = 2 + 40 * t + 40 / 60;
  b.show(1, 0, BALL_Y, z, null, false, 0);
  b.frame(0, t + 1 / 60);
  assert.ok(
    strip(b, 0).every((v) => v.a === 0 || Math.hypot(v.x, v.z - z) <= 2 * R),
    'nothing drawn back along the old path',
  );
  // Flying on, on the new clock, its trail comes back from where it is.
  t = drive(b, 1, (s) => [0, z + 40 * s], 1 / 60, 0.5);
  assert.ok(b.trailOpacity(1) > 0.5, 'lit again');
  assert.ok(
    strip(b, 0).every((v) => v.a === 0 || v.z >= z - 1e-4),
    'its trail lies along the new path only',
  );
});

test('a held ball shows no trail, and an ended one frees its slot and leaves nothing drawn', () => {
  const b = new BallTrails(8, R);
  let t = drive(b, 1, upAt(40), 0, 0.5);
  assert.ok(b.trailOpacity(1) > 0.5, 'lit while it flies');
  // Held (on a flipper or in a saucer) at once, even moving as fast: no trail, but its glow stays.
  t = drive(b, 1, upAt(40), t + 1 / 60, t + 0.3, { held: true });
  assert.equal(b.trailOpacity(1), 0);
  assert.ok(
    strip(b, 0).every((v) => v.a === 0),
    'nothing of the trail drawn',
  );
  assert.ok(near(glow(b, 0).a, BALL_LOOK.glowOpacity, 1e-6), 'the glow is on while the ball is drawn');

  // Ended: its trail and glow are gone at once, and the slot is free for the next ball.
  t = drive(b, 1, upAt(40), t + 1 / 60, t + 0.5);
  assert.ok(b.trailOpacity(1) > 0.5);
  b.end(1);
  b.frame(t, t);
  assert.equal(b.trailOpacity(1), 0);
  assert.ok(
    strip(b, 0).every((v) => v.a === 0),
    'no trail',
  );
  assert.equal(glow(b, 0).a, 0, 'no glow');
  assert.ok(strip(b, 0).every((v) => v.y < -100) && glow(b, 0).y < -100, 'parked out of sight');

  // Eight balls take all eight slots; one ends and a new ball takes its slot; a ninth while all are taken is not drawn.
  for (let id = 10; id < 18; id++) b.show(id, id - 14, BALL_Y, 5, null, false, t);
  b.frame(t, t);
  for (let s = 0; s < 8; s++) assert.ok(near(glow(b, s).x, s - 4, 1e-6), `slot ${s} is ball ${s + 10}'s`);
  for (let id = 10; id < 18; id++) b.show(id, id - 14, BALL_Y, 5, null, false, t);
  b.show(99, 3.5, BALL_Y, 9, 0x3a7bff, false, t);
  b.frame(t, t);
  for (let s = 0; s < 8; s++) assert.ok(glow(b, s).z === 5, 'a ninth takes no slot');
  b.end(13);
  for (let id = 10; id < 18; id++) if (id !== 13) b.show(id, id - 14, BALL_Y, 5, null, false, t);
  b.show(99, 3.5, BALL_Y, 9, 0x3a7bff, false, t);
  b.frame(t, t);
  assert.ok(near(glow(b, 3).x, 3.5, 1e-6) && glow(b, 3).z === 9, "the new ball has ball 13's slot");

  // A ball that leaves without end() is gone the next frame, and its slot is free.
  b.show(99, 3.5, BALL_Y, 9, 0x3a7bff, false, t + 1 / 60);
  b.frame(t + 1 / 60, t + 1 / 60);
  for (let s = 0; s < 8; s++) if (s !== 3) assert.equal(glow(b, s).a, 0, `slot ${s} not shown: hidden`);
  b.show(50, 1, BALL_Y, 1, null, false, t + 2 / 60);
  b.frame(t + 2 / 60, t + 2 / 60);
  assert.ok(near(glow(b, 0).x, 1, 1e-6), 'and free for the next');
  assert.equal(b.trailOpacity(12345), 0, 'an unknown ball has no trail');

  // clear() (a hello, or the clock starting again) lets every ball go.
  b.clear();
  b.frame(0, t + 3 / 60);
  for (let s = 0; s < 8; s++) assert.equal(glow(b, s).a, 0);
  assert.equal(b.trailOpacity(50), 0);
});

test('a ball moved further than a jump in one frame draws no streak from where it was', () => {
  /** Whether everything of slot 0's trail that is drawn lies within `within` of (x, z). */
  const drawnNear = (b: BallTrails, x: number, z: number, within: number) =>
    strip(b, 0).every((v) => v.a === 0 || Math.hypot(v.x - x, v.z - z) <= within);

  // Flying fast up the left side, then put on the right in one frame (5 units, more than 4 diameters).
  const b = new BallTrails(8, R);
  let t = drive(b, 1, (t) => [-3, 2 + 40 * t], 0, 0.5);
  assert.ok(b.trailOpacity(1) > 0.5);
  t += 1 / 60;
  b.show(1, 2, BALL_Y, 2 + 40 * t, null, false, t);
  b.frame(t, t);
  assert.ok(drawnNear(b, 2, 2 + 40 * t, 2 * R), 'nothing drawn back to where it was');
  // Flying on from there, its trail starts at the new place.
  const from = t;
  drive(b, 1, (t) => [2, 2 + 40 * t], t + 1 / 60, t + 0.5);
  assert.ok(
    strip(b, 0).every((v) => v.a === 0 || (near(v.x, 2, R + 1e-5) && v.z >= 2 + 40 * from - 1e-4)),
    'a trail from the new place only',
  );

  // A move under 4 diameters is the ball flying: its trail spans it.
  const c = new BallTrails(8, R);
  t = drive(c, 1, (t) => [0, 2 + 40 * t], 0, 0.5);
  t += 1 / 60;
  c.show(1, 1.5, BALL_Y, 2 + 40 * t, null, false, t);
  c.frame(t, t);
  assert.ok(!drawnNear(c, 1.5, 2 + 40 * t, 1), 'the trail reaches back to where it was');

  // jump() (a save or an unstick) forgets the path whatever the move.
  const d = new BallTrails(8, R);
  t = drive(d, 1, (t) => [0, 2 + 40 * t], 0, 0.5);
  d.jump(1);
  t += 1 / 60;
  d.show(1, 1.5, BALL_Y, 2 + 40 * t, null, false, t);
  d.frame(t, t);
  assert.ok(drawnNear(d, 1.5, 2 + 40 * t, 2 * R), 'after jump() nothing back to where it was');
});

test('eight balls at once each have their own trail; the pools never grow and nothing is made per frame', () => {
  const b = new BallTrails(8, R);
  const { trails, glows } = meshes(b);
  assert.equal(b.group.children.length, 2, 'one mesh for the trails, one for the glows');
  for (const m of [trails, glows]) {
    const mat = m.material as THREE.MeshBasicMaterial;
    assert.equal(mat.blending, THREE.AdditiveBlending);
    assert.ok(mat.transparent && mat.vertexColors && !mat.depthWrite, 'additive, see-through, coloured by vertex, no depth');
    assert.equal(m.frustumCulled, false);
  }
  const made = [trails, glows].map((m) => {
    const g = m.geometry;
    return {
      mesh: m,
      g,
      position: g.attributes.position,
      color: g.attributes.color,
      arrays: [g.attributes.position.array, g.attributes.color.array, g.index!.array],
      sizes: [g.attributes.position.count, g.attributes.color.count, g.index!.count],
    };
  });
  assert.equal(made[0].sizes[0], 8 * 2 * BALL_LOOK.trailPoints, 'two vertices at each of 8 points, for 8 balls');
  assert.equal(made[1].sizes[0], 8 * (GLOW_SEGMENTS + 1), 'a fan for each of 8 balls');

  const colours = [0xff3a6e, 0x3a7bff, 0x4dff8a, 0xffe14d, 0xb04dff, 0x4dfff0, null, 0xff8a3a];
  // Eight balls, each up its own line at its own fast speed, and a ninth that is never drawn, for 3 s of frames.
  for (let k = 0; k < 180; k++) {
    const t = k / 60;
    for (let i = 0; i < 8; i++) b.show(i + 1, i - 3.5, BALL_Y, 1 + (38 + i) * (t % 0.3), colours[i], false, t);
    b.show(9, 4.5, BALL_Y, 5, null, false, t);
    b.frame(t, t);
    for (const m of made) {
      assert.equal(m.mesh.geometry, m.g);
      assert.equal(m.g.attributes.position, m.position);
      assert.equal(m.g.attributes.color, m.color);
      const now = [m.g.attributes.position.array, m.g.attributes.color.array, m.g.index!.array];
      for (let a = 0; a < 3; a++) assert.equal(now[a], m.arrays[a], 'the same arrays');
      assert.deepEqual([m.g.attributes.position.count, m.g.attributes.color.count, m.g.index!.count], m.sizes);
    }
  }
  for (let i = 0; i < 8; i++) {
    const s = strip(b, i);
    assert.ok(b.trailOpacity(i + 1) > 0, `ball ${i + 1} has a trail`);
    assert.ok(
      s.every((v) => v.a === 0 || near(v.x, i - 3.5, R + 1e-5)),
      `ball ${i + 1}'s trail is along its own line`,
    );
    assert.deepEqual([s[0].r, s[0].g, s[0].b], rgbOf(colours[i] ?? BALL_LOOK.houseColor), 'in its own colour');
  }
});

test('a trail never rises from dark to lit more than 3 times in any second, even for a ball rattling between bumpers', () => {
  // A ball rattling between two bumpers: fast one way (50 a second) for `fast` seconds and slow back (3) for `slow`,
  // over and over, so its speed swings across the trail's whole range. The rattles run from a turn every frame to ones
  // just long enough to light the trail and let it go dark again, some at random, and the worst a ball could do: one
  // that goes fast until its trail is lit and slow until it is dark, over and over (the most rises a second there can
  // be). For each, at each frame rate, the head's opacity (of the peak) is watched for rises as RiseLimit counts
  // them: going above LIT_ABOVE after being below DARK_BELOW.
  const rattles: [number, number][] = [];
  for (const each of [0, 0.01, 0.03, 0.05, 0.08, 0.12, 0.17, 0.25, 0.4]) rattles.push([each, each]);
  for (let fast = 0.06; fast <= 0.2; fast += 0.02) for (let slow = 0.16; slow <= 0.34; slow += 0.02) rattles.push([fast, slow]);
  let most = 0;
  for (const dt of [1 / 30, 1 / 60, 1 / 144, 1 / 180]) {
    for (const [fast, slow] of [...rattles, [-1, -1], [-2, -2]] as [number, number][]) {
      const b = new BallTrails(8, R);
      let x = 0;
      let out = true;
      let turnAt = 0;
      let dark = true;
      const rises: number[] = [];
      for (let k = 0; k * dt < 6; k++) {
        const t = k * dt;
        // At its turn it goes the other way; [-1, -1] turns after a random time up to a third of a second, and [-2, -2]
        // as its trail is lit or dark.
        if (fast === -2) out = dark;
        else if (t >= turnAt - 1e-9) {
          out = !out;
          turnAt = t + (fast < 0 ? Math.random() / 3 : out ? fast : slow);
        }
        // Out fast and back slow, so it drifts along between turns: what matters is how fast it goes.
        x += (out ? 50 : -3) * dt;
        b.show(1, x, BALL_Y, 6, null, false, t);
        b.frame(t, t);
        const o = b.trailOpacity(1) / BALL_LOOK.trailPeak;
        if (o < DARK_BELOW) dark = true;
        else if (dark && o > LIT_ABOVE) {
          dark = false;
          rises.push(t);
        }
      }
      for (let i = 0; i < rises.length; i++) {
        let n = 1;
        while (i + n < rises.length && rises[i + n] - rises[i] <= 1) n++;
        most = Math.max(most, n);
        const at = `at ${Math.round(1 / dt)} Hz, ${fast.toFixed(2)} s out and ${slow.toFixed(2)} s back`;
        assert.ok(n <= 3, `${at}: ${n} rises in the second from ${rises[i].toFixed(3)} s`);
      }
    }
  }
  assert.equal(most, 3, 'the worst rattle lights its trail 3 times in a second, and no more');
});

test('a page dropping frames never lights a trail more than 3 times in any real second: 30 Hz with frames dropped, 60 Hz with 40-60 ms hitches, at 33 to 60 units a second', () => {
  // A busy PC (OBS, other streams) drops frames: at 30 Hz one frame in `every` takes two frames' time, and at 60 Hz one
  // in `every` takes 40 to 60 ms. A ball in ordinary flight (33 to 60 units a second, the sim's top speed being 60)
  // then moves further in that frame than in the others, but no faster. The head's opacity as drawn (of the peak) is
  // watched for rises as RiseLimit counts them, on the real clock, which here is the frames' own time; and again with
  // the drawn clock 1.5 times as fast as the real one, as the city's dt can be.
  const patterns: { label: string; frame: (k: number) => number }[] = [];
  for (const every of [2, 3, 4, 5, 6, 7, 9, 12]) {
    patterns.push({ label: `30 Hz, 1 in ${every} dropped`, frame: (k) => (k % every === every - 1 ? 2 / 30 : 1 / 30) });
  }
  for (const hitch of [0.04, 0.05, 0.06]) {
    for (const every of [6, 8, 10, 12, 14, 16, 20]) {
      patterns.push({ label: `60 Hz, a ${hitch * 1000} ms hitch every ${every}`, frame: (k) => (k % every === every - 1 ? hitch : 1 / 60) });
    }
  }
  let worst = 0;
  let worstAt = '';
  for (const fast of [1, 1.5]) {
    for (const { label, frame } of patterns) {
      for (let speed = 33; speed <= 60; speed++) {
        const b = new BallTrails(8, R);
        let real = 0;
        let z = 2;
        const levels: number[] = [];
        const times: number[] = [];
        for (let k = 0; real < 3; k++) {
          const dt = frame(k);
          real += dt;
          z += speed * fast * dt;
          b.show(1, 0, BALL_Y, z, null, false, real * fast);
          b.frame(real * fast, real);
          levels.push(share(strip(b, 0)[0].a, BALL_LOOK.trailPeak));
          times.push(real);
        }
        const n = mostInASecond(riseTimes(levels, times));
        if (n > worst) {
          worst = n;
          worstAt = `${label} at ${speed} units a second${fast > 1 ? ', drawn 1.5 times as fast' : ''}`;
        }
      }
    }
  }
  assert.ok(worst <= 3, `${worst} rises in a real second (${worstAt})`);
});

test('the RiseLimits hold a trail and a glow to 3 rises in a real second whatever starts them again: jumps, a held ball let go, new ids, and a ball not drawn for a frame', () => {
  // Each of these starts a trail from dark at once, which its easing alone would let light again within 0.17 s: every
  // `gap` a ball fast enough to light its trail is put somewhere, held for a frame, drained as a new ball takes its
  // place, or missed for a frame (its place freed, its glow gone). The trail's and the glow's drawn opacities are
  // watched for rises on the real clock.
  type Restart = 'jump' | 'held' | 'new id' | 'missed';
  let worst = 0;
  let worstAt = '';
  for (const restart of ['jump', 'held', 'new id', 'missed'] as Restart[]) {
    for (const gap of [0.18, 0.2, 0.25, 0.3]) {
      const b = new BallTrails(8, R);
      let id = 1;
      let z = 2;
      let next = gap;
      const trail: number[] = [];
      const glows: number[] = [];
      const times: number[] = [];
      for (let k = 0; k * (1 / 60) < 3; k++) {
        const t = k / 60;
        let held = false;
        let skip = false;
        if (t >= next - 1e-9) {
          next += gap;
          if (restart === 'jump') z += 10;
          else if (restart === 'held') held = true;
          else if (restart === 'new id') id++;
          else skip = true;
        }
        z += 50 / 60;
        if (!skip) b.show(id, 0, BALL_Y, z, null, held, t);
        b.frame(t, t);
        trail.push(share(strip(b, 0)[0].a, BALL_LOOK.trailPeak));
        glows.push(share(glow(b, 0).a, BALL_LOOK.glowOpacity));
        times.push(t);
      }
      for (const [what, levels] of [
        ['trail', trail],
        ['glow', glows],
      ] as const) {
        const n = mostInASecond(riseTimes(levels, times));
        if (n > worst) {
          worst = n;
          worstAt = `the ${what}, ${restart} every ${gap} s`;
        }
      }
    }
  }
  assert.ok(worst <= 3, `${worst} rises in a real second (${worstAt})`);
  assert.equal(worst, 3, 'they still rise as often as the rule allows');
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
