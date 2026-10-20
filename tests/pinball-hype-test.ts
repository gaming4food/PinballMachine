// Tests the pinball's seven hype buttons (server/game.ts, action and buyHype) and paid support (handle, supportEffect),
// headlessly with the real physics and wallet, as the claw's claw-hype-test does. The streamer presses each for free;
// chat buys each (the city takes the coins, then calls buyHype). Multiball starts now, with a ball on the table, and is
// refused without one. The ball saver lasts 15 s, and with no ball on the table it waits for the next launch (the panel
// marks it Ready). Double score lasts 30 s, and a second press adds 30. A nudge jolts the balls, and is refused with none.
// A purchase that waits is given back by a reset (a line only when the city says coins really went back), and a reset
// clears a bought saver and double score too. Subs and gifts press one for free by their size, or the next that can
// happen; the line thanks the supporter, and the city's card names what it set off. Multiball bought during one of the
// quest's modes leaves the mode running, and during the finale (whose multiball is on) it is refused. Chat's three
// events: a sandstorm blows the wind for 10 s on the table's clock (a second adds 10 s, the same way), Pharaoh's curse
// swaps chat's left and right for 10 s (not the auto-save's), and the summoned mummy rises for 20 s, its third hit
// paying 10,000 undoubled. Each is refused with no ball, the mummy also while up, in The Mummy Wakes and in the
// finale; either of those starting takes a summoned mummy over. The Reset ends them, a restart forgets them, and the
// state carries them.
// Usage: npm run pinball-hype-test
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy, hypeAction, type HypePurchase, initPhysics, roomInfo, type StreamEvent, type User } from '@kit/server';
import type { FeedItem, ServerMsg } from '@kit/shared';
import { entry } from '../src/entry';
import { PinballGame } from '../src/server/game';
import { DT } from '../src/server/sim';
import { gust, type PinballCueMsg, pinballCueOf, type PinballHypeMsg, pinballHypeOf, type PinballState, pinballStateOf, RULES } from '../src/shared/pinball';
import { TABLE, TABLE_IN_USE } from '../src/shared/table';

await initPhysics();

// The same run every time: Math.random seeded with the claw's tests' generator (16807).
let seed = 1;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
let now = Date.UTC(2026, 9, 17);
Date.now = () => now;

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** A fresh game and wallet, with what it sends. `done` removes the temp folder. */
function aGame() {
  const dir = mkdtempSync(join(tmpdir(), 'coinop-pinball-hype-'));
  const economy = new Economy(dir);
  const sent: ServerMsg[] = [];
  const game = new PinballGame(roomInfo(entry.id, entry.label), economy, { send: (m) => sent.push(m) }, join(dir, 'machine-pinball.json'));
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      game.step();
      now += DT * 1000;
    }
    game.publish(now);
  };
  const feed = (): FeedItem[] => sent.filter((m): m is Extract<ServerMsg, { t: 'feed' }> => m.t === 'feed').map((m) => m.item);
  const moments = (): PinballHypeMsg[] =>
    sent.flatMap((m) => (m.t === 'machine' ? [pinballHypeOf(m.msg)] : [])).filter((m): m is PinballHypeMsg => m !== null);
  const viewer = (name: string): User => economy.touch('youtube', name, name).user;
  /** A viewer's ball on the table, launched. */
  const ballOn = (name: string): number => {
    game.handle({ kind: 'chat', platform: 'youtube', userId: name, name, text: 'ball' });
    run(RULES.launchDelay + 0.1);
    assert.ok(game.sim.items.size >= 1, 'a ball on the table');
    return [...game.sim.items.keys()][0];
  };
  /** `name`, who has paid `coins`, and their purchase; its refund counts its calls and says `back` on the first. */
  const bought = (name: string, coins: number): HypePurchase & { refunds: number; back: boolean } => {
    const purchase: HypePurchase & { refunds: number; back: boolean } = {
      user: viewer(name),
      paid: coins,
      refunds: 0,
      back: coins > 0,
      refund: () => purchase.refunds++ === 0 && purchase.back,
    };
    return purchase;
  };
  /**
   * Every ball on the table kept still at a spot of its own for `seconds` (none drains, hits a toy or sits stuck: it is
   * lifted a little every other second, so the stuck watcher sees it move).
   */
  const hold = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const lift = Math.floor(game.sim.time) % 2 ? 0.4 : 0;
      [...game.sim.items.values()].forEach((b, k) => {
        b.body.setTranslation({ x: [-0.4, 0.4, -1.2][k], y: TABLE.ballRadius, z: [7.4, 9.0, 9.0][k] + lift }, true);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      });
      run(DT);
    }
  };
  /** The cues and the states sent since `mark`, in order. */
  const cues = (mark = 0): PinballCueMsg[] =>
    sent.slice(mark).flatMap((m) => (m.t === 'machine' ? [pinballCueOf(m.msg)] : [])).filter((c): c is PinballCueMsg => c !== null);
  const states = (mark = 0): PinballState[] =>
    sent.slice(mark).flatMap((m) => (m.t === 'machine' ? [pinballStateOf(m.msg)] : [])).filter((s): s is PinballState => s !== null);
  const file = join(dir, 'machine-pinball.json');
  const done = () => {
    economy.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may still hold the database open; the temp folder is left.
    }
  };
  return { game, economy, sent, run, hold, cues, states, file, feed, moments, viewer, ballOn, bought, done };
}
/** The table's mummy, the one rising target that holds. */
const MUMMY = TABLE_IN_USE.targets.find((t) => t.rise === 'hold')!;
/** A hit on the mummy by ball `ball`, through the table's own report of hits, delivered in the game's next step. */
const reportHit = (game: PinballGame, ball: number, id = MUMMY.id) => (game.sim as any).report({ kind: 'target', id, ball });
/** A bank of plaques matched by ball `ball`, as the table reports one. */
const reportBank = (game: PinballGame, ball: number, god: string) => (game.sim as any).report({ kind: 'bank', id: `bank-${god}`, ball });
/** Runs `fn` with the dev host's switches on (PINBALL_TOYS), and puts the setting back as it was. */
function withDevSwitches(fn: () => void): void {
  const was = process.env.PINBALL_TOYS;
  process.env.PINBALL_TOYS = '1';
  try {
    fn();
  } finally {
    if (was === undefined) delete process.env.PINBALL_TOYS;
    else process.env.PINBALL_TOYS = was;
  }
}
const NO_EVENTS = { sandstorm: null, curse: null, mummy: null };
const last = (feed: FeedItem[]) => [feed.at(-1)?.text, feed.at(-1)?.tone];
const supportFrom = (name: string, cents?: number): StreamEvent =>
  cents === undefined
    ? { kind: 'sub', platform: 'youtube', userId: name, name, months: 1 }
    : { kind: 'gift', platform: 'youtube', userId: name, name, usdCents: cents, label: `a $${(cents / 100).toFixed(2)} gift` };
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.05, `${what} (${a} against ${b})`);

