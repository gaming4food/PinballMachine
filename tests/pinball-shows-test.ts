// Tests the show book (PinballShows, stage/pinball-shows.ts): that each moment on the table plays the light show,
// screen flash, sparks and shake the book gives it (a bank matched, multiball, the ball saver, double score, a nudge, a
// payout, and the toys' hits: a pop-up knocked down, the mummy's hits and its third, the tomb's catch), in its god's
// colour where it has one; that a part or an id with no row does nothing; that a moment plays at its time and not
// before, that one drawn more than 2 s late is let go, and that the table's clock starting again clears what plays and
// lets go of the moments queued on the old clock, keeping those already on the new one; that DrawnClock steps by the
// drawn time under a cap and never goes back; and that every show the book plays ends and, played alone over the
// table's lamps, rises no lamp more than 3 times in any second. No page or graphics card is needed.
// Usage: npm run pinball-shows-test
import assert from 'node:assert/strict';
import type { PinballCueMsg, PinballHypeMsg } from '../src/shared/pinball';
import { TABLE_IN_USE, type Table } from '../src/shared/table';
import { burst, chase, DARK_BELOW, LIT_ABOVE, LightShowPlayer, strobe, sweep, type LampLight, type Show } from '../src/stage/light-show';
// The show book is numbers only, so it loads with no stubs.
import { DrawnClock, GOD_COLOR, PinballShows, type ShowSinks } from '../src/stage/pinball-shows';
// The stage's code loads in Node with its CSS and pictures stubbed (stub-assets.ts).
import './stub-assets';

const { TableParts } = await import('../src/stage/pinball-parts');

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const WHITE = 0xffffff;
/** The table's lamps as the stage lights them: all of them, the frame's ring and double score's ladders. */
const lamps = new TableParts(TABLE_IN_USE).lamps;

/** A show is compared every 1/60 s; a light is looked at every 1/240 s, finer than any frame the stage draws. */
const LOOK = 1 / 60;
const DT = 1 / 240;

/** What a call to the sinks was, kept in the order made. */
type PlayCall = { kind: 'play'; show: Show; at: number };
type SparksCall = { kind: 'sparks'; x: number; y: number; z: number; color: number; count: number };
type FlashCall = { kind: 'flash'; color: number; strength: number; at: number };
type ShakeCall = { kind: 'shake'; seconds: number };
type ClearCall = { kind: 'clear' };
type Call = PlayCall | SparksCall | FlashCall | ShakeCall | ClearCall;

/** A show book over the table (the table in use unless another is given) with sinks that record each call they get. */
function book(table: Table = TABLE_IN_USE) {
  const calls: Call[] = [];
  const sinks: ShowSinks = {
    play: (show, at) => calls.push({ kind: 'play', show, at }),
    sparks: (x, y, z, color, count) => calls.push({ kind: 'sparks', x, y, z, color, count }),
    flash: (color, strength, at) => calls.push({ kind: 'flash', color, strength, at }),
    shake: (seconds) => calls.push({ kind: 'shake', seconds }),
    clear: () => calls.push({ kind: 'clear' }),
  };
  const shows = new PinballShows(table, lamps, sinks);
  /** The calls of one kind, in order. */
  const kind = <K extends Call['kind']>(k: K) => calls.filter((c): c is Extract<Call, { kind: K }> => c.kind === k);
  return { shows, calls, kind };
}

const hype = (id: string, at: number): PinballHypeMsg => ({ kind: 'pinballHype', id, at });
const cue = (part: string, down: boolean, x: number, z: number, at: number): PinballCueMsg => ({ kind: 'pinballCue', cue: 'toyHit', part, down, x, z, at });
const target = (id: string) => TABLE_IN_USE.targets.find((t) => t.id === id)!;
const middleOf = (points: { x: number; z: number }[]) => ({ x: points.reduce((s, p) => s + p.x, 0) / points.length, z: points.reduce((s, p) => s + p.z, 0) / points.length });

/** What a show lit a lamp with, kept: the light a show or the player returns is filled in again by the next call. */
const keep = (light: LampLight | null): LampLight | null => (light ? { ...light } : null);

/** A light is `want` (null: no light), to within rounding. */
function assertLight(got: LampLight | null, want: LampLight | null, what: string): void {
  if (want === null) {
    assert.equal(got, null, `${what}: not lit`);
    return;
  }
  assert.ok(got, `${what}: lit`);
  assert.ok(near(got.level, want.level), `${what}: level ${got.level}, not ${want.level}`);
  assert.equal(got.color, want.color, `${what}: colour`);
}

/**
 * `got` is the show `want`, over the table's lamps: it lasts as long, and it gives every lamp the same light at every
 * look from before its start to past its end. A test builds `want` from the numbers the book is specified with (the
 * plan's table of moments), so a different centre, reach, length, colour or set of lamps shows up as a different light
 * somewhere.
 */
