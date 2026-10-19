// Tests the light shows (stage/light-show.ts) as numbers: that a sweep, a burst, a chase and a strobe light the lamps
// they should, in the order they should, and that each one ends; that the player mixes the shows running by the
// brightest light on a lamp, lets go of a show once it is over and makes nothing per frame; and that nothing flashes
// more than 3 times a second (FLASH_GAP): not a show alone, and not a light that is asked to flash faster, which
// RiseLimit holds. No three.js is needed.
// Usage: npm run light-show-test
import assert from 'node:assert/strict';
import {
  burst,
  chase,
  DARK_BELOW,
  FLASH_GAP,
  LIT_ABOVE,
  LightShowPlayer,
  RiseLimit,
  strobe,
  sweep,
  type LampLight,
  type Show,
  type ShowLamp,
} from '../src/stage/light-show';

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** A light is looked at every 1/240 s, finer than any frame the stage draws, so no rise slips between two looks. */
const DT = 1 / 240;
const RED = 0xff3344;
const BLUE = 0x4a7dff;
const GOLD = 0xffc23a;
const WHITE = 0xffffff;

const lamp = (x: number, z: number): ShowLamp => ({ x, z, color: 0xffa030 });

/** A ring like the frame's rail lights: up the left column from the bottom, then down the right column from the top. */
function railRing(): ShowLamp[] {
  const ring: ShowLamp[] = [];
  for (let k = 0; k < 16; k++) ring.push(lamp(-5.23, 0.92 + 1.05 * k));
  for (let k = 15; k >= 0; k--) ring.push(lamp(5.23, 0.92 + 1.05 * k));
  return ring;
}
const ring = railRing();
/** Lamps in the middle of the table as well, for the shows that light every lamp. */
const inner = [lamp(-2, 3), lamp(0, 6.5), lamp(2.5, 9), lamp(-1, 12), lamp(1.5, 15)];
const all = [...ring, ...inner];

/** One of each shape over those lamps (the chase round the ring), each lasting a second or more. */
function shapes(): [string, Show][] {
  return [
    ['sweep', sweep(all, { from: 0, to: 16.7, color: GOLD, seconds: 1 })],
    ['burst', burst(all, { x: 0, z: 8, reach: 10, color: GOLD, seconds: 1.1 })],
    ['chase', chase(ring, { color: GOLD, laps: 2, lapSeconds: 0.9 })],
    ['strobe', strobe(all, { color: GOLD, times: 3, rate: 2.5 })],
  ];
}

/** What a show lit a lamp with, kept: the light a show or the player returns is filled in again by the next call. */
const keep = (light: LampLight | null): LampLight | null => (light ? { ...light } : null);

/** A lamp's level under a show at each look from its start to a little past its end (0 where it is left dark). */
function levels(show: Show, l: ShowLamp): number[] {
  const seen: number[] = [];
  for (let i = 0; i * DT < show.seconds + 0.25; i++) seen.push(show.light(l, i * DT)?.level ?? 0);
  return seen;
}

/**
 * When a light rises, from its levels looked at `dt` apart: going above LIT_ABOVE after being below DARK_BELOW. A light
 * starts out dark, so one that is lit at its first look rises then.
 */
function riseTimes(seen: number[], dt: number): number[] {
  const at: number[] = [];
  let dark = true;
  seen.forEach((level, i) => {
    if (level < DARK_BELOW) dark = true;
    else if (dark && level > LIT_ABOVE) {
      dark = false;
      at.push(i * dt);
    }
  });
  return at;
}

/** The most rises in any 1 s window. */
function rises(seen: number[], dt: number): number {
  const at = riseTimes(seen, dt);
  let most = 0;
  for (let a = 0, b = 0; b < at.length; b++) {
    while (at[b] - at[a] >= 1) a++;
    most = Math.max(most, b - a + 1);
  }
  return most;
}

/** A light is `want` (null: no light), to within rounding. */
function assertLight(got: LampLight | null, want: LampLight | null, what: string): void {
  if (want === null) {
    assert.equal(got, null, `${what}: not lit`);
    return;
  }
  assert.ok(got, `${what}: lit`);
  assert.ok(Math.abs(got.level - want.level) < 1e-9, `${what}: level ${got.level}, not ${want.level}`);
  assert.equal(got.color, want.color, `${what}: colour`);
}

