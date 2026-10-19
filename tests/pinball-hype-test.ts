// Tests the pinball's four hype buttons (server/game.ts, action and buyHype) and paid support (handle, supportEffect),
// headlessly with the real physics and wallet, as the claw's claw-hype-test does. The streamer presses each for free;
// chat buys each (the city takes the coins, then calls buyHype). Multiball starts now, with a ball on the table, and is
// refused without one. The ball saver lasts 15 s, and with no ball on the table it waits for the next launch (the panel
// marks it Ready). Double score lasts 30 s, and a second press adds 30. A nudge jolts the balls, and is refused with none.
// A purchase that waits is given back by a reset (a line only when the city says coins really went back), and a reset
// clears a bought saver and double score too. Subs and gifts press one for free by their size, or the next that can
// happen; the line thanks the supporter, and the city's card names what it set off. Multiball bought during one of the
// quest's modes leaves the mode running, and during the finale (whose multiball is on) it is refused.
// Usage: npm run pinball-hype-test
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy, hypeAction, type HypePurchase, initPhysics, roomInfo, type StreamEvent, type User } from '@kit/server';
import type { FeedItem, ServerMsg } from '@kit/shared';
import { entry } from '../src/entry';
import { PinballGame } from '../src/server/game';
import { DT } from '../src/server/sim';
import { type PinballHypeMsg, pinballHypeOf, RULES } from '../src/shared/pinball';
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
  const done = () => {
    economy.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may still hold the database open; the temp folder is left.
    }
  };
  return { game, economy, sent, run, feed, moments, viewer, ballOn, bought, done };
}
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