function assertSameShow(got: Show, want: Show, what: string): void {
  assert.ok(near(got.seconds, want.seconds), `${what}: lasts ${got.seconds} s, not ${want.seconds}`);
  let lit = 0;
  for (let i = -1; i * LOOK < want.seconds + 0.1; i++) {
    for (const [k, l] of lamps.all.entries()) {
      const light = keep(want.light(l, i * LOOK));
      if (light) lit++;
      assertLight(keep(got.light(l, i * LOOK)), light, `${what}: lamp ${k} at ${(i * LOOK).toFixed(3)} s`);
    }
  }
  assert.ok(lit > 0, `${what}: the show to match lights something`);
}

/** When a light rises, from its levels looked at `dt` apart: going above LIT_ABOVE after being below DARK_BELOW. */
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

/**
 * Plays shows (each with its start) through a LightShowPlayer over the table's lamps, with no RiseLimit, and looks at
 * every lamp's level every DT from the start to a little past the last show's end.
 */
function lampLevels(plays: { show: Show; at: number }[]) {
  const player = new LightShowPlayer(lamps.all);
  let end = 0;
  for (const p of plays) {
    player.play(p.show, p.at);
    end = Math.max(end, p.at + p.show.seconds);
  }
  const seen = lamps.all.map(() => [] as number[]);
  let last: (LampLight | null)[] = [];
  for (let i = 0; i * DT < end + 0.25; i++) {
    last = player.lights(i * DT).map(keep);
    last.forEach((light, k) => seen[k].push(light?.level ?? 0));
  }
  return { seen, end, running: player.running, last };
}

test("a bank matched bursts from its plaques in its god's colour, flashes it, and throws sparks off each plaque", () => {
  assert.deepEqual(GOD_COLOR, { ra: 0xffc23a, horus: 0x4a7dff, ankh: 0x39ff6a, eye: 0xff3344 });
  const colors: Record<string, number> = { 'bank-ra': 0xffc23a, 'bank-horus': 0x4a7dff, 'bank-ankh': 0x39ff6a, 'bank-eye': 0xff3344 };
  assert.deepEqual(TABLE_IN_USE.banks.map((b) => b.id).sort(), Object.keys(colors).sort());
  for (const bank of TABLE_IN_USE.banks) {
    const color = colors[bank.id];
    const plaques = bank.targets.map(target);
    assert.equal(plaques.length, 3, `${bank.id} has three plaques`);
    const { x, z } = middleOf(plaques);
    const { shows, calls, kind } = book();
    shows.hype(hype(bank.id, 10));
    assert.equal(calls.length, 0, `${bank.id}: queued till its time`);
    shows.frame(10);

    assert.equal(calls.length, 5, `${bank.id}: a show, a flash and three plaques' sparks, and nothing more`);
    const [play] = kind('play');
    assert.equal(play.at, 10, `${bank.id}: the show begins at the moment's time`);
    assertSameShow(play.show, burst(lamps.all, { x, z, reach: 10, color, seconds: 1.1 }), `${bank.id}'s burst from ${x.toFixed(2)}, ${z.toFixed(2)}`);
    assert.deepEqual(kind('flash'), [{ kind: 'flash', color, strength: 0.5, at: 10 }], `${bank.id}: flashes its colour`);
    assert.deepEqual(
      kind('sparks'),
      plaques.map((p) => ({ kind: 'sparks', x: p.x, y: 0.4, z: p.z, color, count: 10 })),
      `${bank.id}: 10 sparks off each plaque, in its colour`,
    );
    assert.deepEqual([kind('shake'), kind('clear')], [[], []]);
  }
});