test("a streamer's press is free and names nobody", () => {
  const { game, run, feed, moments, ballOn, done } = aGame();
  try {
    ballOn('ana');
    game.action(hypeAction('double'));
    near(game.state().doubleUntil! - game.sim.time, RULES.doubleHype, 'double score on');
    assert.deepEqual(moments(), [{ kind: 'pinballHype', id: 'double', at: game.sim.time }]);
    assert.ok(!('by' in moments()[0]), 'no buyer');
    assert.ok(!feed().some((f) => f.text.includes(' bought ')), 'no "bought" line');
    run(0.1);
  } finally {
    done();
  }
});

test('an unknown id does nothing', () => {
  const { game, sent, feed, moments, ballOn, bought, done } = aGame();
  try {
    ballOn('ana');
    const before = [sent.length, feed().length];
    game.action(hypeAction('tilt'));
    game.action({ kind: 'hype' });
    game.action({ kind: 'hype', id: 7 });
    assert.deepEqual([sent.length, feed().length], before, 'nothing sent');
    assert.equal(game.buyHype('tilt', bought('ben', 5)), "that hype isn't for sale");
    assert.deepEqual(moments(), []);
    assert.equal(game.state().doubleUntil, null);
  } finally {
    done();
  }
});

test('multiball with a ball on the table starts at once, naming the buyer', () => {
  const { game, run, feed, moments, ballOn, bought, done } = aGame();
  try {
    const first = ballOn('ana');
    const p = bought('ben', 200);
    assert.equal(game.buyHype('multiball', p), null);
    assert.equal(game.state().multiball, true);
    assert.equal(game.buyHype('multiball', bought('cal', 200)), 'multiball is already on');
    run(RULES.maxExtraBalls * 0.6 + 0.5);
    assert.equal(game.sim.items.size, 1 + RULES.maxExtraBalls, 'the house balls come');
    // "2 more balls in now": the ball in play stays in play, not held in the lock.
    const ball = game.sim.items.get(first);
    assert.ok(ball, 'the ball in play is still on the table');
    assert.ok(ball.body.isDynamic(), 'and free, not held');
    const v = ball.body.linvel();
    assert.ok(Math.hypot(v.x, v.z) > 0.01, 'and moving');
    assert.equal([...game.sim.items.values()].filter((b) => b.body.isDynamic()).length, 3, '3 balls free on the table');
    assert.equal(moments().length, 1);
    assert.deepEqual(moments()[0], { kind: 'pinballHype', id: 'multiball', at: moments()[0].at, by: { name: 'ben', color: p.user.color } });
    assert.match(feed().find((f) => f.text.includes('bought'))?.text ?? '', /^ben bought multiball! /);
    assert.equal(p.refunds, 0, 'nothing given back');
  } finally {
    done();
  }
});