test('every show ends: past its seconds it lights nothing, and the player lets it go', () => {
  for (const [name, show] of shapes()) {
    assert.ok(show.seconds > 0, `${name} lasts`);
    let peak = 0;
    for (let i = 0; i * DT < show.seconds; i++) {
      for (const l of all) peak = Math.max(peak, show.light(l, i * DT)?.level ?? 0);
    }
    assert.ok(peak > 0.9, `${name} lights a lamp while it runs`);
    for (const tau of [show.seconds, show.seconds + DT, show.seconds + 0.5, show.seconds + 100]) {
      for (const l of all) assert.equal(show.light(l, tau), null, `${name} lights nothing ${tau} s in`);
    }

    const player = new LightShowPlayer(all);
    player.play(show, 0);
    assert.equal(player.running, 1, `${name} is running`);
    player.lights(show.seconds - 0.01);
    assert.equal(player.running, 1, `${name} is held till its end`);
    assert.ok(player.lights(show.seconds).every((x) => x === null), `${name} lights nothing as it ends`);
    assert.equal(player.running, 0, `${name} is let go`);
    // Played later on the clock, it ends that long after its own start.
    player.play(show, 7);
    player.lights(7 + show.seconds - 0.01);
    assert.equal(player.running, 1, `${name}, played at 7, is held till its end`);
    assert.ok(player.lights(7 + show.seconds + 0.01).every((x) => x === null), `${name}, played at 7, ends`);
    assert.equal(player.running, 0, `${name}, played at 7, is let go`);
  }
});

test('a sweep lights each lamp once, in order up the table', () => {
  // Out of order in the list and from side to side, so that the order is the sweep's own.
  const lamps = [9, 2, 14, 5, 11.5, 0.5, 15.2, 7.3].map((z, i) => lamp(i % 2 ? -3 : 3, z));
  const show = sweep(lamps, { from: 0, to: 16, color: GOLD, seconds: 2 });
  assert.equal(show.seconds, 2);
  // The line climbs 8 a second, so it is at a lamp z / 8 seconds in.
  const passed = lamps
    .map((l) => {
      const seen = levels(show, l);
      assert.equal(riseTimes(seen, DT).length, 1, `z ${l.z} lights once`);
      const at = seen.indexOf(Math.max(...seen)) * DT;
      assert.ok(Math.abs(at - l.z / 8) <= 2 * DT, `z ${l.z} is brightest as the line passes it, not at ${at}`);
      return { z: l.z, at };
    })
    .sort((a, b) => a.z - b.z);
  for (let i = 1; i < passed.length; i++) {
    assert.ok(passed[i].at > passed[i - 1].at, `z ${passed[i].z} is lit after z ${passed[i - 1].z}`);
  }
  // The light itself, with the line at 8 a second in: 1 - |z - line| / 1.5 in the sweep's colour, and none 1.5 or more
  // away.
  const want = [1 - 1 / 1.5, null, null, null, null, null, null, 1 - 0.7 / 1.5];
  lamps.forEach((l, i) => {
    const level = want[i];
    assertLight(keep(show.light(l, 1)), level === null ? null : { level, color: GOLD }, `z ${l.z}, 1 s in`);
  });
});