test("multiball, a press's or the lock's, chases round the ring and then strobes every lamp, with a white flash; a multiball hype moment alone plays nothing", () => {
  const { shows, calls, kind } = book();
  // Both a press and the lock come to the book through multiball(): the sound cues decide it once.
  shows.multiball(20);
  assert.equal(calls.length, 0, 'queued till its time');
  shows.frame(20);
  assert.equal(calls.length, 3, 'the chase, the strobe and the flash');
  const [round, flashing] = kind('play');
  assert.equal(round.at, 20);
  assertSameShow(round.show, chase(lamps.ring, { color: 0xff2bd6, laps: 2, lapSeconds: 0.9 }), 'the chase round the ring');
  assert.ok(near(round.show.seconds, 1.8), 'two laps of 0.9 s');
  // 0.4 s after the chase ends: at + 2.2.
  assert.ok(near(flashing.at, 22.2), `the strobe begins at ${flashing.at}`);
  assert.ok(near(flashing.at - (round.at + round.show.seconds), 0.4), 'a pause of 0.4 s after the chase');
  assertSameShow(flashing.show, strobe(lamps.all, { color: WHITE, times: 3, rate: 2.5 }), 'the white strobe of every lamp');
  assert.deepEqual(kind('flash'), [{ kind: 'flash', color: WHITE, strength: 0.8, at: 20 }]);
  assert.deepEqual([kind('sparks'), kind('shake')], [[], []]);

  // Another, from the lock, plays whole again.
  shows.multiball(40);
  shows.frame(40);
  assert.equal(calls.length, 6);
  const starts = kind('play').map((p) => p.at);
  [20, 22.2, 40, 42.2].forEach((want, i) => assert.ok(near(starts[i], want), `show ${i} begins at ${starts[i]}, not ${want}`));

  // A multiball hype moment (the press's own) plays nothing: the sound cues' one decision reaches the book through
  // multiball().
  const quiet = book();
  quiet.shows.hype(hype('multiball', 5));
  quiet.shows.frame(5);
  quiet.shows.frame(9);
  assert.deepEqual(quiet.calls, []);
});

test('the ball saver sweeps up the table in green; double score strobes the ladders in gold with a gold flash; a nudge shakes the view 0.3 s', () => {
  const saver = book();
  saver.shows.hype(hype('saver', 12));
  saver.shows.frame(12);
  assert.equal(saver.calls.length, 1, 'a sweep and nothing else');
  assert.equal(saver.kind('play')[0].at, 12);
  assertSameShow(saver.kind('play')[0].show, sweep(lamps.all, { from: 0, to: 16.7, color: 0x39ff6a, seconds: 1 }), 'the saver sweep, z 0 to 16.7');

  const double = book();
  double.shows.hype(hype('double', 12));
  double.shows.frame(12);
  assert.equal(double.calls.length, 2, 'a strobe and a flash');
  assert.equal(double.kind('play')[0].at, 12);
  assertSameShow(double.kind('play')[0].show, strobe(lamps.ladders, { color: 0xffc23a, times: 4, rate: 2.5 }), "double score's strobe of the ladders");
  assert.deepEqual(double.kind('flash'), [{ kind: 'flash', color: 0xffc23a, strength: 0.4, at: 12 }]);

  const nudge = book();
  nudge.shows.hype(hype('nudge', 12));
  nudge.shows.frame(12);
  assert.deepEqual(nudge.calls, [{ kind: 'shake', seconds: 0.3 }], 'a shake and nothing else');
});

test('a payout bursts gold from where its coins burst, wider for more coins', () => {
  // Near the drain, where the coins burst.
  const [x, z] = [1.2, 0.4];
  const farthest = new Map<number, number>();
  for (const [coins, reach] of [[0, 2], [3, 3], [9, 5], [21, 9], [30, 9], [300, 9]] as const) {
    const { shows, calls, kind } = book();
    shows.payout(x, z, coins, 7);
    assert.equal(calls.length, 0, `${coins} coins: queued till its time`);
    shows.frame(7);
    assert.equal(calls.length, 1, `${coins} coins: a burst, and nothing else (the coins are the stage's own burst)`);
    const [play] = kind('play');
    assert.equal(play.at, 7);
    assertSameShow(play.show, burst(lamps.all, { x, z, reach, color: 0xffd23f, seconds: 0.8 }), `${coins} coins: reach min(9, 2 + ${coins} / 3)`);
    // How far from the coins a lamp it lights lies.
    let far = 0;
    for (let i = 0; i * LOOK < play.show.seconds; i++) {
      for (const l of lamps.all) if (play.show.light(l, i * LOOK)) far = Math.max(far, Math.hypot(l.x - x, l.z - z));
    }
    assert.ok(far <= reach, `${coins} coins light nothing past ${reach}: ${far}`);
    farthest.set(coins, far);
  }
  assert.ok(farthest.get(0)! < farthest.get(3)! && farthest.get(3)! < farthest.get(9)! && farthest.get(9)! < farthest.get(21)!, `wider with more coins: ${[...farthest.values()].map((f) => f.toFixed(1)).join(', ')}`);
  assert.equal(farthest.get(30), farthest.get(21), 'no wider than 9 past 21 coins');
  assert.equal(farthest.get(300), farthest.get(21));
});