test("multiball with no ball on the table is refused, and the streamer's press says so", () => {
  const { game, sent, feed, moments, bought, done } = aGame();
  try {
    const p = bought('ben', 200);
    const before = sent.length;
    assert.equal(game.buyHype('multiball', p), "there's no ball on the table");
    assert.equal(sent.length, before, 'no line, no moment for a buyer');
    assert.equal(p.refunds, 0, 'the city gives the coins back, not the game');
    game.action(hypeAction('multiball'));
    assert.deepEqual(last(feed()), ["There's no ball on the table.", 'info']);
    assert.deepEqual(moments(), []);
    assert.equal(game.state().multiball, false);
  } finally {
    done();
  }
});

test('the ball saver with a ball on the table lasts 15 seconds', () => {
  const { game, run, moments, ballOn, bought, done } = aGame();
  try {
    const ball = ballOn('ana');
    // The ball's own saver is over, the ball held still above the pyramid meanwhile (so the table can't drain it).
    const body = game.sim.items.get(ball)!.body;
    for (let i = 0; i < Math.round((RULES.ballSaverStart + 0.5) / DT); i++) {
      body.setTranslation({ x: -0.4, y: TABLE.ballRadius, z: 9 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      run(DT);
    }
    assert.equal(game.state().saverUntil, null);
    const p = bought('ben', 50);
    assert.equal(game.buyHype('saver', p), null);
    near(game.state().saverUntil! - game.sim.time, RULES.saverHype, 'a saver 15 s ahead');
    assert.deepEqual(game.state().waiting, []);
    assert.equal(moments().at(-1)?.id, 'saver');
    run(RULES.saverHype + 0.1);
    assert.equal(game.state().saverUntil, null, 'and over');
  } finally {
    done();
  }
});

test('the ball saver with no ball waits for the next launch, and the panel can see it', () => {
  const { game, run, moments, viewer, bought, ballOn, done } = aGame();
  try {
    viewer('ana');
    const p = bought('ben', 50);
    assert.equal(game.buyHype('saver', p), null);
    assert.deepEqual(game.state().waiting, ['saver']);
    assert.equal(game.state().saverUntil, null);
    assert.deepEqual(moments(), [], 'its moment comes when it happens');
    assert.equal(game.buyHype('saver', bought('cal', 50)), 'a ball saver is already waiting');
    ballOn('ana');
    assert.deepEqual(game.state().waiting, []);
    assert.ok(game.state().saverUntil! - game.sim.time > RULES.saverHype - 0.5, 'the saver started at the launch');
    assert.equal(moments().length, 1);
    assert.deepEqual(moments()[0].by, { name: 'ben', color: p.user.color });
    run(0.1);
    assert.equal(p.refunds, 0, 'a saver that happened is not given back');
  } finally {
    done();
  }
});

test('double score lasts 30 seconds, and a second press adds 30', () => {
  const { game, run, ballOn, bought, done } = aGame();
  try {
    ballOn('ana');
    assert.equal(game.buyHype('double', bought('ben', 100)), null);
    const first = game.state().doubleUntil!;
    near(first - game.sim.time, RULES.doubleHype, '30 s');
    assert.equal(game.buyHype('double', bought('cal', 100)), null);
    near(game.state().doubleUntil! - first, RULES.doubleHype, 'a second press adds 30');
    run(1);
  } finally {
    done();
  }
});

test('a nudge jolts the ball, and is refused with none', () => {
  const { game, moments, ballOn, bought, done } = aGame();
  try {
    assert.equal(game.buyHype('nudge', bought('ben', 30)), "there's no ball to nudge");
    assert.deepEqual(moments(), []);
    const id = ballOn('ana');
    const v0 = game.sim.items.get(id)!.body.linvel().z;
    assert.equal(game.buyHype('nudge', bought('ben', 30)), null);
    assert.notEqual(game.sim.items.get(id)!.body.linvel().z, v0, 'the ball moved');
    assert.equal(moments().at(-1)?.id, 'nudge');
  } finally {
    done();
  }
});

test('a reset gives back a waiting saver, with a line only when coins really went back, and clears the rest', () => {
  const { game, run, feed, ballOn, bought, done } = aGame();
  try {
    const paid = bought('ben', 50);
    game.buyHype('saver', paid);
    game.resetMachine();
    assert.equal(paid.refunds, 1);
    assert.equal(feed().some((f) => f.text === 'The machine was reset: ben gets their 50 coins back.'), true);
    assert.deepEqual(game.state().waiting, []);

    const gone = bought('cal', 50);
    gone.back = false; // removed since
    game.buyHype('saver', gone);
    const lines = feed().length;
    game.resetMachine();
    assert.equal(gone.refunds, 1);
    assert.ok(!feed().slice(lines).some((f) => f.text.includes('coins back')), 'no line: none went back');

    ballOn('ana');
    game.handle({ kind: 'chat', platform: 'youtube', userId: 'ana', name: 'ana', text: 'left' });
    assert.equal(game.autoSaving, false);
    game.buyHype('saver', bought('dan', 50));
    game.buyHype('double', bought('dan', 100));
    game.resetMachine();
    const s = game.state();
    assert.deepEqual([s.saverUntil, s.doubleUntil], [null, null], 'a bought saver and double do not outlive a reset');
    assert.equal(game.autoSaving, true, "chat's last word is forgotten");
    ballOn('eve');
    assert.ok(game.state().saverUntil! - game.sim.time < RULES.ballSaverStart, 'a plain launch saver, not the old 15 s');
    run(0.1);
  } finally {
    done();
  }
});

test('each size of paid support sets off its hype, thanking the supporter', () => {
  const cases: [cents: number | undefined, id: string, effect: string][] = [
    [50, 'nudge', 'NUDGE!'],
    [undefined, 'saver', 'BALL SAVER!'],
    [499, 'saver', 'BALL SAVER!'],
    [500, 'double', 'DOUBLE SCORE!'],
    [1999, 'double', 'DOUBLE SCORE!'],
    [2000, 'multiball', 'MULTIBALL!'],
  ];
  for (const [cents, id, effect] of cases) {
    const { game, feed, moments, ballOn, viewer, done } = aGame();
    try {
      ballOn('zed');
      game.handle(supportFrom('ana', cents));
      const ana = viewer('ana');
      assert.deepEqual(moments().map((m) => [m.id, m.by?.name]), [[id, 'ana']], `${cents}: ${id}, naming ana`);
      assert.equal(feed().at(-1)?.tone, 'gift');
      assert.equal(feed().at(-1)?.color, ana.color);
      assert.match(feed().at(-1)?.text ?? '', cents === undefined ? /^ana subscribed: / : /^ana sent a \$/);
      assert.equal(game.supportEffect({ kind: 'gift', tier: 1 }), effect, `${cents}: the card`);
      assert.equal(game.supportEffect({ kind: 'gift', tier: 1 }), null, 'once');
    } finally {
      done();
    }
  }
});

test("support whose hype can't happen gives way to the next that can", () => {
  const { game, moments, done } = aGame();
  try {
    game.handle(supportFrom('ana', 50)); // no ball to nudge: a saver, waiting
    assert.deepEqual(game.state().waiting, ['saver']);
    assert.equal(game.supportEffect({ kind: 'gift', tier: 1 }), 'BALL SAVER!');
    game.handle(supportFrom('ben', 2000)); // no ball for multiball: double
    assert.equal(game.supportEffect({ kind: 'gift', tier: 4 }), 'DOUBLE SCORE!');
    game.handle(supportFrom('cal')); // the saver already waits: double
    assert.equal(moments().at(-1)?.id, 'double');
    assert.equal(game.supportEffect({ kind: 'sub', tier: 2 }), 'DOUBLE SCORE!');
  } finally {
    done();
  }
});

test('a bought multiball during a mode leaves the mode running; during the finale it is refused as multiball already on', () => {
  const { game, run, ballOn, bought, done } = aGame();
  const was = process.env.PINBALL_TOYS;
  /** Every ball on the table kept still at a spot of its own for `seconds` (none drains, hits a toy or sits stuck). */
  const still = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const lift = Math.floor(game.sim.time) % 2 ? 0.4 : 0;
      [...game.sim.items.values()].forEach((b, k) => {
        b.body.setTranslation({ x: [-0.4, 0.4, -1.2][k], y: TABLE.ballRadius, z: [7.4, 9.0, 9.0][k] + lift }, true);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      });
      run(DT);
    }
  };
  /** Ball `id` down the drain, as the table drains one. */
  const drain = (id: number) => {
    const body = game.sim.items.get(id)!.body;
    body.setTranslation({ x: -0.4, y: TABLE.ballRadius, z: TABLE_IN_USE.drainZ - 0.05 }, true);
    body.setLinvel({ x: 0, y: 0, z: -5 }, true);
    run(DT);
    assert.ok(!game.sim.items.has(id), `ball ${id} drained`);
  };
  const mode = () => game.state().quest.mode;
  try {
    const ball = ballOn('ana');
    (game.sim as any).report({ kind: 'bank', id: 'bank-horus', ball });
    run(DT);
    assert.equal(mode()?.god, 'horus', 'the Horus bank matched starts Falcon Strike');
    assert.equal(game.buyHype('multiball', bought('ben', 200)), null, 'multiball bought during it');
    still(RULES.maxExtraBalls * 0.6 + 0.5);
    assert.equal(game.sim.items.size, 1 + RULES.maxExtraBalls, 'its balls came');
    assert.equal(mode()?.god, 'horus', 'the mode runs on through it');
    // That multiball over (the balls it brought drained, past their savers), the mode still runs.
    still(RULES.ballSaverStart);
    for (const id of [...game.sim.items.keys()].filter((id) => id !== ball)) drain(id);
    assert.equal(game.state().multiball, false, 'one ball left: multiball is over');
    assert.equal(mode()?.god, 'horus', 'and the mode runs on after it');
    assert.equal(mode()?.running, true);
    // The finale's own multiball (here the dev host's quest switch starts the finale; pinball-test plays it through the
    // table): one bought then is refused.
    process.env.PINBALL_TOYS = '1';
    game.action({ kind: 'quest', start: 'finale' });
    assert.notEqual(game.state().quest.finale, null, 'the finale runs');
    assert.equal(game.state().multiball, true, 'with its multiball');
    const late = bought('cal', 200);
    assert.equal(game.buyHype('multiball', late), 'multiball is already on');
    assert.equal(late.refunds, 0, 'the city gives the coins back, not the game');
  } finally {
    if (was === undefined) delete process.env.PINBALL_TOYS;
    else process.env.PINBALL_TOYS = was;
    done();
  }
});