test('a burst lights the nearest lamps first, out to its reach and no further', () => {
  const [x0, z0, reach] = [0, 8, 6];
  const lampAt = (d: number, bearing: number) => lamp(x0 + d * Math.cos(bearing), z0 + d * Math.sin(bearing));
  const dist = (l: ShowLamp) => Math.hypot(l.x - x0, l.z - z0);
  const within = [0.4, 1.3, 2.2, 2.7, 3.1, 3.5, 4.4, 5.5, 5.95].map((d, k) => lampAt(d, 1 + 1.3 * k));
  // Past the reach by less than the ring's half width (0.6) too: the ring alone would catch these at its end.
  const beyond = [6.3, 6.55, 7.5, 8].map((d, k) => lampAt(d, 0.5 + 1.7 * k));
  const show = burst([...beyond, ...within], { x: x0, z: z0, reach, color: RED, seconds: 1.5 });
  assert.equal(show.seconds, 1.5);
  // The ring grows 4 a second, so it is at a lamp d from the middle d / 4 seconds in.
  const brightest = within.map((l) => {
    const seen = levels(show, l);
    assert.equal(riseTimes(seen, DT).length, 1, `${dist(l).toFixed(2)} out lights once`);
    const at = seen.indexOf(Math.max(...seen)) * DT;
    assert.ok(Math.abs(at - dist(l) / 4) <= 2 * DT, `${dist(l).toFixed(2)} out is brightest as the ring passes it`);
    return at;
  });
  for (let i = 1; i < brightest.length; i++) assert.ok(brightest[i] > brightest[i - 1], 'the nearer lamp comes first');
  for (const l of beyond) {
    assert.ok(levels(show, l).every((level) => level === 0), `${dist(l).toFixed(2)} out is past the reach: never lit`);
  }
  // The light itself, with the ring 3 out at 0.75 s: 1 - |d - 3| / 0.6 in the burst's colour, and none 0.6 or more
  // away.
  for (const l of within) {
    const level = 1 - Math.abs(dist(l) - 3) / 0.6;
    const what = `${dist(l).toFixed(2)} out, the ring at 3`;
    assertLight(keep(show.light(l, 0.75)), level > 0 ? { level, color: RED } : null, what);
  }
});

test('a chase runs round the ring in its order, each lamp once a lap; a lap asked shorter than FLASH_GAP takes FLASH_GAP', () => {
  const n = ring.length;
  const show = chase(ring, { color: BLUE, laps: 3, lapSeconds: 1 });
  assert.equal(show.seconds, 3);
  // The head is at lamp i of lap k at k + i / n seconds: each lamp lights as it passes, and again a lap later.
  const lit = ring.map((l, i) => {
    const at = riseTimes(levels(show, l), DT);
    assert.equal(at.length, 3, `lamp ${i} lights once a lap`);
    at.forEach((time, lap) => {
      assert.ok(Math.abs(time - (lap + i / n)) <= 2 * DT, `lamp ${i}, lap ${lap}, lights at ${time}`);
    });
    return at[0];
  });
  for (let i = 1; i < n; i++) assert.ok(lit[i] > lit[i - 1], `lamp ${i} is lit after lamp ${i - 1}`);

  // Lit as the head passes and fading over the 5 lamps behind it, with nothing ahead of it.
  const trail = (tau: number) => ring.map((l) => keep(show.light(l, tau)));
  const head10 = trail(10 / n);
  const wantHead10 = new Map([[10, 1], [9, 0.8], [8, 0.6], [7, 0.4], [6, 0.2]]);
  head10.forEach((light, i) => {
    const level = wantHead10.get(i);
    assertLight(light, level === undefined ? null : { level, color: BLUE }, `lamp ${i}, head at 10`);
  });
  // The tail wraps round the ring into the lap before, but not before there was one.
  const wantLap1 = new Map([[2, 1], [1, 0.8], [0, 0.6], [31, 0.4], [30, 0.2]]);
  trail(1 + 2 / n).forEach((light, i) => {
    const level = wantLap1.get(i);
    assertLight(light, level === undefined ? null : { level, color: BLUE }, `lamp ${i}, head at 2 in lap 1`);
  });
  const wantStart = new Map([[2, 1], [1, 0.8], [0, 0.6]]);
  trail(2 / n).forEach((light, i) => {
    const level = wantStart.get(i);
    assertLight(light, level === undefined ? null : { level, color: BLUE }, `lamp ${i}, head at 2 in lap 0`);
  });

  // A lap asked for in less than FLASH_GAP takes FLASH_GAP, so a lamp lights no more than 3 times a second.
  const quick = chase(ring, { color: BLUE, laps: 4, lapSeconds: 0.1 });
  assert.equal(quick.seconds, 4 * FLASH_GAP);
  for (const l of ring) {
    const seen = levels(quick, l);
    assert.equal(riseTimes(seen, DT).length, 4, 'once a lap');
    assert.ok(rises(seen, DT) <= 3, `${rises(seen, DT)} rises in a second`);
  }
  riseTimes(levels(quick, ring[0]), DT).forEach((time, lap) => {
    assert.ok(Math.abs(time - lap * FLASH_GAP) <= 2 * DT, `lap ${lap} of the quick chase starts at ${time}`);
  });
  // A lap of FLASH_GAP, or more, is as asked.
  assert.equal(chase(ring, { color: BLUE, laps: 2, lapSeconds: FLASH_GAP }).seconds, 2 * FLASH_GAP);
  assert.equal(chase(ring, { color: BLUE, laps: 2, lapSeconds: 0.9 }).seconds, 2 * 0.9);
});