test("the toys' hits: a pop-up knocked down bursts blue with sparks at the ball; the mummy's hit bursts green; its third also flashes white, shakes 0.6 s and throws 30 sparks; the tomb's catch bursts red", () => {
  const BLUE = 0x4a7dff;
  const GREEN = 0x39ff6a;
  const RED = 0xff3344;

  for (const id of ['target-popup-1', 'target-popup-2', 'target-popup-3']) {
    const p = target(id);
    assert.equal(p.rise, 'drop');
    const ball = { x: p.x + 0.3, z: p.z - 0.4 };
    const { shows, calls, kind } = book();
    shows.cue(cue(id, true, ball.x, ball.z, 5));
    assert.equal(calls.length, 0, `${id}: queued till its time`);
    shows.frame(5);
    assert.equal(calls.length, 2, `${id}: a burst and sparks, with no flash or shake`);
    assert.equal(kind('play')[0].at, 5);
    assertSameShow(kind('play')[0].show, burst(lamps.all, { x: p.x, z: p.z, reach: 3, color: BLUE, seconds: 0.6 }), `${id}'s burst from the pop-up`);
    assert.deepEqual(kind('sparks'), [{ kind: 'sparks', x: ball.x, y: 0.35, z: ball.z, color: 0xbcd4ff, count: 14 }], `${id}: 14 sparks at the ball`);
  }

  const m = target('target-mummy');
  assert.equal(m.rise, 'hold');
  const ball = { x: m.x + 0.25, z: m.z - 0.35 };
  const hit = book();
  hit.shows.cue(cue('target-mummy', false, ball.x, ball.z, 6));
  hit.shows.frame(6);
  assert.equal(hit.calls.length, 2, "the mummy's hit: a burst and sparks");
  assertSameShow(hit.kind('play')[0].show, burst(lamps.all, { x: m.x, z: m.z, reach: 2.5, color: GREEN, seconds: 0.5 }), "the mummy's hit, from the mummy");
  assert.equal(hit.kind('play')[0].at, 6);
  assert.deepEqual(hit.kind('sparks'), [{ kind: 'sparks', x: ball.x, y: 0.5, z: ball.z, color: 0xffd23f, count: 10 }], '10 sparks at the ball');

  // Its third hit (down) is a row of its own: bigger, with a white flash and a shake, and 30 sparks in place of 10.
  const third = book();
  third.shows.cue(cue('target-mummy', true, ball.x, ball.z, 6));
  third.shows.frame(6);
  assert.equal(third.calls.length, 4, "the mummy's third: a burst, a flash, a shake and sparks");
  assertSameShow(third.kind('play')[0].show, burst(lamps.all, { x: m.x, z: m.z, reach: 10, color: GREEN, seconds: 1.2 }), "the mummy's third hit, from the mummy");
  assert.equal(third.kind('play')[0].at, 6);
  assert.deepEqual(third.kind('flash'), [{ kind: 'flash', color: WHITE, strength: 0.6, at: 6 }], 'a white flash at the hit');
  assert.deepEqual(third.kind('shake'), [{ kind: 'shake', seconds: 0.6 }]);
  assert.deepEqual(third.kind('sparks'), [{ kind: 'sparks', x: ball.x, y: 0.5, z: ball.z, color: 0xffd23f, count: 30 }], '30 sparks at the ball, and not 10 as well');

  // The tomb's catch: the burst from the doorway, the sparks at the ball, which the tomb holds a little in front of it.
  const tomb = TABLE_IN_USE.tomb!;
  assert.notDeepEqual([tomb.x, tomb.z], tomb.held, 'the held spot is not the doorway');
  const catches = book();
  catches.shows.cue(cue(tomb.id, false, tomb.held[0], tomb.held[1], 8));
  catches.shows.frame(8);
  assert.equal(catches.calls.length, 2, "the tomb's catch: a burst and sparks");
  assert.equal(catches.kind('play')[0].at, 8);
  assertSameShow(catches.kind('play')[0].show, burst(lamps.all, { x: tomb.x, z: tomb.z, reach: 4, color: RED, seconds: 0.7 }), "the tomb's burst from the doorway");
  assert.deepEqual(catches.kind('sparks'), [{ kind: 'sparks', x: tomb.held[0], y: 0.35, z: tomb.held[1], color: 0xff8a3a, count: 16 }], '16 sparks at the ball');
});