test('support never gives anything back, and the card names nothing for what the game never saw', () => {
  const { game, feed, done } = aGame();
  try {
    assert.equal(game.supportEffect({ kind: 'gift', tier: 4 }), null, 'nothing seen');
    game.handle({ kind: 'chat', platform: 'youtube', userId: 'ana', name: 'ana', text: 'left' });
    assert.equal(game.supportEffect({ kind: 'sub', tier: 2 }), null, 'a chat line sets nothing off');
    game.handle(supportFrom('ana')); // a saver, waiting
    game.resetMachine();
    assert.ok(!feed().some((f) => f.text.includes('coins back')), 'no coins went back');
  } finally {
    done();
  }
});

// --- Chat's events: the sandstorm, Pharaoh's curse and the summoned mummy ---

test("a sandstorm sets the wind for 10 s on the table's clock, a second adds 10 s in the same direction, and it ends calm", () => {
  const { game, sent, hold, states, ballOn, bought, done } = aGame();
  try {
    ballOn('ana');
    // Every wind the game sets, with the table's time it was set at.
    const winds: [t: number, ax: number][] = [];
    const setWind = game.sim.setWind.bind(game.sim);
    game.sim.setWind = (ax: number) => {
      winds.push([game.sim.time, ax]);
      setWind(ax);
    };
    hold(0.5);
    assert.ok(winds.length > 0 && winds.every(([, ax]) => ax === 0), 'no wind before the storm');
    assert.equal(game.state().events.sandstorm, null);
    const start = game.sim.time;
    assert.equal(game.buyHype('sandstorm', bought('ben', 75)), null);
    const first = game.state().events.sandstorm!;
    near(first.until - start, RULES.sandstormHype, 'a storm 10 s ahead');
    assert.ok(first.dir === 1 || first.dir === -1, `the storm blows along x (${first.dir})`);
    winds.length = 0;
    hold(3);
    for (const [t, ax] of winds) assert.equal(ax, gust(t, start, first.until, first.dir), `the wind at ${t}`);
    assert.ok(winds.some(([, ax]) => Math.sign(ax) === first.dir), "it blows the storm's way");
    // A second storm adds its 10 s to the first's end, and keeps the way it blows and its start.
    game.action(hypeAction('sandstorm'));
    const second = game.state().events.sandstorm!;
    near(second.until - first.until, RULES.sandstormHype, 'a second adds 10 s');
    assert.equal(second.dir, first.dir, 'in the same direction');
    winds.length = 0;
    hold(second.until - game.sim.time - 0.1);
    for (const [t, ax] of winds) assert.equal(ax, gust(t, start, second.until, second.dir), `the wind at ${t}`);
    assert.notEqual(game.state().events.sandstorm, null, 'still on just before its end');
    // Its end is sent to the stages (nothing else changes on the table meanwhile), and the wind is calm after it.
    const mark = sent.length;
    winds.length = 0;
    hold(0.3);
    assert.equal(game.state().events.sandstorm, null, 'over');
    assert.ok(states(mark).some((s) => s.events.sandstorm === null), "the storm's end is sent");
    assert.equal(winds.at(-1)?.[1], 0, 'calm');
    assert.equal((game.sim as any).windAx, 0, 'no wind left on the table');
  } finally {
    done();
  }
});