test('a strobe flashes its lamps together, its times, at most 1 / FLASH_GAP a second', () => {
  const lamps = [lamp(-2, 3), lamp(0, 6.5), lamp(2.5, 9), lamp(-1, 12)];
  const slow = strobe(lamps, { color: WHITE, times: 4, rate: 2.5 });
  assert.ok(Math.abs(slow.seconds - 1.6) < 1e-9, 'four flashes at 2.5 a second take 1.6 s');
  // On for the first half of each 0.4 s, dark for the second, every lamp at once and at full.
  for (const tau of [0.1, 0.5, 0.9, 1.3]) {
    for (const l of lamps) assertLight(keep(slow.light(l, tau)), { level: 1, color: WHITE }, `on at ${tau}`);
  }
  for (const tau of [0.3, 0.7, 1.1, 1.5]) {
    for (const l of lamps) assert.equal(slow.light(l, tau), null, `dark at ${tau}`);
  }
  for (const l of lamps) {
    const at = riseTimes(levels(slow, l), DT);
    assert.equal(at.length, 4, 'flashes its times');
    at.forEach((time, k) => assert.ok(Math.abs(time - 0.4 * k) <= 2 * DT, `flash ${k} starts at ${time}`));
  }
  // Asked for faster than 1 / FLASH_GAP a second, it flashes at that.
  const fast = strobe(lamps, { color: WHITE, times: 6, rate: 10 });
  assert.equal(fast.seconds, 6 * FLASH_GAP);
  for (const l of lamps) {
    const seen = levels(fast, l);
    assert.equal(riseTimes(seen, DT).length, 6, 'still flashes its times');
    assert.ok(rises(seen, DT) <= 3, `${rises(seen, DT)} rises in a second`);
  }
  // Slower than that, it is as asked.
  assert.ok(Math.abs(strobe(lamps, { color: WHITE, times: 3, rate: 2.9 }).seconds - 3 / 2.9) < 1e-9);
});

test('where shows overlap the brightest wins, with its colour; a lamp no show lights is null', () => {
  const a = lamp(0, 5); // the sweep's alone, on its line
  const b = lamp(6, 8); // the burst's alone, on its ring
  const c = lamp(0, 6); // the sweep's alone, at the line's edge
  const d = lamp(4.8, 3.6); // both shows', at the far edge of the line and of the ring: the ring is a little brighter
  const e = lamp(0, 2); // the sweep's, which doesn't reach it; the ring is on it, but it isn't the burst's
  const f = lamp(5, 5); // both shows', on the line and near the middle of the ring: the line is brighter
  const quiet = lamp(-2, 15); // in both shows, and lit by neither just now
  const outsider = lamp(0, 5); // just where the line is, but in neither show
  const lamps = [a, b, c, d, e, f, quiet, outsider];
  // At 0.5 s the line is at z 5 and the ring is 6 out from (0, 8).
  const line = sweep([a, c, d, e, f, quiet], { from: 0, to: 10, color: RED, seconds: 1 });
  const wave = burst([b, d, f, quiet], { x: 0, z: 8, reach: 12, color: BLUE, seconds: 1 });
  const wantLit: (LampLight | null)[] = [
    { level: 1, color: RED },
    { level: 1, color: BLUE },
    { level: 1 - 1 / 1.5, color: RED },
    { level: 1 - Math.abs(Math.hypot(4.8, 4.4) - 6) / 0.6, color: BLUE },
    null,
    { level: 1, color: RED },
    null,
    null,
  ];
  // Both shows light d and f, so these two are only as good as their levels: the ring's on d, the line's on f.
  assert.ok(wantLit[3]!.level > 1 - 1.4 / 1.5, 'the ring is brighter than the line on d');
  assert.ok(wantLit[5]!.level > 1 - Math.abs(Math.hypot(5, 3) - 6) / 0.6, 'the line is brighter than the ring on f');
  // Whichever was played first.
  for (const order of [[line, wave], [wave, line]]) {
    const player = new LightShowPlayer(lamps);
    for (const show of order) player.play(show, 0);
    const got = player.lights(0.5).map(keep);
    wantLit.forEach((want, i) => assertLight(got[i], want, `lamp ${i}`));
  }
});