test("a cue for a part the table hasn't got, or a hype id with no show, does nothing", () => {
  const { shows, calls } = book();
  // Parts with no row: ids the table doesn't have (and names an object has), targets it has that the book gives nothing
  // (a plaque, a drop target), and the gate.
  for (const part of ['target-nothing', '', 'target-ra-1', 'target-scarab', 'target-eye', 'diverter', 'toString', '__proto__']) {
    shows.cue(cue(part, true, 1, 2, 3));
    shows.cue(cue(part, false, 1, 2, 3));
  }
  // Ids with no show: a button the table hasn't got, a bank it hasn't got, and names an object would have.
  for (const id of ['jackpot', '', 'bank-', 'bank-nothing', 'bank-horus-1', 'bank-constructor', 'bank-__proto__', 'bank-toString', 'constructor', '__proto__']) {
    shows.hype(hype(id, 3));
  }
  shows.frame(3);
  shows.frame(100);
  assert.deepEqual(calls, []);

  // A table without the toys, or without a bank: their moments do nothing, and the rest still play.
  const bare: Table = {
    ...TABLE_IN_USE,
    targets: TABLE_IN_USE.targets.filter((t) => !t.rise),
    tomb: undefined,
    banks: TABLE_IN_USE.banks.filter((b) => b.id !== 'bank-eye'),
  };
  const without = book(bare);
  for (const part of ['target-popup-1', 'target-mummy', 'tomb']) without.shows.cue(cue(part, true, 1, 2, 3));
  without.shows.hype(hype('bank-eye', 3));
  without.shows.frame(3);
  assert.deepEqual(without.calls, [], 'no pop-ups, mummy, tomb or Eye bank to play');
  without.shows.hype(hype('bank-ra', 4));
  without.shows.frame(4);
  assert.equal(without.kind('play').length, 1, 'the Ra bank still plays');

  // A bank the table has that names no god of the quest has no colour to play in: nothing, and not the colour of a name
  // an object has (constructor, toString), which a lookup that read inherited properties would find.
  const unnamed = ['bank-sphinx', 'bank-constructor', 'bank-toString', 'bank-__proto__', 'bank-'];
  const odd: Table = { ...TABLE_IN_USE, banks: [...TABLE_IN_USE.banks, ...unnamed.map((id) => ({ id, targets: TABLE_IN_USE.banks[0].targets, bonus: 5000 }))] };
  const unlit = book(odd);
  for (const id of unnamed) unlit.shows.hype(hype(id, 3));
  unlit.shows.frame(3);
  assert.deepEqual(unlit.calls, [], 'a bank with no god plays nothing');
  unlit.shows.hype(hype('bank-horus', 4));
  unlit.shows.frame(4);
  assert.equal(unlit.kind('play').length, 1, "while the gods' banks still play");
});

test('each moment plays at its time, not before; one drawn more than 2 s late is let go', () => {
  const ways: [string, (s: PinballShows, at: number) => void][] = [
    ['a hype moment', (s, at) => s.hype(hype('double', at))],
    ['a toy hit cue', (s, at) => s.cue(cue('target-popup-1', true, 1.3, 6.5, at))],
    ['multiball', (s, at) => s.multiball(at)],
    ['a payout', (s, at) => s.payout(0, 0.3, 5, at)],
  ];
  for (const [name, queue] of ways) {
    // Not before its time, then once.
    const { shows, calls, kind } = book();
    shows.frame(9);
    queue(shows, 10);
    shows.frame(9.99);
    assert.equal(calls.length, 0, `${name}: not before its time`);
    shows.frame(10);
    const made = calls.length;
    assert.ok(made > 0, `${name}: at its time`);
    assert.equal(kind('play')[0].at, 10, `${name}: begun at its own time`);
    shows.frame(10.5);
    shows.frame(11);
    assert.equal(calls.length, made, `${name}: played once`);

    // A frame a little late plays it as of its own time; at 2 s late, still; any later, it is let go (and stays gone).
    const late = book();
    queue(late.shows, 20);
    late.shows.frame(21.5);
    assert.ok(late.calls.length > 0, `${name}: 1.5 s late still plays`);
    assert.equal(late.kind('play')[0].at, 20, `${name}: 1.5 s late, as if begun at its time`);
    const edge = book();
    queue(edge.shows, 20);
    edge.shows.frame(22);
    assert.ok(edge.calls.length > 0, `${name}: 2 s late still plays`);
    const gone = book();
    queue(gone.shows, 20);
    gone.shows.frame(22.01);
    assert.equal(gone.calls.length, 0, `${name}: more than 2 s late is let go`);
    gone.shows.frame(22.5);
    gone.shows.frame(40);
    assert.equal(gone.calls.length, 0, `${name}: and not played later`);
    // A page catching up that first draws it long after: nothing, and the moments after it still play.
    const caught = book();
    queue(caught.shows, 30);
    queue(caught.shows, 60);
    caught.shows.frame(60.5);
    assert.equal(caught.kind('play')[0].at, 60, `${name}: only the one drawn in time plays`);
  }
});

test('moments due together play in the order of their times, so the flash is asked for in time order', () => {
  const { shows, calls, kind } = book();
  shows.frame(10);
  // Queued out of order; the two at 11.5 are the same instant (cues from one step), and keep their order.
  shows.hype(hype('double', 12));
  shows.cue(cue('target-mummy', true, -2, 6, 11.5));
  shows.hype(hype('bank-ra', 11));
  shows.cue(cue('target-popup-2', true, 1.8, 6.4, 11.5));
  shows.frame(13);
  assert.deepEqual(
    kind('flash').map((f) => f.at),
    [11, 11.5, 12],
    'a flash for each, in the order of their times',
  );
  assert.deepEqual(
    kind('play').map((p) => p.at),
    [11, 11.5, 11.5, 12],
  );
  // The first of the two at 11.5 was queued first: the mummy's third (its sparks are 30).
  const sparks = kind('sparks').map((s) => s.count);
  assert.deepEqual(sparks, [10, 10, 10, 30, 14]);
  assert.equal(calls.filter((c) => c.kind === 'shake').length, 1);
});