test("a curse swaps chat's left and right for its time, the auto-save keeps its sides, and the flipper still gets the credit", () => {
  const { game, hold, ballOn, bought, done } = aGame();
  try {
    const ball = ballOn('ana');
    const chatUp = () => (game as any).chatUp as { left: number; right: number };
    const autoUp = () => (game as any).autoUp as { left: number; right: number };
    const say = (name: string, text: string) => game.handle({ kind: 'chat', platform: 'youtube', userId: name, name, text });
    assert.equal(game.buyHype('curse', bought('ben', 100)), null);
    const curse = game.state().events.curse!;
    near(curse.until - game.sim.time, RULES.curseHype, 'a curse 10 s ahead');
    say('cal', 'left');
    assert.ok(chatUp().right > game.sim.time && chatUp().left < game.sim.time, "cal's left flips the right flipper");
    assert.equal(game.flipperCount(ball), 1, 'and cal is counted on the ball');
    hold(RULES.flipHold + 0.1);
    say('dan', 'right');
    assert.ok(chatUp().left > game.sim.time && chatUp().right < game.sim.time, "dan's right flips the left flipper");
    assert.equal(game.flipperCount(ball), 2, 'and dan is counted too');
    // A second curse adds 10 s to the first's end.
    game.action(hypeAction('curse'));
    near(game.state().events.curse!.until - curse.until, RULES.curseHype, 'a second adds 10 s');
    // The auto-save flips the flipper the ball is near, as it always does: a ball by the left flipper, the left.
    const nearFlipper = game.sim.nearFlipper;
    game.sim.nearFlipper = () => 'left';
    try {
      hold(RULES.autoSaveAfter + 1);
      assert.equal(game.autoSaving, true);
      assert.ok(autoUp().left > -Infinity, 'the auto-save flipped the left');
      assert.equal(autoUp().right, -Infinity, 'and never the right');
    } finally {
      game.sim.nearFlipper = nearFlipper;
    }
    hold(game.state().events.curse!.until - game.sim.time + 0.1);
    assert.equal(game.state().events.curse, null, 'the curse is over');
    say('cal', 'left');
    assert.ok(chatUp().left > game.sim.time, 'left is left again');
  } finally {
    done();
  }
});