test('the same show played twice at once mixes as two shows; on a tie the show played first keeps the lamp', () => {
  const lamps = [lamp(0, 3), lamp(0, 5.5), lamp(0, 8)];
  const show = sweep(lamps, { from: 0, to: 10, color: GOLD, seconds: 2 });
  const player = new LightShowPlayer(lamps);
  player.play(show, 0);
  player.play(show, 0.4);
  // 1.2 s in, one line is at z 6 and the other, 0.4 s behind it, at z 4. The show lights with one light of its own, so
  // a lamp the first line lights must be read before the second line is asked about it.
  const got = player.lights(1.2).map(keep);
  assertLight(got[0], { level: 1 - 1 / 1.5, color: GOLD }, 'z 3: only the line behind');
  assertLight(got[1], { level: 1 - 0.5 / 1.5, color: GOLD }, 'z 5.5: only the line ahead');
  assertLight(got[2], null, 'z 8: neither');

  // Two shows alike at a lamp: the one played first keeps it, whatever its colour.
  for (const [first, second] of [[RED, BLUE], [BLUE, RED]]) {
    const tied = new LightShowPlayer(lamps);
    tied.play(sweep(lamps, { from: 0, to: 10, color: first, seconds: 2 }), 0);
    tied.play(sweep(lamps, { from: 0, to: 10, color: second, seconds: 2 }), 0);
    assert.equal(tied.lights(1.2)[1]?.color, first);
  }
});

test('lights() refills one array and one light for each lamp, so that nothing is made per frame', () => {
  const lamps = [lamp(0, 2), lamp(0, 8)];
  const player = new LightShowPlayer(lamps);
  player.play(sweep(lamps, { from: 0, to: 4, color: RED, seconds: 2 }), 0);
  const first = player.lights(1); // the line at 2
  const light = first[0];
  assert.ok(light, 'z 2 is lit');
  assertLight(keep(light), { level: 1, color: RED }, 'z 2, the line at 2');
  assert.equal(first[1], null, 'z 8 is not');
  const second = player.lights(1.5); // the line at 3
  assert.equal(second, first, 'the same array');
  assert.equal(second[0], light, 'the same light');
  assertLight(keep(light), { level: 1 - 1 / 1.5, color: RED }, 'z 2, the line at 3: filled in again');
  // Dark between two shows, and lit by the next: still that light.
  assert.equal(player.lights(1.9)[0], null);
  player.play(strobe([lamps[0]], { color: BLUE, times: 2, rate: 2.5 }), 2);
  const third = player.lights(2.1);
  assert.equal(third, first);
  assert.equal(third[0], light, 'the same light again');
  assertLight(keep(light), { level: 1, color: BLUE }, 'z 2, the strobe');
});