test("the table's clock starting again lets go of the old clock's moments and clears what plays", () => {
  const { shows, calls, kind } = book();
  shows.frame(600);
  shows.hype(hype('nudge', 601));
  shows.hype(hype('double', 900));
  shows.cue(cue('target-mummy', true, -2, 6, 650));
  // The server restarted: the drawn time is back at the start. The old clock's moments go, and what plays is cleared,
  // once.
  shows.frame(1);
  assert.deepEqual(calls, [{ kind: 'clear' }], 'cleared once, and nothing played');
  shows.frame(1);
  shows.frame(2);
  // The old clock's times come round on the new one: the moments are gone, so nothing plays.
  shows.frame(601);
  shows.frame(901);
  shows.frame(1000);
  assert.deepEqual(calls, [{ kind: 'clear' }], "the old clock's moments never play, and the clear is not repeated");
  // The book works on the new clock.
  shows.hype(hype('nudge', 1005));
  shows.frame(1004);
  assert.equal(kind('shake').length, 0);
  shows.frame(1005);
  assert.deepEqual(kind('shake'), [{ kind: 'shake', seconds: 0.3 }]);
  assert.equal(kind('clear').length, 1);

  // A moment more than a second ahead of the new time is the old clock's, whatever it was queued for: it goes too.
  const ahead = book();
  ahead.shows.frame(600);
  ahead.shows.hype(hype('nudge', 3));
  ahead.shows.frame(1);
  ahead.shows.frame(3);
  assert.deepEqual(ahead.calls, [{ kind: 'clear' }]);

  // Going back by a second or less is the same clock (the drawn time slips back a little after a pause): the moments
  // stay and nothing is cleared. More than a second is the clock starting again.
  const slip = book();
  slip.shows.frame(100);
  slip.shows.hype(hype('nudge', 100.5));
  slip.shows.frame(99.5);
  slip.shows.frame(99);
  assert.equal(slip.kind('clear').length, 0, 'a second back is not a restart');
  slip.shows.frame(100.5);
  assert.deepEqual(slip.calls, [{ kind: 'shake', seconds: 0.3 }], 'the moment waited');
  slip.shows.frame(99.5);
  assert.equal(slip.kind('clear').length, 0, 'a second back from 100.5 is not a restart either');
  slip.shows.frame(98.25);
  assert.equal(slip.kind('clear').length, 1, 'more than a second back (from 99.5) is');
  slip.shows.frame(98.25);
  assert.equal(slip.kind('clear').length, 1, 'and it is cleared once');
});

test("a moment already on the restarted table's clock, queued before the first frame drawn on it, still plays at its time", () => {
  const { shows, calls, kind } = book();
  shows.frame(600);
  // The old clock's own moment, and three that the restarted server sent just before the first frame drawn on its clock
  // (the table is at 1 there): one already due, one half a second ahead and one a whole second ahead.
  shows.hype(hype('nudge', 601));
  shows.cue(cue('target-popup-1', true, 1.3, 6.5, 0.9));
  shows.hype(hype('double', 1.5));
  shows.hype(hype('saver', 2));
  shows.frame(1);
  // The sinks are cleared first, so that what plays now is not wiped; then the moment that was due plays, as of its
  // own time.
  assert.equal(calls[0].kind, 'clear', 'cleared before anything plays');
  assert.equal(kind('clear').length, 1, 'and only once');
  assert.deepEqual(kind('play').map((p) => p.at), [0.9], "the pop-up's burst, begun at its own time");
  assert.deepEqual(kind('sparks'), [{ kind: 'sparks', x: 1.3, y: 0.35, z: 6.5, color: 0xbcd4ff, count: 14 }]);
  // The others wait for their times and then play, and the old clock's never does.
  const made = calls.length;
  shows.frame(1.4);
  assert.equal(calls.length, made, 'not before their times');
  shows.frame(1.5);
  assert.deepEqual(kind('flash'), [{ kind: 'flash', color: 0xffc23a, strength: 0.4, at: 1.5 }], "double score's flash, at its time");
  shows.frame(2);
  assert.deepEqual(kind('play').map((p) => p.at), [0.9, 1.5, 2], "the pop-up's burst, double score's strobe and the saver's sweep");
  shows.frame(601);
  shows.frame(700);
  assert.deepEqual(kind('shake'), [], "the old clock's nudge is gone");
  assert.equal(kind('clear').length, 1);

  // The edge: exactly a second ahead of the new time is on the new clock, and any more is the old clock's.
  const edge = book();
  edge.shows.frame(600);
  edge.shows.hype(hype('nudge', 2));
  edge.shows.hype(hype('double', 2.01));
  edge.shows.frame(1);
  edge.shows.frame(2);
  edge.shows.frame(3);
  assert.deepEqual(edge.calls, [{ kind: 'clear' }, { kind: 'shake', seconds: 0.3 }], 'the nudge at 2 plays; the double at 2.01 is gone');
});