test('the summoned mummy rises, its third hit pays 10,000 undoubled to that ball with a summonDown cue, and after 20 s it goes down unpaid', () => {
  const { game, sent, hold, cues, ballOn, bought, done } = aGame();
  try {
    const ball = ballOn('ana');
    const score = () => game.state().balls[0].score;
    const mummyBit = 1 << TABLE_IN_USE.targets.indexOf(MUMMY);
    const hit = () => {
      reportHit(game, ball);
      hold(DT);
    };
    game.action(hypeAction('double'));
    assert.equal(game.buyHype('mummy', bought('ben', 150)), null);
    near(game.state().events.mummy!.until - game.sim.time, RULES.mummyHype, 'the mummy up for 20 s');
    assert.equal(game.toyWanted('mummy'), true, 'the mummy is asked up');
    hold(0.2);
    assert.equal(game.sim.targetsDown() & mummyBit, 0, 'and it has risen');
    const before = score();
    const mark = sent.length;
    hit();
    hit();
    assert.equal(score() - before, 2 * 2 * MUMMY.points, 'its hits score as ever, doubled under double score');
    assert.equal(game.state().events.mummy !== null, true, 'still up after two');
    hit();
    assert.equal(score() - before, 3 * 2 * MUMMY.points + RULES.summonPrize, 'the third pays 10,000 more, not doubled');
    const said = cues(mark);
    const downs = said.filter((c) => c.cue === 'summonDown');
    assert.equal(downs.length, 1, 'one summonDown cue');
    const third = said.filter((c) => c.cue === 'toyHit').at(-1)!;
    assert.deepEqual(downs[0], { kind: 'pinballCue', cue: 'summonDown', value: RULES.summonPrize, x: (third as any).x, z: (third as any).z, at: third.at });
    assert.equal((third as any).down, true, 'the third hit put it down');
    assert.equal(game.state().events.mummy, null, 'the summon is over');
    assert.equal(game.toyWanted('mummy'), false, 'and the mummy asked down');

    // Summoned again and left alone, it goes down after its 20 s, paying nothing.
    assert.equal(game.buyHype('mummy', bought('cal', 150)), null);
    const s = score();
    const mark2 = sent.length;
    hold(RULES.mummyHype - 0.2);
    assert.notEqual(game.state().events.mummy, null, 'up till its time is over');
    assert.equal(game.toyWanted('mummy'), true);
    hold(0.4);
    assert.equal(game.state().events.mummy, null, 'over after 20 s');
    assert.equal(game.toyWanted('mummy'), false, 'and down');
    assert.ok(!cues(mark2).some((c) => c.cue === 'summonDown'), 'no summonDown');
    assert.equal(score(), s, 'and nothing paid');
  } finally {
    done();
  }
});