test('a show with no lamps, no ring or no time lights nothing and ends; a player with no lamps lights nothing', () => {
  const none: ShowLamp[] = [];
  const bare: [string, Show][] = [
    ['sweep', sweep(none, { from: 0, to: 16, color: GOLD, seconds: 1 })],
    ['burst', burst(none, { x: 0, z: 8, reach: 6, color: GOLD, seconds: 1 })],
    ['chase', chase(none, { color: GOLD, laps: 2, lapSeconds: 0.9 })],
    ['strobe', strobe(none, { color: GOLD, times: 2, rate: 2.5 })],
  ];
  const brief: [string, Show][] = [
    ['sweep of no seconds', sweep(all, { from: 0, to: 16, color: GOLD, seconds: 0 })],
    ['burst of no seconds', burst(all, { x: 0, z: 8, reach: 6, color: GOLD, seconds: 0 })],
    ['chase of no laps', chase(ring, { color: GOLD, laps: 0, lapSeconds: 0.9 })],
    ['strobe of no flashes', strobe(all, { color: GOLD, times: 0, rate: 2.5 })],
  ];
  const player = new LightShowPlayer(all);
  for (const [name, show] of [...bare, ...brief]) {
    assert.ok(Number.isFinite(show.seconds), `${name} ends`);
    for (let i = 0; i * 0.05 < show.seconds + 0.5; i++) {
      for (const l of all) assert.equal(show.light(l, i * 0.05), null, `${name} lights nothing`);
    }
    player.play(show, 0);
  }
  assert.equal(player.running, 8);
  assert.ok(player.lights(0.5).every((x) => x === null));
  player.lights(10);
  assert.equal(player.running, 0);

  const empty = new LightShowPlayer([]);
  empty.play(sweep(all, { from: 0, to: 16.7, color: GOLD, seconds: 1 }), 0);
  assert.deepEqual(empty.lights(0.5), []);
  empty.lights(5);
  assert.equal(empty.running, 0);
});

test('a show started in the past runs from where it would be; one already over never lights', () => {
  const lamps = [lamp(0, 2), lamp(1, 5), lamp(-1, 8), lamp(0, 11), lamp(2, 14)];
  const show = sweep(lamps, { from: 0, to: 16, color: GOLD, seconds: 2 });
  // Asked first 0.5 s, 1 s or 1.75 s in, it is that far in: what the show gives at that time since its start.
  for (const tau of [0.5, 1, 1.75]) {
    const player = new LightShowPlayer(lamps);
    player.play(show, 10);
    const seen = player.lights(10 + tau).map(keep);
    assert.ok(seen.some((x) => x !== null), `it lights something ${tau} s in`);
    lamps.forEach((l, i) => assert.deepEqual(seen[i], keep(show.light(l, tau)), `z ${l.z}, ${tau} s in`));
  }
  // One already over never lights, however long ago it began.
  const over = new LightShowPlayer(lamps);
  over.play(show, 10);
  assert.ok(over.lights(10 + show.seconds + 0.5).every((x) => x === null));
  assert.equal(over.running, 0);
  over.play(show, -50);
  assert.ok(over.lights(0).every((x) => x === null));
  assert.equal(over.running, 0);
  // One that has not begun yet lights nothing until its time, and then begins at its start.
  const soon = new LightShowPlayer(lamps);
  soon.play(show, 20);
  assert.ok(soon.lights(19.9).every((x) => x === null));
  assert.equal(soon.running, 1, 'it waits for its time');
  const begun = soon.lights(20.25).map(keep);
  assertLight(begun[0], { level: 1, color: GOLD }, 'z 2 as the line reaches it, 0.25 s in');
  assert.equal(soon.running, 1);
  // A show lights nothing before its start either, asked of it direct...
  for (const [name, show] of shapes()) {
    for (const l of all) assert.equal(show.light(l, -DT), null, `${name} before it begins`);
  }
  // ...and the player doesn't ask a show before its start, whatever the show would say.
  const eager: Show = { seconds: 1, light: (_lamp, tau) => (tau < 0 ? { level: 1, color: RED } : null) };
  const early = new LightShowPlayer(lamps);
  early.play(eager, 20);
  assert.ok(early.lights(19.5).every((x) => x === null));
});