test('a fresh hello (reset) lets go of everything queued and forgets the old time, clearing what plays', () => {
  const { shows, calls, kind } = book();
  shows.frame(600);
  shows.hype(hype('nudge', 601));
  shows.reset();
  assert.deepEqual(calls, [{ kind: 'clear' }], 'what plays on the old clock is cleared');
  shows.frame(601);
  assert.deepEqual(calls, [{ kind: 'clear' }], 'the queued moment is gone');
  // The new clock may start from 0: it is not seen as the clock going back, so there is no second clear.
  shows.reset();
  shows.frame(1);
  shows.hype(hype('nudge', 2));
  shows.frame(2);
  assert.equal(kind('clear').length, 2, 'one for each reset, none for the first frame after it');
  assert.deepEqual(kind('shake'), [{ kind: 'shake', seconds: 0.3 }]);
});

test("a moment or a frame whose time isn't a number does nothing and leaves the book as it was", () => {
  const { shows, calls } = book();
  shows.hype(hype('nudge', NaN));
  shows.hype(hype('double', Infinity));
  shows.cue(cue('target-popup-1', true, 1, 2, NaN));
  shows.multiball(NaN);
  shows.payout(0, 0.3, 5, NaN);
  shows.hype(hype('nudge', 5));
  shows.frame(NaN);
  shows.frame(Infinity);
  shows.frame(4);
  assert.deepEqual(calls, [], 'not due yet, and nothing was queued by a time that is not one');
  shows.frame(5);
  assert.deepEqual(calls, [{ kind: 'shake', seconds: 0.3 }]);
});

test('DrawnClock steps by the drawn time, at most 0.1, none while it stands still, none across a jump back', () => {
  const clock = new DrawnClock();
  assert.equal(clock.now, 0, 'before any time');
  assert.equal(clock.step(10), 0, 'the first look has no time before it');
  assert.equal(clock.now, 10);
  assert.ok(near(clock.step(10.05), 0.05), 'steps by the drawn time');
  assert.ok(near(clock.now, 10.05));
  assert.equal(clock.step(10.05), 0, 'none while it stands still');
  assert.ok(near(clock.now, 10.05));
  assert.ok(near(clock.step(10.15), 0.1), 'a step of exactly 0.1');

  // A long gap (the page was hidden, the table was paused) gives 0.1, and the clock is where the table is.
  assert.equal(clock.step(20), 0.1, 'a long gap gives 0.1');
  assert.equal(clock.now, 20, 'now is the latest drawn time, whatever the step');
  assert.ok(near(clock.step(20.04), 0.04));

  // A slip back holds now still and steps 0; the next rise is counted from now, not from the slip.
  assert.ok(near(clock.now, 20.04));
  assert.equal(clock.step(20), 0, 'a slip back of 0.04 s holds');
  assert.ok(near(clock.now, 20.04), 'now does not go back');
  assert.equal(clock.step(19.5), 0, 'a slip back of half a second holds');
  assert.ok(near(clock.now, 20.04));
  assert.equal(clock.step(20.04), 0, 'back where it was: no rise');
  assert.ok(near(clock.step(20.09), 0.05), 'the rise in now, 0.05 s, not 0.59 s from the slip');
  assert.ok(near(clock.now, 20.09));

  // A second back is a slip; more than a second back starts it fresh at the new time, with no step.
  const edge = new DrawnClock();
  edge.step(10);
  assert.equal(edge.step(9), 0, 'exactly a second back holds');
  assert.equal(edge.now, 10);
  assert.equal(edge.step(8.99), 0, 'more than a second back: no step');
  assert.equal(edge.now, 8.99, 'it starts fresh: now is the new time');
  assert.ok(near(edge.step(9.05), 0.06), 'and steps on from there');
  assert.equal(edge.now, 9.05);
  // After a jump back, a slip is measured from the new time.
  assert.equal(edge.step(9), 0);
  assert.equal(edge.now, 9.05);

  // reset() forgets the time: the next look is a first look again, wherever it is.
  edge.reset();
  assert.equal(edge.now, 0);
  assert.equal(edge.step(500), 0);
  assert.equal(edge.now, 500);
  assert.ok(near(edge.step(500.02), 0.02));
  edge.reset();
  assert.equal(edge.step(3), 0, 'a first look after a reset steps nothing, even from far below the old time');
  assert.equal(edge.now, 3);

  // A time that isn't a number is no time.
  const odd = new DrawnClock();
  odd.step(5);
  assert.equal(odd.step(NaN), 0);
  assert.equal(odd.step(Infinity), 0);
  assert.equal(odd.now, 5);
  assert.ok(near(odd.step(5.03), 0.03));
  // Every step is between 0 and 0.1, whatever the times.
  const wild = new DrawnClock();
  for (const time of [0, 3, 2.5, 2.9, 8, 7.2, 50, 49.9, 49.95, 49, 48.95, 100, 0.2, 0.25]) {
    const step = wild.step(time);
    assert.ok(step >= 0 && step <= 0.1, `${time}: a step of ${step}`);
  }
});