test('each event is refused with no ball, and the mummy while up, in its mode and in the finale; the buyer is refunded and the feed is quiet', () => {
  const { game, sent, feed, hold, ballOn, bought, done } = aGame();
  try {
    /** A bought press refused with `why`: nothing sent (no line, no moment, no state), and the game gives nothing back. */
    const refused = (id: string, why: string) => {
      const p = bought('ben', 100);
      const mark = sent.length;
      assert.equal(game.buyHype(id, p), why, `${id}: ${why}`);
      assert.equal(sent.length, mark, `${id}: the feed is quiet and nothing is sent`);
      assert.equal(p.refunds, 0, `${id}: the city gives the coins back, not the game`);
    };
    for (const id of ['sandstorm', 'curse', 'mummy']) {
      refused(id, "there's no ball on the table");
      game.action(hypeAction(id));
      assert.deepEqual(last(feed()), ["There's no ball on the table.", 'info'], `${id}: the streamer is told`);
    }
    assert.deepEqual(game.state().events, NO_EVENTS);
    assert.equal(game.toyWanted('mummy'), false);

    // The mummy summoned already.
    let ball = ballOn('ana');
    assert.equal(game.buyHype('mummy', bought('ben', 150)), null);
    refused('mummy', 'the mummy is up already');
    game.action(hypeAction('mummy'));
    assert.deepEqual(last(feed()), ['The mummy is up already.', 'info']);

    // In The Mummy Wakes, and in the finale.
    game.resetMachine();
    ball = ballOn('ana');
    reportBank(game, ball, 'ankh');
    hold(DT);
    assert.equal(game.state().quest.mode?.god, 'ankh', 'The Mummy Wakes runs');
    refused('mummy', 'the mummy is in its mode');
    game.action(hypeAction('mummy'));
    assert.deepEqual(last(feed()), ['The mummy is in its mode.', 'info']);
    withDevSwitches(() => game.action({ kind: 'quest', start: 'finale' }));
    assert.notEqual(game.state().quest.finale, null, 'the finale runs');
    refused('mummy', 'the mummy is in the finale');
    game.action(hypeAction('mummy'));
    assert.deepEqual(last(feed()), ['The mummy is in the finale.', 'info']);
    assert.equal(game.state().events.mummy, null, 'none of them summoned it');
  } finally {
    done();
  }
});

test('the summoned mummy is allowed in Sun Chase, and its hits are no Sun Chase shots', () => {
  const { game, hold, cues, ballOn, bought, done } = aGame();
  try {
    const ball = ballOn('ana');
    reportBank(game, ball, 'ra');
    hold(DT);
    assert.equal(game.state().quest.mode?.god, 'ra', 'Sun Chase runs');
    assert.equal(game.buyHype('mummy', bought('ben', 150)), null, 'the mummy is summoned in it');
    hold(0.2);
    for (let i = 0; i < 3; i++) {
      reportHit(game, ball);
      hold(DT);
    }
    assert.equal(game.state().quest.mode?.god, 'ra', 'Sun Chase runs on');
    assert.equal(game.state().quest.mode?.progress, 0, 'and none of the hits was a shot');
    assert.equal(cues().filter((c) => c.cue === 'summonDown').length, 1, 'the third paid the summon');
    assert.equal(game.state().events.mummy, null);
  } finally {
    done();
  }
});

test('The Mummy Wakes or the finale starting takes the summoned mummy over: no 10,000, its hits from none, and the mode can still be won', () => {
  const { game, sent, hold, cues, ballOn, bought, done } = aGame();
  try {
    const ball = ballOn('ana');
    const hit = () => {
      reportHit(game, ball);
      hold(DT);
    };
    assert.equal(game.buyHype('mummy', bought('ben', 150)), null);
    hold(0.2);
    hit();
    hit();
    // The Mummy Wakes starts with the summoned mummy two hits down: the quest has it now, from none.
    reportBank(game, ball, 'ankh');
    hold(DT);
    assert.equal(game.state().quest.mode?.god, 'ankh', 'The Mummy Wakes runs');
    assert.equal(game.state().events.mummy, null, 'the summon is over');
    assert.equal((game as any).mummyHits, 0, "the mummy's hits start again from none");
    assert.equal(game.toyWanted('mummy'), true, 'and it stays up, for the mode');
    let mark = sent.length;
    hit();
    assert.equal(game.toyWanted('mummy'), true, 'one hit does not put it down');
    hit();
    hit();
    assert.ok(game.state().quest.done.includes('ankh'), 'three hits win the mode');
    assert.ok(cues(mark).some((c) => c.cue === 'modeWon'), 'with its moment');
    assert.ok(!cues(mark).some((c) => c.cue === 'summonDown'), 'and no 10,000');

    // The finale starting takes it over too.
    assert.equal(game.buyHype('mummy', bought('cal', 150)), null, 'summoned again, with the mode over');
    hold(0.2);
    hit();
    withDevSwitches(() => game.action({ kind: 'quest', start: 'finale' }));
    assert.notEqual(game.state().quest.finale, null, 'the finale runs');
    assert.equal(game.state().events.mummy, null, 'the summon is over');
    assert.equal((game as any).mummyHits, 0, 'its hits from none');
    mark = sent.length;
    for (let i = 0; i < 3; i++) hit();
    assert.ok(!cues(mark).some((c) => c.cue === 'summonDown'), 'no 10,000 in the finale');
    assert.ok(cues(mark).some((c) => c.cue === 'toyHit' && c.down), 'the third hit put it down, by the finale');
  } finally {
    done();
  }
});