test('RiseLimit: a light asked to rise 10 times a second rises at most 3 times in any second; one that stays lit is never held; reset forgets', () => {
  const steps = Math.round(5 / DT);
  const t = (i: number) => i * DT;
  // Asked for ten times a second: on for the first half of each tenth.
  const asked = Array.from({ length: steps }, (_, i) => ((t(i) * 10) % 1 < 0.5 ? 1 : 0));
  assert.ok(rises(asked, DT) >= 10, 'asked 10 times a second');
  const limit = new RiseLimit();
  const given = asked.map((raw, i) => limit.level(raw, t(i)));
  assert.ok(rises(given, DT) <= 3, `${rises(given, DT)} rises in a second`);
  const at = riseTimes(given, DT);
  assert.ok(at.length >= 12, `it still flashes, steadily (${at.length} rises in 5 s)`);
  for (let k = 1; k < at.length; k++) {
    assert.ok(at[k] - at[k - 1] >= FLASH_GAP, `rise ${k} comes ${at[k] - at[k - 1]} s after the last`);
  }
  assert.equal(given[0], 1, 'the first rise goes through at once');

  // A light that stays lit is never held: asked 1 and 0.3 ten times a second, it gets exactly that...
  const wobble = asked.map((raw) => (raw ? 1 : 0.3));
  const lit = new RiseLimit();
  assert.deepEqual(wobble.map((raw, i) => lit.level(raw, t(i))), wobble);
  // ...and so is a light between LIT_ABOVE and DARK_BELOW, which is neither lit above nor dark below.
  const blink = Array.from({ length: steps }, (_, i) => ((t(i) * 2) % 1 < 0.5 ? LIT_ABOVE : DARK_BELOW));
  const blinker = new RiseLimit();
  assert.deepEqual(blink.map((raw, i) => blinker.level(raw, t(i))), blink);

  // Held after a rise and a dark spell: at min(raw, DARK_BELOW), until FLASH_GAP after the rise.
  const held = new RiseLimit();
  assert.equal(held.level(1, 0), 1, 'rises');
  assert.equal(held.level(0.1, 0.05), 0.1, 'gone dark');
  assert.equal(held.level(0.3, 0.1), DARK_BELOW, 'asked for 0.3 too soon');
  assert.equal(held.level(1, 0.2), DARK_BELOW, 'asked for 1 too soon');
  assert.equal(held.level(1, FLASH_GAP - 0.001), DARK_BELOW, 'still held a moment before the gap is out');
  held.reset();
  assert.equal(held.level(1, 0.2), 1, 'reset forgets the rise: it rises at once');
  assert.equal(held.level(0, 0.25), 0);
  assert.equal(held.level(1, 0.3), DARK_BELOW, 'and remembers the new one');
  const free = new RiseLimit();
  free.level(1, 0);
  free.level(0, 0.1);
  assert.equal(free.level(1, FLASH_GAP), 1, 'FLASH_GAP after the rise it is let up');

  // Lit is above LIT_ABOVE and dark is below DARK_BELOW, not at them: a light at either has not risen, or gone dark.
  const edge = new RiseLimit();
  assert.equal(edge.level(LIT_ABOVE, 0), LIT_ABOVE);
  assert.equal(edge.level(0, 0.05), 0);
  assert.equal(edge.level(1, 0.1), 1, 'at LIT_ABOVE it had not risen, so this is its first rise');
  assert.equal(edge.level(DARK_BELOW, 0.15), DARK_BELOW);
  assert.equal(edge.level(1, 0.2), 1, 'at DARK_BELOW it had not gone dark, so it is not held');

  // A clock that isn't a number holds the light, so the limit fails closed: it never lets a dark light up then.
  assert.equal(new RiseLimit().level(1, NaN), DARK_BELOW, 'a dark light asked up at a time that is no time is held');
});

test('clear() lets every show go', () => {
  const player = new LightShowPlayer(all);
  for (const [, show] of shapes()) player.play(show, 0);
  player.play(sweep(all, { from: 0, to: 16.7, color: GOLD, seconds: 1 }), 50);
  assert.equal(player.running, 5);
  assert.ok(player.lights(0.3).some((x) => x !== null), 'they light the lamps');
  player.clear();
  assert.equal(player.running, 0);
  assert.ok(player.lights(0.3).every((x) => x === null));
  assert.ok(player.lights(50.25).every((x) => x === null), 'the one that had not begun is gone too');
  // And it plays on afterwards.
  player.play(strobe(all, { color: WHITE, times: 2, rate: 2.5 }), 60);
  assert.equal(player.running, 1);
  assert.ok(player.lights(60.1).every((x) => x !== null && x.level === 1 && x.color === WHITE));
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