/** Every moment the book has a row for, each queued at 0, as the function that queues it. */
function everyMoment(): [string, (s: PinballShows) => void][] {
  const moments: [string, (s: PinballShows) => void][] = [];
  for (const bank of TABLE_IN_USE.banks) moments.push([bank.id, (s) => s.hype(hype(bank.id, 0))]);
  moments.push(['multiball', (s) => s.multiball(0)]);
  for (const id of ['saver', 'double', 'nudge']) moments.push([id, (s) => s.hype(hype(id, 0))]);
  // A payout from the drain, small and large, and one that is as wide as it gets.
  for (const coins of [0, 1, 6, 30, 100]) moments.push([`a payout of ${coins}`, (s) => s.payout(1.2, 0.4, coins, 0)]);
  for (const t of TABLE_IN_USE.targets) {
    if (t.rise === 'drop') moments.push([`${t.id} knocked down`, (s) => s.cue(cue(t.id, true, t.x, t.z, 0))]);
    if (t.rise === 'hold') {
      moments.push([`${t.id} hit`, (s) => s.cue(cue(t.id, false, t.x, t.z, 0))]);
      moments.push([`${t.id}'s third hit`, (s) => s.cue(cue(t.id, true, t.x, t.z, 0))]);
    }
  }
  const tomb = TABLE_IN_USE.tomb!;
  moments.push(["the tomb's catch", (s) => s.cue(cue(tomb.id, false, tomb.held[0], tomb.held[1], 0))]);
  return moments;
}

test('every show the book plays ends, and played alone rises no lamp more than 3 times in any second', () => {
  const moments = everyMoment();
  // 4 banks, multiball, the saver, double, a nudge, 5 payouts, 3 pop-ups, the mummy twice and the tomb.
  assert.equal(moments.length, 4 + 1 + 3 + 5 + 3 + 2 + 1);
  let shown = 0;
  for (const [name, queue] of moments) {
    const { shows, kind } = book();
    queue(shows);
    shows.frame(0);
    const plays = kind('play');
    if (!plays.length) {
      assert.equal(name, 'nudge', `${name} plays a show`);
      continue;
    }
    shown++;
    for (const p of plays) assert.ok(Number.isFinite(p.show.seconds) && p.show.seconds > 0, `${name}: a show that lasts`);
    const { seen, end, running, last } = lampLevels(plays);
    assert.equal(running, 0, `${name}: every show has ended and been let go`);
    assert.ok(last.every((light) => light === null), `${name}: and lights nothing after`);
    assert.ok(end > 0.4 && end < 4, `${name} ends at ${end}`);
    let total = 0;
    seen.forEach((levels, k) => {
      total += riseTimes(levels, DT).length;
      assert.ok(rises(levels, DT) <= 3, `${name}: lamp ${k} rises ${rises(levels, DT)} times in a second`);
    });
    assert.ok(total > 0, `${name}: it lights lamps`);
  }
  assert.equal(shown, moments.length - 1, 'every moment but the nudge plays a show');

  // The pause is what keeps multiball to 3: with the strobe right after the chase, the lamps the chase lights last rise
  // a fourth time in a second.
  const lap = chase(lamps.ring, { color: 0xff2bd6, laps: 2, lapSeconds: 0.9 });
  const rushed = lampLevels([
    { show: lap, at: 0 },
    { show: strobe(lamps.all, { color: WHITE, times: 3, rate: 2.5 }), at: lap.seconds },
  ]);
  assert.equal(Math.max(...rushed.seen.map((levels) => rises(levels, DT))), 4, 'a strobe straight after the chase rises 4 times in a second');
  const { shows, kind } = book();
  shows.multiball(0);
  shows.frame(0);
  const paused = lampLevels(kind('play'));
  assert.equal(Math.max(...paused.seen.map((levels) => rises(levels, DT))), 3, "with the book's pause the most is 3");
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