test('the Reset ends every event and pays nothing; a restart brings none back', () => {
  const { game, economy, sent, hold, cues, file, ballOn, done } = aGame();
  try {
    ballOn('ana');
    for (const id of ['sandstorm', 'curse', 'mummy']) game.action(hypeAction(id));
    hold(0.5);
    const on = game.state().events;
    assert.ok(on.sandstorm && on.curse && on.mummy, 'all three on');
    // A restart in the middle of them: saved, and a new game read from the file has none. The file itself holds none
    // of them, so a new game can't have read them back and dropped them by luck.
    game.save();
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(saved).sort(), ['highScores', 'quest'], 'the save holds the high scores and the quest');
    assert.ok(!('events' in saved), 'the save holds no events');
    assert.ok(!/sandstorm|curse|summon|wind/i.test(JSON.stringify(saved)), `the save holds no event and no summon: ${JSON.stringify(saved)}`);
    const again = new PinballGame(roomInfo(entry.id, entry.label), economy, { send: () => {} }, file);
    again.load();
    assert.deepEqual(again.state().events, NO_EVENTS, 'a restart brings none back');
    assert.equal(again.toyWanted('mummy'), false, 'nor the summoned mummy');
    const mark = sent.length;
    game.resetMachine();
    assert.deepEqual(game.state().events, NO_EVENTS, 'the Reset ends them all');
    assert.equal(game.toyWanted('mummy'), false, 'the mummy down');
    assert.equal((game.sim as any).windAx, 0, 'the wind calm');
    ballOn('ben');
    hold(1);
    game.handle({ kind: 'chat', platform: 'youtube', userId: 'cal', name: 'cal', text: 'left' });
    const chatUp = (game as any).chatUp as { left: number; right: number };
    assert.ok(chatUp.left > game.sim.time && chatUp.right < game.sim.time, 'left is left');
    assert.ok(!cues(mark).some((c) => c.cue === 'summonDown'), 'no summon paid');
    assert.ok(!sent.slice(mark).some((m) => m.t === 'score'), 'nobody paid');
  } finally {
    done();
  }
});

test("each event's title names its buyer, and the state shows it to a page opened late", () => {
  const { game, feed, moments, ballOn, bought, done } = aGame();
  try {
    ballOn('ana');
    const sales: [id: string, name: string, line: string][] = [
      ['sandstorm', 'ben', 'ben bought a sandstorm! The sand blows.'],
      ['curse', 'cal', "cal bought Pharaoh's curse! Left is right."],
      ['mummy', 'dan', 'dan bought the mummy! Three hits put it down.'],
    ];
    for (const [id, name, line] of sales) {
      const p = bought(name, 100);
      assert.equal(game.buyHype(id, p), null, id);
      assert.deepEqual(moments().at(-1), { kind: 'pinballHype', id, at: game.sim.time, by: { name, color: p.user.color } }, `${id}'s moment names ${name}`);
      assert.deepEqual([feed().at(-1)?.text, feed().at(-1)?.tone, feed().at(-1)?.color], [line, 'milestone', p.user.color], `${id}'s line`);
    }
    // The streamer's press has its own line.
    game.action(hypeAction('sandstorm'));
    assert.equal(feed().at(-1)?.text, 'Sandstorm! The sand blows.');
    const hello = game.hello();
    assert.ok(hello.t === 'hello');
    const late = pinballStateOf(hello.machine)!;
    const now = game.state().events;
    assert.deepEqual(late.events, now, "hello's state has the events");
    assert.ok(now.sandstorm && now.curse && now.mummy, 'all three');
    assert.deepEqual(Object.keys(now.sandstorm), ['until', 'dir']);
    assert.deepEqual(Object.keys(now.curse), ['until']);
    assert.deepEqual(Object.keys(now.mummy), ['until']);
  } finally {
    done();
  }
});

// `npm run pinball-hype-test -- <words>` runs only the tests whose names hold them.
const only = process.argv.slice(2).join(' ');
if (only) tests.splice(0, tests.length, ...tests.filter(([name]) => name.includes(only)));
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}`);
    console.log(err);
  }
}
if (failed) process.exit(1);
console.log(`pinball-hype-test: ${tests.length} tests passed`);
