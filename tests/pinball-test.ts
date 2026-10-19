// Tests the pinball game (server/game.ts) headlessly, with the real physics and wallet: the line of viewers' balls, the
// flippers and the auto-save, paying a drained ball (the owner sharing the 30% when they flipped), multiball, the ball
// saver, the table's clock, a stuck ball (nudged, then launched again), flip words only while the table runs, the high
// scores and the reset, the parts of the pyramid, and the quest's toys (the game raises, opens and swings them as it is
// asked, each waiting for a ball in its way; the mummy goes down on its third hit; a ball in the tomb scores and isn't
// stuck; a reset puts every toy away; the dev host's toy action works only with PINBALL_TOYS; each hit on a toy is a
// cue to the stages, which pinballCueOf reads), and the quest played through the game (a bank matched starts its
// god's mode and raises its toy, whose clock runs only while a ball is in play; each mode won through the table, its
// prize to the ball that won it; Sun Chase's shots by the switches; a mode run out of time; the finale, with the lock's
// multiball or its own, and a house ball's jackpot; a restart and the Reset in the middle of it all; its moments as
// cues; the dev host's quest action). Each step builds on the last, as the claw's claw-test does. The quest's numbers
// come from QUEST, so tuning them changes one place.
// Usage: npm run pinball-test (or npx tsx tests/pinball-test.ts)
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy, hypeAction, initPhysics, log, roomInfo, type User } from '@kit/server';
import type { ServerMsg } from '@kit/shared';
import { entry } from '../src/entry';
import { MUMMY_HITS, ORBIT_ROUND, PinballGame, type Toy } from '../src/server/game';
import { DT, PinballSim } from '../src/server/sim';
import { type God, GODS, LIT, type PinballCueMsg, pinballCueOf, pinballHypeOf, type PinballState, pinballStateOf, type PinballToyHit, QUEST, RULES, tombPrize, TOY } from '../src/shared/pinball';
import { TABLE_IN_USE, TABLE, isLockTarget, type Target } from '../src/shared/table';

await initPhysics();

// The same run every time: Math.random seeded with the claw's tests' generator (16807), and the clock starting at the
// same moment and moved along with the physics.
let seed = 1;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
let now = Date.UTC(2026, 9, 17);
Date.now = () => now;

const dir = mkdtempSync(join(tmpdir(), 'coinop-pinball-'));
const economy = new Economy(dir);
const msgs: ServerMsg[] = [];
const room = roomInfo(entry.id, entry.label);
const saveFile = join(dir, 'machine-pinball.json');
let game = new PinballGame(room, economy, { send: (m) => msgs.push(m) }, saveFile);
game.load();

/** Runs the machine for `seconds` of table time, publishing a few times a second as the server does. */
function run(seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    each?.();
    game.step();
    now += DT * 1000;
    if (i % 15 === 0) game.publish(now);
  }
  game.publish(now);
}
const feed = () => msgs.filter((m): m is Extract<ServerMsg, { t: 'feed' }> => m.t === 'feed').map((m) => m.item.text);
const lastFeed = () => feed().at(-1);
const viewer = (id: string, name: string): User => economy.touch('youtube', id, name).user;
const say = (user: User, text: string) => game.handle({ kind: 'chat', platform: 'youtube', userId: user.platformUserId, name: user.name, text });
const balance = (u: User) => economy.get(u.id)?.balance ?? 0;
/** The id of the ball on the table that's this viewer's (null: the house's), if there is one. */
const ballOf = (u: User | null) => [...game.sim.items.values()].find((b) => b.owner === (u?.id ?? null))?.id;
const R = TABLE.ballRadius;
/** Puts a ball at (x, z) on the playfield, moving at (vx, vz). */
function put(id: number, x: number, z: number, vx = 0, vz = 0): void {
  const body = game.sim.items.get(id)!.body;
  body.setTranslation({ x, y: R, z }, true);
  body.setLinvel({ x: vx, y: 0, z: vz }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
/** Holds a ball still at (x, z) for `seconds`, putting it back there before each step. */
const hold = (id: number, x: number, z: number, seconds: number) => run(seconds, () => game.sim.items.has(id) && put(id, x, z));
/** Drains a ball the way the table does: down the gap between the flippers and past the drain. */
function drain(id: number): void {
  put(id, -0.4, TABLE_IN_USE.drainZ - 0.05, 0, -5);
  run(DT);
  assert.ok(!game.sim.items.has(id), `ball ${id} drained`);
}
/** Where a ball sits on the left flipper at rest, rolling toward its tip. */
const onLeftFlipper = (id: number) => put(id, -1.2, 2.1);
const left = TABLE_IN_USE.flippers.find((f) => f.side === 'left')!;
const right = TABLE_IN_USE.flippers.find((f) => f.side === 'right')!;
/** Runs until there's a ball on the table (at most 5 s), and returns its id. */
function tableBall(): number {
  for (let i = 0; i < 300 && game.sim.items.size === 0; i++) run(DT);
  const id = [...game.sim.items.keys()][0];
  assert.ok(id !== undefined, 'a ball on the table');
  return id;
}

let ana: User, ben: User, cal: User, dan: User;

const steps: [string, () => void][] = [];
const step = (name: string, fn: () => void) => steps.push([name, fn]);

step('ball lines viewers up, one ball each', () => {
  ana = viewer('ana', 'Ana');
  ben = viewer('ben', 'Ben');
  cal = viewer('cal', 'Cal');
  dan = viewer('dan', 'Dan');
  say(ana, 'ball');
  assert.equal(lastFeed(), 'Ana is in line (1st).');
  say(ben, '!ball');
  say(cal, 'BALL please');
  assert.equal(lastFeed(), 'Cal is in line (3rd).');
  assert.deepEqual(game.state().line.map((l) => l.name), ['Ana', 'Ben', 'Cal']);
  assert.equal(game.queued, 3);
  say(ben, 'ball');
  assert.equal(game.state().line.length, 3, 'a second ball is not added');
  assert.equal(lastFeed(), 'Ben already has a ball.');
});

step('the first ball launches after its moment', () => {
  run(DT);
  assert.equal(game.state().phase, 'launching');
  assert.equal(lastFeed(), 'Ana is up!');
  assert.equal(game.sim.items.size, 0, 'not yet');
  run(RULES.launchDelay + 0.1);
  const { balls, line, phase } = game.state();
  assert.equal(phase, 'playing');
  assert.equal(balls.length, 1);
  assert.equal(balls[0].owner, ana.id);
  assert.equal(balls[0].name, 'Ana');
  assert.deepEqual(line.map((l) => l.name), ['Ben', 'Cal']);
  const spawn = msgs.find((m): m is Extract<ServerMsg, { t: 'spawn' }> => m.t === 'spawn');
  assert.ok(spawn, 'the stages were told of the ball');
  assert.equal(spawn.body.owner, ana.id, "with its owner, for the ball's name tag");
  const machine = msgs.filter((m) => m.t === 'machine').at(-1) as { msg: { kind: string; state: { phase: string } } } | undefined;
  assert.equal(machine?.msg.kind, 'pinball');
  assert.equal(machine?.msg.state.phase, 'playing', 'the panel and the stage were sent the state');
});

step('left and right flip', () => {
  say(dan, 'left');
  run(0.1);
  assert.equal(game.sim.flipperAngle('left'), left.upDeg);
  assert.equal(game.sim.flipperAngle('right'), right.restDeg, 'only the left');
  run(RULES.flipHold + 0.1);
  assert.equal(game.sim.flipperAngle('left'), left.restDeg, 'back down');
  say(dan, 'r');
  run(0.1);
  assert.equal(game.sim.flipperAngle('right'), right.upDeg);
  run(RULES.flipHold + 0.1);
  assert.equal(game.sim.flipperAngle('right'), right.restDeg);
});

step('a flood of flips', () => {
  const ball = ballOf(ana)!;
  assert.ok(ball !== undefined, "Ana's ball is still on the table");
  let said = 0;
  run(1, () => {
    for (let i = 0; i < 9 && said < 500; i++, said++) say(dan, 'left');
  });
  assert.equal(said, 500);
  assert.equal(game.flipperCount(ballOf(ana)!), 1, 'Dan is counted once');
});

step('the auto-save takes over after 3 s of quiet, and hands back at a word', () => {
  assert.equal(game.autoSaving, false, 'chat just flipped');
  run(RULES.autoSaveAfter - 0.1);
  assert.equal(game.autoSaving, false);
  run(0.2);
  assert.equal(game.autoSaving, true, 'quiet for 3 s');
  let flipped = false;
  for (let attempt = 0; attempt < 6 && !flipped; attempt++) {
    onLeftFlipper(tableBall());
    run(0.3, () => {
      if (game.sim.flipperAngle('left') !== left.restDeg) flipped = true;
    });
  }
  assert.ok(flipped, 'the game flipped by itself');
  run(0.5);
  const ball = tableBall();
  say(dan, 'right');
  assert.equal(game.autoSaving, false, 'chat has it back');
  onLeftFlipper(ball);
  let leftUp = false;
  run(RULES.autoSaveAfter - 0.1, () => {
    if (game.sim.flipperAngle('left') !== left.restDeg) leftUp = true;
  });
  assert.ok(!leftUp, 'no flip by itself for 3 s');
  assert.equal(game.autoSaving, false);
  run(0.2);
  assert.equal(game.autoSaving, true);
});

let fay: User;
step('a drained ball pays 70/30', () => {
  game.resetMachine();
  assert.equal(game.sim.items.size, 0);
  fay = viewer('fay', 'Fay');
  say(fay, 'ball');
  run(RULES.launchDelay + 0.2);
  const ball = ballOf(fay)!;
  assert.ok(ball !== undefined, "Fay's ball launched");
  // Past the ball saver, so the drain counts.
  hold(ball, -0.4, 8, RULES.ballSaverStart + 0.1);
  say(ben, 'left');
  say(cal, 'right right');
  assert.equal(game.flipperCount(ball), 2);
  game.addPoints(ball, 10 * RULES.pointsPerCoin);
  const before = [fay, ben, cal].map(balance);
  const scores = msgs.length;
  drain(ball);
  assert.deepEqual([fay, ben, cal].map((u, i) => balance(u) - before[i]), [8, 1, 1], 'Fay 7 and the remainder, the flippers 1 each');
  assert.ok(feed().includes(`Fay's ball: ${(10 * RULES.pointsPerCoin).toLocaleString('en-US')} points, 10 coins.`));
  assert.deepEqual(game.state().lastResult, { name: 'Fay', points: 10 * RULES.pointsPerCoin, coins: 10 });
  const paid = msgs.slice(scores).filter((m): m is Extract<ServerMsg, { t: 'score' }> => m.t === 'score');
  assert.deepEqual(paid.map((m) => [m.name, m.amount]), [['Fay', 8], ['Ben', 1], ['Cal', 1]]);
  assert.ok(msgs.slice(scores).some((m) => m.t === 'despawn' && m.id === ball), 'the stages were told it drained');
  assert.equal(game.state().phase, 'idle', 'nobody else in line');
});

step('an owner who flipped shares the 30% too', () => {
  const pat = viewer('pat', 'Pat');
  say(pat, 'ball');
  run(RULES.launchDelay + 0.2);
  const ball = ballOf(pat)!;
  assert.ok(ball !== undefined, "Pat's ball launched");
  hold(ball, -0.4, 8, RULES.ballSaverStart + 0.1);
  say(pat, 'left');
  say(ben, 'left');
  say(cal, 'right');
  assert.equal(game.flipperCount(ball), 3, 'Pat counted with the others');
  game.addPoints(ball, 20 * RULES.pointsPerCoin);
  const before = [pat, ben, cal].map(balance);
  drain(ball);
  // 20 coins: 14 to Pat as the owner, and the 6 left split by the 3 who flipped, Pat among them: 2 each.
  assert.deepEqual([pat, ben, cal].map((u, i) => balance(u) - before[i]), [16, 2, 2], 'Pat 14 and an equal share, the others 2 each');
  assert.equal(game.state().phase, 'idle');
});

let gus: User, hal: User;
let held: number;
step('multiball pulls from the line, then the house', () => {
  gus = viewer('gus', 'Gus');
  hal = viewer('hal', 'Hal');
  say(gus, 'ball');
  run(RULES.launchDelay + 0.2);
  say(hal, 'ball');
  held = ballOf(gus)!;
  game.knockAllTargets(held);
  assert.equal(game.state().lockLit, true, 'both drop targets down light the lock');
  put(held, TABLE_IN_USE.lock.x, TABLE_IN_USE.lock.z);
  run(DT);
  assert.equal(game.state().lockLit, false, 'the lock took the ball');
  assert.equal(game.state().multiball, true);
  run(2);
  assert.equal(game.sim.items.size, 3, '3 balls on the table');
  assert.deepEqual([...game.sim.items.values()].map((b) => b.owner).sort(), [gus.id, hal.id, null].sort());
  assert.equal(game.state().line.length, 0, "Hal's ball came from the line");
  const p = game.sim.items.get(held)!.body.translation();
  assert.ok(Math.hypot(p.x - TABLE_IN_USE.lock.x, p.z - TABLE_IN_USE.lock.z) < 0.01, "Gus's ball is held in the lock");
});

step('a house ball pays nobody', () => {
  const house = ballOf(null)!;
  // Past its ball saver, so the drain counts.
  hold(house, -0.4, 8, RULES.ballSaverStart + 0.1);
  // Whatever the ball scored on its way up (a top lane) counts too.
  const onTheWay = game.state().balls.find((b) => b.owner === null)!.score;
  game.addPoints(house, 5 * RULES.pointsPerCoin);
  const before = [ana, ben, cal, dan, fay, gus, hal].map(balance);
  const scores = msgs.filter((m) => m.t === 'score').length;
  drain(house);
  assert.deepEqual([ana, ben, cal, dan, fay, gus, hal].map(balance), before);
  assert.equal(msgs.filter((m) => m.t === 'score').length, scores, 'no score popups');
  assert.ok(feed().includes(`The house ball: ${(onTheWay + 5 * RULES.pointsPerCoin).toLocaleString('en-US')} points.`));
  // That was the multiball's last ball but one (or Hal's went first): Gus's ball is let go.
  run(0.5);
  const p = game.sim.items.get(held)?.body.translation();
  assert.ok(!p || Math.hypot(p.x - TABLE_IN_USE.lock.x, p.z - TABLE_IN_USE.lock.z) > 0.2, "Gus's ball left the lock");
});

step("a removed viewer's ball pays nobody", () => {
  const ivy = viewer('ivy', 'Ivy');
  const jon = viewer('jon', 'Jon');
  let ball = ballOf(hal);
  if (ball === undefined) {
    // Hal's ball drained meanwhile: a fresh one, on a clear table.
    game.resetMachine();
    say(hal, 'ball');
    run(RULES.launchDelay + 0.2);
    ball = ballOf(hal)!;
  }
  hold(ball, -0.4, 8, RULES.ballSaverStart + 0.1);
  say(ivy, 'left');
  say(jon, 'left');
  game.addPoints(ball, 10 * RULES.pointsPerCoin);
  economy.remove(hal.id);
  const before = [ivy, jon].map(balance);
  drain(ball);
  // Hal is gone, so his share goes nowhere: Ivy and Jon split what's left of the coins once the owner's share is taken.
  const coins = game.state().lastResult!.coins;
  const each = Math.floor((coins - Math.round(coins * RULES.ownerShare)) / 2);
  assert.ok(each >= 1, 'a share worth having');
  assert.deepEqual([ivy, jon].map((u, i) => balance(u) - before[i]), [each, each], 'the flippers still there are paid');
  assert.equal(economy.get(hal.id), undefined, 'Hal is not brought back');
});

let kim: User;
step('the ball saver gives a quick drain back', () => {
  game.resetMachine();
  kim = viewer('kim', 'Kim');
  say(kim, 'ball');
  run(RULES.launchDelay + 0.2);
  const ball = ballOf(kim)!;
  game.addPoints(ball, 1234);
  const before = balance(kim);
  drain(ball);
  assert.equal(lastFeed(), "Kim's ball is saved!");
  const { balls } = game.state();
  assert.equal(balls.length, 1, 'launched again');
  assert.equal(balls[0].owner, kim.id);
  assert.equal(balls[0].score, 1234, 'with its points');
  assert.equal(balance(kim), before, 'and nothing paid');
});

step("timers run on the table's clock", () => {
  say(kim, 'left');
  const saver = game.state().saverUntil;
  assert.ok(saver !== null && saver > game.sim.time, 'the ball saver is on');
  const nudges = feed().filter((t) => t === 'The table gets a nudge.').length;
  now += 60_000;
  game.step();
  game.publish(now);
  assert.equal(feed().filter((t) => t === 'The table gets a nudge.').length, nudges, 'not nudged as stuck');
  assert.equal(game.state().saverUntil, saver, 'the saver still has its time left');
  assert.ok(game.state().saverUntil! > game.sim.time);
  assert.equal(game.autoSaving, false, "the auto-save hasn't taken over");
});

step('a stuck ball is kicked loose', () => {
  const ball = ballOf(kim)!;
  const nudges = () => feed().filter((t) => t === 'The table gets a nudge.').length;
  const before = nudges();
  hold(ball, -0.4, 8, RULES.stuckSeconds - 0.5);
  assert.equal(nudges(), before, 'not yet');
  hold(ball, -0.4, 8, 1);
  assert.equal(nudges(), before + 1, 'nudged');
});

step('a ball no nudge frees goes back to the plunger lane, with its points and flippers', () => {
  const ball = ballOf(kim)!;
  const nudges = () => feed().filter((t) => t === 'The table gets a nudge.').length;
  const before = nudges();
  const score = game.state().balls.find((b) => b.owner === kim.id)!.score;
  const flippers = game.flipperCount(ball);
  assert.ok(flippers >= 1, 'Kim flipped it');
  const at = msgs.length;
  // Its first nudge was the last step's; two more, then it's taken off and launched again.
  hold(ball, -0.4, 8, 2 * RULES.stuckSeconds - 0.25);
  assert.equal(nudges(), before + 2, 'nudged twice more');
  assert.ok(game.sim.items.has(ball), 'still there');
  hold(ball, -0.4, 8, RULES.stuckSeconds + 0.5);
  assert.equal(nudges(), before + 2, 'no fourth nudge');
  assert.ok(!game.sim.items.has(ball), 'taken off the table');
  const again = ballOf(kim);
  assert.ok(again !== undefined && again !== ball, "Kim's ball launched again");
  assert.equal(game.state().balls.length, 1);
  assert.equal(game.state().balls[0].score, score, 'with its points');
  assert.equal(game.flipperCount(again), flippers, 'and its flippers');
  assert.ok(feed().includes("Kim's ball is stuck: back to the plunger."), 'the feed says so');
  assert.ok(msgs.slice(at).some((m) => m.t === 'despawn' && m.id === ball && m.reason === 'cleared'), 'not a drain');
  assert.ok(!msgs.slice(at).some((m) => m.t === 'score'), 'nothing paid');
});

step("flip words count only while the table runs (another machine's chat isn't the pinball's)", () => {
  const ball = ballOf(kim)!;
  const flippers = game.flipperCount(ball);
  assert.equal(game.autoSaving, true, 'chat quiet for a while');
  // No stage shows the table: the city stops stepping it, while chat goes on (the claw's players say left and right).
  now += 2000;
  const pip = viewer('pip', 'Pip');
  say(pip, 'left');
  assert.equal(game.flipperCount(ball), flippers, 'not counted on the ball');
  assert.equal(game.autoSaving, true, "chat's last word untouched");
  say(pip, 'ball');
  assert.equal(lastFeed(), 'Pip is in line (1st).', '`ball` still lines up while it waits');
  game.step();
  say(pip, 'left');
  assert.equal(game.flipperCount(ball), flippers + 1, 'stepping again, a flip counts');
  assert.equal(game.autoSaving, false);
});

step('the high scores are kept', () => {
  const scores = game.highScores();
  assert.ok(scores.some((s) => s.name === 'Fay' && s.points === 10 * RULES.pointsPerCoin), JSON.stringify(scores));
  assert.ok(!scores.some((s) => s.name === null), 'no house balls');
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1].points >= scores[i].points, 'best first');
  game.save();
  const fresh = new PinballGame(room, economy, { send: () => {} }, saveFile);
  fresh.load();
  assert.deepEqual(fresh.highScores(), scores);
});

step('reset clears the table and the line and pays nobody', () => {
  const lia = viewer('lia', 'Lia');
  const mo = viewer('mo', 'Mo');
  say(lia, 'ball');
  say(mo, 'ball');
  assert.ok(game.sim.items.size >= 1);
  const kims = ballOf(kim);
  assert.ok(kims !== undefined, "Kim's ball is on the table");
  game.addPoints(kims, 50 * RULES.pointsPerCoin);
  const before = [kim, lia, mo].map(balance);
  const at = msgs.length;
  game.resetMachine();
  assert.equal(game.sim.items.size, 0);
  assert.equal(game.state().line.length, 0);
  assert.equal(game.state().phase, 'idle');
  assert.deepEqual([kim, lia, mo].map(balance), before);
  assert.ok(msgs.slice(at).some((m) => m.t === 'despawn' && m.reason === 'cleared'));
  run(RULES.launchDelay + 1);
  assert.equal(game.sim.items.size, 0, 'nothing launches after');
});

step("the panel's remove takes a ball out of the line", () => {
  const ned = viewer('ned', 'Ned');
  const ola = viewer('ola', 'Ola');
  say(ned, 'ball');
  say(ola, 'ball');
  game.action({ kind: 'remove', userId: ola.id });
  assert.deepEqual(game.state().line.map((l) => l.name), ['Ned']);
  game.action({ kind: 'nonsense' });
  game.action(null);
  assert.deepEqual(game.state().line.map((l) => l.name), ['Ned'], 'anything else does nothing');
});

let failed = 0;
// --- The pyramid's parts (banks, drop targets, saucers, centre lamps) ---

/** A fresh table with one ball for this viewer; returns its id. */
function freshBall(user: User): number {
  game.resetMachine();
  say(user, 'ball');
  run(RULES.launchDelay + 0.2);
  return ballOf(user)!;
}
/** Reports a hit the way the sim does, and steps once so the game sees it. */
function hitPart(h: { kind: string; id: string; ball: number }): void {
  (game.sim as any).report(h);
  run(DT);
}
const scoreOf = (user: User) => game.state().balls.find((b) => b.owner === user.id)!.score;
const litBits = () => (game as any).lit() as number;
const pointsOf = (id: string) => TABLE_IN_USE.targets.find((t) => t.id === id)!.points;

step("a matched bank pays its bonus to the ball's owner", () => {
  const lou = viewer('lou', 'Lou');
  const ball = freshBall(lou);
  const bank = TABLE_IN_USE.banks.find((b) => b.id === 'bank-horus')!;
  const before = scoreOf(lou);
  for (const t of bank.targets) hitPart({ kind: 'target', id: t, ball });
  assert.equal(scoreOf(lou) - before, 3 * pointsOf(bank.targets[0]), 'three plaques score their points');
  hitPart({ kind: 'bank', id: bank.id, ball });
  assert.equal(scoreOf(lou) - before, 3 * 300 + 5000);
  assert.equal(lastFeed(), 'Lou matched the Horus bank! +5,000');
  const titles = msgs.filter((m) => m.t === 'machine').map((m) => (m as any).msg).filter((m) => m.kind === 'pinballHype');
  assert.equal(titles.at(-1)?.id, 'bank-horus', "the bank's title went to the stages");
  // Under DOUBLE SCORE the bonus doubles, and so does the feed's number.
  (game as any).doubleUntil = game.sim.time + 30;
  const mid = scoreOf(lou);
  hitPart({ kind: 'bank', id: 'bank-ra', ball });
  assert.equal(scoreOf(lou) - mid, 10000);
  assert.equal(lastFeed(), 'Lou matched the Ra bank! +10,000');
});

step('both drop targets light the lock and come back up a second later, raising only the drop targets', () => {
  const mo = viewer('mo', 'Mo');
  const ball = freshBall(mo);
  const turned = game.sim.targetsTurned();
  let drops = 0;
  let resets = 0;
  const sim = game.sim as any;
  const raise = sim.resetDropTargets.bind(sim);
  const all = sim.resetTargets.bind(sim);
  sim.resetDropTargets = () => (drops++, raise());
  sim.resetTargets = () => (resets++, all());
  hitPart({ kind: 'target', id: 'target-scarab', ball });
  assert.equal(game.state().lockLit, false, 'one drop target is not enough');
  // Plaques are not drop targets: they do not count.
  hitPart({ kind: 'target', id: 'target-ra-1', ball });
  assert.equal(game.state().lockLit, false);
  hitPart({ kind: 'target', id: 'target-eye', ball });
  assert.equal(game.state().lockLit, true, 'both drop targets down light the lock');
  assert.equal(drops, 0, 'they stay down a moment, so the stages show the second one drop');
  run(0.9);
  assert.equal(drops, 0, 'still down most of a second later');
  run(0.2);
  assert.equal(drops, 1, 'the drop targets were raised a second after the second dropped');
  assert.equal(resets, 0, 'the plaques were left as they were');
  assert.equal(game.sim.targetsTurned(), turned);
  delete sim.resetDropTargets;
  delete sim.resetTargets;
});

step('the drop targets wait to come back up while a ball stands where one rises', () => {
  const ole = viewer('ole', 'Ole');
  const ball = freshBall(ole);
  const sim = game.sim as any;
  const drops = TABLE_IN_USE.targets.flatMap((t, i) => (isLockTarget(t) ? [i] : []));
  const bits = drops.reduce((b, i) => b | (1 << i), 0);
  // The pop-ups and the mummy start down, and nothing here raises them: their bits are set all along.
  const rising = TABLE_IN_USE.targets.reduce((b, t, i) => (t.rise ? b | (1 << i) : b), 0);
  assert.deepEqual(drops.map((i) => TABLE_IN_USE.targets[i].id), ['target-scarab', 'target-eye']);
  // Both down, as the physics drops them, and their hits to the game.
  for (const i of drops) {
    sim.targets[i].down = true;
    sim.targets[i].collider.setEnabled(false);
    hitPart({ kind: 'target', id: TABLE_IN_USE.targets[i].id, ball });
  }
  const eye = TABLE_IN_USE.targets[drops[1]];
  hold(ball, eye.x, eye.z, 1.5);
  assert.equal(game.sim.targetsDown(), bits | rising, 'not raised into the ball standing on one');
  put(ball, -0.4, 9);
  run(2 * DT);
  assert.equal(game.sim.targetsDown(), rising, 'up once the ball has gone, the rising targets still down');
});

step("the pop-ups and the mummy don't light the lock", () => {
  const una = viewer('una', 'Una');
  const toys = ['target-popup-1', 'target-popup-2', 'target-popup-3', 'target-mummy'];
  let ball = freshBall(una);
  const before = scoreOf(una);
  for (const id of toys) hitPart({ kind: 'target', id, ball });
  assert.equal(game.state().lockLit, false, "the pop-ups and the mummy aren't the lock's drop targets");
  assert.equal(scoreOf(una) - before, 3 * pointsOf('target-popup-1') + pointsOf('target-mummy'), 'but they score what the table says');
  // The scarab and the eye light it, whatever the toys did before.
  hitPart({ kind: 'target', id: 'target-scarab', ball });
  assert.equal(game.state().lockLit, false, 'one drop target is not enough');
  hitPart({ kind: 'target', id: 'target-eye', ball });
  assert.equal(game.state().lockLit, true, 'the scarab and the eye light it');
  // And they light it alone, with no toy hit: a table cleared, nothing hit but the two.
  ball = freshBall(una);
  assert.equal(game.state().lockLit, false, 'a cleared table has the lock dark');
  hitPart({ kind: 'target', id: 'target-scarab', ball });
  hitPart({ kind: 'target', id: 'target-eye', ball });
  assert.equal(game.state().lockLit, true, 'the two alone light the lock');
  // The toys hit between the two change nothing.
  ball = freshBall(una);
  hitPart({ kind: 'target', id: 'target-scarab', ball });
  for (const id of toys) hitPart({ kind: 'target', id, ball });
  assert.equal(game.state().lockLit, false);
  hitPart({ kind: 'target', id: 'target-eye', ball });
  assert.equal(game.state().lockLit, true);
});

step('the saucer and the magnet score', () => {
  const ned = viewer('ned', 'Ned');
  const ball = freshBall(ned);
  const before = scoreOf(ned);
  hitPart({ kind: 'saucer', id: 'saucer-scarab', ball });
  assert.equal(scoreOf(ned) - before, 750);
  hitPart({ kind: 'saucer', id: 'magnet-ra', ball });
  assert.equal(scoreOf(ned) - before, 1000);
  hitPart({ kind: 'spinner', id: 'spinner-right', ball });
  assert.equal(scoreOf(ned) - before, 1010, 'the right spinner pays per turn');
});

step('all four centre lamps pay 1,000 and go out', () => {
  const oli = viewer('oli', 'Oli');
  const ball = freshBall(oli);
  const centre = LIT.centre0 | LIT.centre1 | LIT.centre2 | LIT.centre3;
  const before = scoreOf(oli);
  hitPart({ kind: 'rollover', id: 'centre-1', ball });
  hitPart({ kind: 'rollover', id: 'centre-3', ball });
  assert.equal(litBits() & centre, LIT.centre0 | LIT.centre2);
  hitPart({ kind: 'rollover', id: 'centre-1', ball });
  assert.equal(scoreOf(oli) - before, 75, 'each pays 25');
  hitPart({ kind: 'rollover', id: 'centre-2', ball });
  assert.equal(litBits() & centre, LIT.centre0 | LIT.centre1 | LIT.centre2);
  hitPart({ kind: 'rollover', id: 'centre-4', ball });
  assert.equal(scoreOf(oli) - before, 100 + 25 + 1000);
  assert.equal(litBits() & centre, 0, 'the lamps went out');
});

step('the three top lanes light the kickback; the inlanes and outlane only score', () => {
  const sal = viewer('sal', 'Sal');
  const ball = freshBall(sal);
  const lit = () => (litBits() & LIT.kickback) !== 0;
  const before = scoreOf(sal);
  for (const id of ['inlane-left', 'inlane-right', 'outlane-right']) hitPart({ kind: 'rollover', id, ball });
  assert.equal(scoreOf(sal) - before, 100 + 100 + 250, 'they score');
  for (const id of ['rollover-1', 'rollover-2']) hitPart({ kind: 'rollover', id, ball });
  assert.equal(lit(), false, 'two top lanes and the side lanes are not enough');
  hitPart({ kind: 'rollover', id: 'rollover-3', ball });
  assert.equal(lit(), true, 'the three top lanes light the kickback');
  const other = viewer('tay', 'Tay');
  const ball2 = freshBall(other);
  for (const id of ['inlane-left', 'inlane-right', 'outlane-right', 'centre-1']) hitPart({ kind: 'rollover', id, ball: ball2 });
  assert.equal(lit(), false, 'only side lanes: no kickback');
});

step('a ball held in the saucer is never kicked as stuck', () => {
  const pam = viewer('pam', 'Pam');
  const ball = freshBall(pam);
  const sc = TABLE_IN_USE.saucers.find((s) => s.id === 'saucer-scarab')!;
  const nudges = () => feed().filter((t) => t === 'The table gets a nudge.').length;
  const before = nudges();
  put(ball, sc.x, sc.z);
  (game.sim as any).held.add(ball);
  (game.sim as any).saucerHold.set(ball, { index: TABLE_IN_USE.saucers.indexOf(sc), until: Infinity });
  hold(ball, sc.x, sc.z, RULES.stuckSeconds + 1);
  assert.equal(game.sim.heldBy(ball), 'saucer');
  assert.equal(nudges(), before, 'no nudge for a ball the saucer holds');
  (game.sim as any).saucerHold.delete(ball);
  (game.sim as any).held.delete(ball);
});

step('multiball with a ball in the saucer: it is let go, and none is lost', () => {
  const quin = viewer('quin', 'Quin');
  const rex = viewer('rex', 'Rex');
  const ball = freshBall(quin);
  say(rex, 'ball');
  game.knockAllTargets(ball);
  put(ball, TABLE_IN_USE.lock.x, TABLE_IN_USE.lock.z);
  run(2.5);
  assert.equal(game.state().multiball, true);
  assert.equal(game.sim.items.size, 3, 'three balls');
  const [x, y] = [...game.sim.items.keys()].filter((k) => k !== ball);
  // Past every ball saver, the other two parked apart.
  run(RULES.ballSaverStart + 0.2, () => {
    put(x, -0.4, 8);
    put(y, 0.5, 12);
  });
  const sc = TABLE_IN_USE.saucers.find((s) => s.id === 'saucer-scarab')!;
  put(x, sc.x, sc.z + 1.3, 0, -1.5);
  for (let i = 0; i < 2 / DT && game.sim.heldBy(x) !== 'saucer'; i++) run(DT);
  assert.equal(game.sim.heldBy(x), 'saucer', 'a ball sits in the saucer');
  assert.equal(game.sim.heldBy(ball), 'lock');
  drain(y);
  assert.notEqual(game.sim.heldBy(ball), 'lock', 'the lock let its ball go');
  assert.equal(game.sim.items.size, 2, 'the two balls left are on the table');
  run(1.5);
  assert.equal(game.sim.items.size, 2, 'none lost after the saucer let go');
});

// --- The quest's toys (the pop-ups, the mummy, the tomb and the diverter's gate) ---

const popups = TABLE_IN_USE.targets.filter((t) => t.rise === 'drop');
const mummy = TABLE_IN_USE.targets.find((t) => t.rise === 'hold')!;
const TOMB = TABLE_IN_USE.tomb!;
const DIVERTER = TABLE_IN_USE.diverter!;
const TOYS = ['popups', 'mummy', 'tomb', 'diverter'] as const satisfies readonly Toy[];
/** A target's bit in the physics' targetsDown(), by id. */
const targetBit = (id: string) => 1 << TABLE_IN_USE.targets.findIndex((t) => t.id === id);
const POPUP_BITS = popups.reduce((bits, t) => bits | targetBit(t.id), 0);
/** The pop-ups' and the mummy's bits: set while they stand down, as they do till the game raises them. */
const RISING = POPUP_BITS | targetBit(mummy.id);
/** The toys' word in the snapshot the game sends: byte 43 of its header (shared/pinball.ts). */
const toyBits = () => game.sim.snapshot().readUInt32LE(43);

/**
 * The pop-ups a ball standing at (x, z) is in the way of, asked of the physics on a table of its own, so nothing in the
 * game moves: whichever it will not raise.
 */
function popupsBlockedAt(x: number, z: number): string[] {
  const sim = new PinballSim(TABLE_IN_USE, () => {});
  sim.items.get(sim.launch(null))!.body.setTranslation({ x, y: R, z }, true);
  return popups.filter((t) => !sim.raiseTarget(t.id)).map((t) => t.id);
}

/** Rolls ball `id` up the centre lane at the tomb's mouth from 0.75 below it, at a speed the open tomb catches. */
function rollAtTomb(id: number): void {
  put(id, TOMB.x, TOMB.z - 0.75, 0, 16);
  game.sim.items.get(id)!.body.setAngvel({ x: 16 / R, y: 0, z: 0 }, true);
}

step('the toys come up when the game asks, and wait for a ball in the way', () => {
  const uma = viewer('uma', 'Uma');
  const ball = freshBall(uma);
  assert.deepEqual(TOYS.map((toy) => game.toyWanted(toy)), [false, false, false, false], 'nothing is wanted up to start');
  assert.equal(game.sim.targetsDown() & RISING, RISING, 'the pop-ups and the mummy stand down');
  // A ball held on the first pop-up's spot is in its way, and not in the last one's (the physics says which it is in
  // the way of: the pop-ups stand in a row, so a neighbour may be too).
  const first = popups[0];
  const last = popups.at(-1)!;
  const inTheWay = popupsBlockedAt(first.x, first.z);
  assert.ok(inTheWay.includes(first.id), `a ball on ${first.id} is in its way`);
  assert.ok(!inTheWay.includes(last.id), `but not in ${last.id}'s`);
  const blocked = inTheWay.reduce((bits, id) => bits | targetBit(id), 0);
  game.setToy('popups', true);
  assert.equal(game.toyWanted('popups'), true);
  hold(ball, first.x, first.z, 1);
  assert.equal(game.sim.targetsDown() & POPUP_BITS, blocked, 'the pop-ups the ball is in the way of stay down, and the rest rise');
  hold(ball, first.x, first.z, 1);
  assert.equal(game.sim.targetsDown() & POPUP_BITS, blocked, 'and go on waiting for as long as it stays');
  assert.equal(game.sim.targetsDown() & targetBit(mummy.id), targetBit(mummy.id), "the mummy wasn't asked for, and stays down");
  // The ball gone, the ones that waited rise a step later.
  game.sim.remove(ball);
  run(2 * DT);
  assert.equal(game.sim.targetsDown() & POPUP_BITS, 0, 'they all rise once the ball has gone');
  // A pop-up a ball knocks down stays down: the game raises a toy when it is asked to, not whenever it finds it down
  // (a mode that wants all three down would never get them otherwise).
  game.sim.lowerTarget(first.id);
  run(0.5);
  assert.equal(game.sim.targetsDown() & POPUP_BITS, targetBit(first.id), 'a pop-up a ball knocked down stays down');
  game.setToy('popups', true);
  run(2 * DT);
  assert.equal(game.sim.targetsDown() & POPUP_BITS, 0, 'until it is asked to raise them again');
  // Put away, they go down whatever stands there: lowering never traps a ball.
  game.setToy('popups', false);
  assert.equal(game.toyWanted('popups'), false);
  run(2 * DT);
  assert.equal(game.sim.targetsDown() & POPUP_BITS, POPUP_BITS, 'asked to put away, they go down');
});

step('the mummy goes down on its third hit', () => {
  const vic = viewer('vic', 'Vic');
  const ball = freshBall(vic);
  const bit = targetBit(mummy.id);
  game.setToy('mummy', true);
  run(2 * DT);
  assert.equal(game.sim.targetsDown() & bit, 0, 'the mummy is up');
  const before = scoreOf(vic);
  hitPart({ kind: 'target', id: mummy.id, ball });
  hitPart({ kind: 'target', id: mummy.id, ball });
  assert.equal(game.sim.targetsDown() & bit, 0, 'two hits leave it up');
  assert.equal(game.toyWanted('mummy'), true);
  assert.equal(scoreOf(vic) - before, 2 * 750, 'each hit scored 750');
  hitPart({ kind: 'target', id: mummy.id, ball });
  assert.equal(game.sim.targetsDown() & bit, bit, 'the third puts it down');
  assert.equal(game.toyWanted('mummy'), false, 'and nothing brings it back');
  assert.equal(scoreOf(vic) - before, 3 * 750, 'the third scored too');
  run(0.5);
  assert.equal(game.sim.targetsDown() & bit, bit, 'it stays down');
  // Raised again, it takes three more: its hits are counted from when it rose.
  game.setToy('mummy', true);
  run(2 * DT);
  assert.equal(game.sim.targetsDown() & bit, 0, 'raised again');
  hitPart({ kind: 'target', id: mummy.id, ball });
  hitPart({ kind: 'target', id: mummy.id, ball });
  assert.equal(game.sim.targetsDown() & bit, 0, 'two more leave it up');
  hitPart({ kind: 'target', id: mummy.id, ball });
  assert.equal(game.sim.targetsDown() & bit, bit, 'and the third puts it down again');
  // Asked for while it is up already, it is not a fresh mummy: the hits so far still count.
  game.setToy('mummy', true);
  run(2 * DT);
  hitPart({ kind: 'target', id: mummy.id, ball });
  game.setToy('mummy', true);
  hitPart({ kind: 'target', id: mummy.id, ball });
  assert.equal(game.sim.targetsDown() & bit, 0, 'asked for again while up, the count goes on');
  hitPart({ kind: 'target', id: mummy.id, ball });
  assert.equal(game.sim.targetsDown() & bit, bit, 'so the third hit since it rose puts it down');
});

step('with the toys up, only the scarab and the eye light the lock, and bringing them back leaves the toys be', () => {
  const yan = viewer('yan', 'Yan');
  const ball = freshBall(yan);
  const sim = game.sim as any;
  const drops = TABLE_IN_USE.targets.flatMap((t, i) => (isLockTarget(t) ? [i] : []));
  const dropBits = drops.reduce((bits, i) => bits | (1 << i), 0);
  game.setToy('popups', true);
  game.setToy('mummy', true);
  hold(ball, -0.4, 9, 2 * DT);
  assert.equal(game.sim.targetsDown() & RISING, 0, 'the pop-ups and the mummy are up');
  // Hits on the toys score, and light nothing: the pop-ups and the mummy aren't the lock's drop targets.
  const before = scoreOf(yan);
  for (const id of [...popups.map((t) => t.id), mummy.id]) hitPart({ kind: 'target', id, ball });
  assert.equal(scoreOf(yan) - before, popups.reduce((sum, t) => sum + t.points, 0) + mummy.points);
  assert.equal(game.state().lockLit, false, 'the toys do not light the lock');
  // The scarab and the eye do. Down as the physics drops them, they come back up a second later, and only they: the toys
  // stand as they stood (the pop-ups' own drops are theirs to take back).
  for (const i of drops) {
    sim.targets[i].down = true;
    sim.targets[i].collider.setEnabled(false);
    hitPart({ kind: 'target', id: TABLE_IN_USE.targets[i].id, ball });
  }
  assert.equal(game.state().lockLit, true, 'the scarab and the eye light the lock');
  assert.equal(game.sim.targetsDown() & dropBits, dropBits, 'both are down');
  hold(ball, -0.4, 9, 1.2);
  assert.equal(game.sim.targetsDown() & dropBits, 0, 'and back up a second later');
  assert.equal(game.sim.targetsDown() & RISING, 0, 'with the pop-ups and the mummy still up');
  // A pop-up a ball has knocked down is no drop target either: coming back from the lock leaves it down.
  game.sim.lowerTarget(popups[1].id);
  for (const i of drops) {
    sim.targets[i].down = true;
    sim.targets[i].collider.setEnabled(false);
    hitPart({ kind: 'target', id: TABLE_IN_USE.targets[i].id, ball });
  }
  hold(ball, -0.4, 9, 1.2);
  assert.equal(game.sim.targetsDown() & dropBits, 0, 'the lock targets came back again');
  assert.equal(game.sim.targetsDown() & RISING, targetBit(popups[1].id), 'and the knocked-down pop-up is still down');
});

step('a ball in the tomb scores, and the stuck watcher leaves it alone', () => {
  const val = viewer('val', 'Val');
  const ball = freshBall(val);
  const nudges = () => feed().filter((t) => t === 'The table gets a nudge.').length;
  game.setToy('tomb', true);
  run(2 * DT);
  assert.equal(game.sim.tombOpen, true, 'the tomb is open');
  // Rolled at the mouth, it is caught, and the catch scores what the table says.
  rollAtTomb(ball);
  let before = scoreOf(val);
  for (let i = 0; i < 1 / DT && game.sim.heldBy(ball) !== 'tomb'; i++) {
    before = scoreOf(val);
    run(DT);
  }
  assert.equal(game.sim.heldBy(ball), 'tomb', 'the tomb caught the ball');
  assert.ok(TOMB.points > 0);
  assert.equal(scoreOf(val) - before, TOMB.points, "the catch scored the tomb's points");
  // Under double score it pays twice.
  (game as any).doubleUntil = game.sim.time + 30;
  const mid = scoreOf(val);
  hitPart({ kind: 'tomb', id: TOMB.id, ball });
  assert.equal(scoreOf(val) - mid, 2 * TOMB.points, 'doubled under double score');
  // Held on past the time it takes to be stuck, it is not nudged: the tomb holds it, not the table.
  (game.sim as any).tombHold.until = Infinity;
  const nudged = nudges();
  run(RULES.stuckSeconds + 1);
  assert.equal(game.sim.heldBy(ball), 'tomb', 'still held');
  assert.equal(nudges(), nudged, 'no nudge for a ball the tomb holds');
});

step('the door waits for the ball the tomb holds, and the gate for a ball in its way', () => {
  const xan = viewer('xan', 'Xan');
  let ball = freshBall(xan);
  game.setToy('tomb', true);
  run(2 * DT);
  rollAtTomb(ball);
  for (let i = 0; i < 1 / DT && game.sim.heldBy(ball) !== 'tomb'; i++) run(DT);
  assert.equal(game.sim.heldBy(ball), 'tomb', 'the tomb caught the ball');
  // Asked to shut while it holds the ball, the tomb stays open as long as it does, and shuts once the ball has gone.
  (game.sim as any).tombHold.until = Infinity;
  game.setToy('tomb', false);
  run(0.5);
  assert.equal(game.toyWanted('tomb'), false);
  assert.equal(game.sim.tombOpen, true, 'not shut on the ball it holds');
  (game.sim as any).tombHold.until = game.sim.time;
  run(0.25);
  assert.notEqual(game.sim.heldBy(ball), 'tomb', 'the ball is let go');
  assert.equal(game.sim.tombOpen, false, 'and the door shuts once it has gone from the doorway');
  // The gate: a ball held in the middle of where it sweeps (taken from the table's data, wherever the gate stands, and
  // at its ramp's height) keeps it at rest; with the ball gone it swings.
  ball = ballOf(xan)!;
  const floor = ((game.sim as any).diverter as { y: number }).y;
  const mid = (((DIVERTER.restDeg + DIVERTER.overDeg) / 2) * Math.PI) / 180;
  const inTheWay = () => {
    const body = game.sim.items.get(ball)!.body;
    body.setTranslation({ x: DIVERTER.pivot[0] + (DIVERTER.length / 2) * Math.cos(mid), y: floor + R, z: DIVERTER.pivot[1] + (DIVERTER.length / 2) * Math.sin(mid) }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  };
  game.setToy('diverter', true);
  run(0.5, inTheWay);
  assert.equal(game.toyWanted('diverter'), true);
  assert.equal(game.sim.diverterOver, false, 'not swung into the ball in its way');
  assert.equal(game.sim.toys() & TOY.diverterOver, 0);
  game.sim.remove(ball);
  run(2 * DT);
  assert.equal(game.sim.diverterOver, true, 'it swings once the ball has gone');
  game.setToy('diverter', false);
  run(2 * DT);
  assert.equal(game.sim.diverterOver, false, 'and back when asked');
});

step('a reset puts every toy away', () => {
  const wes = viewer('wes', 'Wes');
  const ball = freshBall(wes);
  for (const toy of TOYS) game.setToy(toy, true);
  hold(ball, -0.4, 9, 0.5);
  assert.equal(game.sim.targetsDown() & RISING, 0, 'the pop-ups and the mummy are up');
  assert.equal(game.sim.tombOpen, true);
  assert.equal(game.sim.diverterOver, true);
  assert.equal(toyBits(), TOY.tombOpen | TOY.diverterOver, "and the snapshot's toy word says the tomb is open and the gate over");
  // A ball in the tomb at the time goes with the rest.
  rollAtTomb(ball);
  for (let i = 0; i < 1 / DT && game.sim.heldBy(ball) !== 'tomb'; i++) run(DT);
  assert.equal(game.sim.heldBy(ball), 'tomb', 'the tomb holds the ball');
  game.resetMachine();
  const away = () => {
    assert.equal(game.sim.items.size, 0, 'the ball the tomb held is gone with the rest');
    assert.equal(game.sim.targetsDown() & RISING, RISING, 'every rising target is down');
    assert.equal(game.sim.tombOpen, false, 'the tomb is shut');
    assert.equal(game.sim.diverterOver, false, 'the gate is at rest');
    assert.equal(toyBits(), 0, "and the snapshot's toy word is clear");
    assert.deepEqual(TOYS.map((toy) => game.toyWanted(toy)), [false, false, false, false], 'none is wanted up');
  };
  away();
  run(1);
  away();
});

step('the toy action works only with PINBALL_TOYS', () => {
  const was = process.env.PINBALL_TOYS;
  try {
    game.resetMachine();
    delete process.env.PINBALL_TOYS;
    game.action({ kind: 'toy', toy: 'tomb', up: true });
    run(0.1);
    assert.equal(game.sim.tombOpen, false, 'without PINBALL_TOYS the action is ignored like any unknown one');
    assert.equal(game.toyWanted('tomb'), false);
    process.env.PINBALL_TOYS = '0';
    game.action({ kind: 'toy', toy: 'tomb', up: true });
    run(0.1);
    assert.equal(game.sim.tombOpen, false, 'only 1 switches it on');
    process.env.PINBALL_TOYS = '1';
    game.action({ kind: 'toy', toy: 'tomb', up: true });
    run(0.1);
    assert.equal(game.sim.tombOpen, true, 'with PINBALL_TOYS=1 it opens');
    game.action({ kind: 'toy', toy: 'popups', up: true });
    game.action({ kind: 'toy', toy: 'mummy', up: true });
    game.action({ kind: 'toy', toy: 'diverter', up: true });
    run(0.5);
    assert.equal(game.sim.targetsDown() & RISING, 0, 'the pop-ups and the mummy rise');
    assert.equal(game.sim.diverterOver, true);
    // Anything else is ignored, the switch on: an unknown toy, no toy, an up that is not a yes or a no (these that are
    // falsy would shut the tomb if taken for a no).
    game.action({ kind: 'toy', toy: 'nonsense', up: false });
    game.action({ kind: 'toy', up: false });
    game.action({ kind: 'toy', toy: ['tomb'], up: false });
    game.action({ kind: 'toy', toy: 'tomb', up: 0 });
    game.action({ kind: 'toy', toy: 'tomb', up: null });
    game.action({ kind: 'toy', toy: 'tomb', up: '' });
    game.action({ kind: 'toy', toy: 'tomb' });
    game.action({ kind: 'toy' });
    run(0.5);
    assert.equal(game.sim.tombOpen, true, 'nothing of that shut the tomb');
    assert.deepEqual(TOYS.map((toy) => game.toyWanted(toy)), [true, true, true, true]);
    assert.equal((game as any).toyWaits.size, 0, 'and nothing was left waiting to be moved');
    game.action({ kind: 'toy', toy: 'tomb', up: false });
    game.action({ kind: 'toy', toy: 'diverter', up: false });
    run(0.5);
    assert.equal(game.sim.tombOpen, false, 'and down');
    assert.equal(game.sim.diverterOver, false);
  } finally {
    if (was === undefined) delete process.env.PINBALL_TOYS;
    else process.env.PINBALL_TOYS = was;
  }
});

// --- The toys' hits as cues to the stages (PinballCueMsg) ---

/** The cues of every kind sent since `mark` (what msgs.length was then), in order. */
const cuesSince = (mark: number) =>
  msgs.slice(mark).flatMap((m) => (m.t === 'machine' ? [pinballCueOf(m.msg)] : [])).filter((c): c is PinballCueMsg => c !== null);
/** The toy-hit cues sent since `mark`, in order. */
const toyHitsSince = (mark: number) => cuesSince(mark).filter((c): c is PinballToyHit => c.cue === 'toyHit');
/** Whether a cue's place is within 0.25 of (x, z). */
const nearTo = (cue: { x: number; z: number }, x: number, z: number) => Math.abs(cue.x - x) < 0.25 && Math.abs(cue.z - z) < 0.25;

step("each toy hit is a cue to the stages: a pop-up knocked down, the mummy's hits (the third puts it down), a ball the tomb catches", () => {
  const zed = viewer('zed', 'Zed');
  const ball = freshBall(zed);
  game.setToy('popups', true);
  game.setToy('mummy', true);
  // The ball is parked inside the pyramid: clear of every toy, and nowhere near the table's origin, so that the place
  // in a cue can only be the ball's.
  hold(ball, -0.4, 9, 2 * DT);
  assert.equal(game.sim.targetsDown() & RISING, 0, 'the pop-ups and the mummy are up');

  // A pop-up knocked down is one cue: where the ball is, and when.
  let mark = msgs.length;
  const where = game.sim.items.get(ball)!.body.translation();
  const when = game.sim.time;
  hitPart({ kind: 'target', id: popups[0].id, ball });
  let cues = toyHitsSince(mark);
  assert.equal(cues.length, 1, 'a pop-up knocked down is one cue');
  assert.deepEqual(cues[0], { kind: 'pinballCue', cue: 'toyHit', part: popups[0].id, down: true, x: cues[0].x, z: cues[0].z, at: cues[0].at });
  assert.ok(nearTo(cues[0], where.x, where.z), `at the ball's place (${where.x}, ${where.z}), not (${cues[0].x}, ${cues[0].z})`);
  assert.ok(Math.abs(cues[0].at - when) < DT, `at the table's time ${when}, not ${cues[0].at}`);

  // The mummy: every hit is a cue, and only the third, which puts it down, says so.
  mark = msgs.length;
  for (let i = 0; i < 3; i++) hitPart({ kind: 'target', id: mummy.id, ball });
  assert.deepEqual(toyHitsSince(mark).map((c) => [c.part, c.down]), [[mummy.id, false], [mummy.id, false], [mummy.id, true]], 'three hits, the third puts it down');
  assert.equal(game.sim.targetsDown() & targetBit(mummy.id), targetBit(mummy.id), 'and it is down');
  // A hit after the third in the same step (a second ball's) puts nothing down: the mummy is on its way down already.
  game.setToy('mummy', true);
  run(2 * DT);
  mark = msgs.length;
  hitPart({ kind: 'target', id: mummy.id, ball });
  hitPart({ kind: 'target', id: mummy.id, ball });
  (game.sim as any).report({ kind: 'target', id: mummy.id, ball });
  hitPart({ kind: 'target', id: mummy.id, ball });
  assert.deepEqual(toyHitsSince(mark).map((c) => c.down), [false, false, true, false], 'a hit after the third, in the same step, puts nothing down');

  // The plaques and the lock's drop targets are no toys, and the game putting the pop-ups away is no hit.
  mark = msgs.length;
  hitPart({ kind: 'target', id: 'target-ra-1', ball });
  hitPart({ kind: 'target', id: 'target-scarab', ball });
  assert.deepEqual(cuesSince(mark), [], 'a plaque and a drop target send no cue');
  game.setToy('popups', false);
  run(0.5);
  assert.equal(game.sim.targetsDown() & POPUP_BITS, POPUP_BITS, 'the pop-ups went down');
  assert.deepEqual(cuesSince(mark), [], 'put away by the game, they send no cue');

  // A ball the tomb catches, by the physics: one cue, where the tomb holds the ball. It puts nothing down.
  game.setToy('tomb', true);
  run(2 * DT);
  mark = msgs.length;
  rollAtTomb(ball);
  for (let i = 0; i < 1 / DT && game.sim.heldBy(ball) !== 'tomb'; i++) run(DT);
  assert.equal(game.sim.heldBy(ball), 'tomb', 'the tomb caught the ball');
  cues = toyHitsSince(mark);
  assert.equal(cues.length, 1, 'a catch is one cue');
  assert.deepEqual([cues[0].part, cues[0].down], [TOMB.id, false]);
  assert.ok(nearTo(cues[0], TOMB.held[0], TOMB.held[1]), `where the tomb holds the ball (${TOMB.held}), not (${cues[0].x}, ${cues[0].z})`);

  // A cue is a moment, not part of the state: a page that opens later is sent the state alone.
  const hello = game.hello();
  assert.ok(hello.t === 'hello');
  assert.equal((hello.machine as { kind: string }).kind, 'pinball', "hello's machine is still the state");
});

step('pinballCueOf reads a cue and nothing else', () => {
  const cue: PinballCueMsg = { kind: 'pinballCue', cue: 'toyHit', part: popups[0].id, down: true, x: 1.5, z: 6.5, at: 12.5 };
  assert.deepEqual(pinballCueOf(cue), cue, 'a cue comes back as it is');
  assert.deepEqual(pinballCueOf(JSON.parse(JSON.stringify(cue))), cue, 'as it comes off the wire too');
  const noPart: Record<string, unknown> = { ...cue };
  delete noPart.part;
  assert.equal(pinballCueOf({ kind: 'pinballHype', id: 'double', at: 3 }), null, 'a hype moment is not a cue');
  assert.equal(pinballCueOf(noPart), null, 'a cue with no part');
  assert.equal(pinballCueOf({ ...cue, down: 1 }), null, 'down is a boolean');
  assert.equal(pinballCueOf({ ...cue, x: NaN }), null, 'x is a number');
  assert.equal(pinballCueOf({ ...cue, at: '3' }), null, 'at is a number');
  assert.equal(pinballCueOf({ ...cue, cue: 'tilt' }), null, 'a cue this page does not know');
  for (const other of [null, undefined, 'pinballCue', 7, { kind: 'pinball', state: {} }]) {
    assert.equal(pinballCueOf(other), null, `${JSON.stringify(other)} is not a cue`);
  }
  // And the readers the stage and the panel's card already have pass a cue over.
  assert.equal(pinballStateOf(cue), null, 'a cue is not a state');
  assert.equal(pinballHypeOf(cue), null, 'nor a hype moment');
});

// --- The quest, played through the game (quest.ts's rules, fed from the table's hits and the table's clock) ---

/** The quest as the state shows it. */
const quest = () => game.state().quest;
/** Each god's toy, as the design has it: Ra the diverter, Horus the pop-ups, Ankh the mummy, the Eye the tomb. */
const TOY_OF: Record<God, Toy> = { ra: 'diverter', horus: 'popups', ankh: 'mummy', eye: 'tomb' };
/** Whether each god's toy stands as its mode wants it: the gate over, the pop-ups or the mummy up, the tomb open. */
const TOY_UP: Record<God, () => boolean> = {
  ra: () => game.sim.diverterOver,
  horus: () => (game.sim.targetsDown() & POPUP_BITS) === 0,
  ankh: () => (game.sim.targetsDown() & targetBit(mummy.id)) === 0,
  eye: () => game.sim.tombOpen,
};
/** Which toys are wanted up, in TOYS' order: the pop-ups, the mummy, the tomb, the gate. */
const wanted = () => TOYS.map((toy) => game.toyWanted(toy));
/** A god's bank of plaques on the table. */
const bankOf = (god: God) => TABLE_IN_USE.banks.find((b) => b.id === `bank-${god}`)!;
/** The quest's cues sent since `mark` (every kind but a toy's hit), in order; and only their kinds. */
const questCuesSince = (mark: number) => cuesSince(mark).filter((c) => c.cue !== 'toyHit');
const questSaid = (mark: number) => questCuesSince(mark).map((c) => c.cue);
/** The states the stages and the card were sent since `mark`, in order. */
const statesSince = (mark: number) =>
  msgs.slice(mark).flatMap((m) => (m.t === 'machine' ? [pinballStateOf(m.msg)] : [])).filter((s): s is PinballState => s !== null);
/** What a ball on the table has scored, by its id: the state lists balls by owner, and two can be the house's. */
const pointsOn = (id: number): number => (game as any).balls.get(id).points;

/**
 * Where the steps below keep balls still, each clear of every part of the table (one inside the pyramid, above the
 * back of the tomb's doorway, and two above the pyramid), moved 0.4 up the table every other second so that the stuck
 * watcher never takes one for stuck.
 */
const SPOTS: readonly (readonly [number, number])[] = [[-0.4, 7.4], [0.4, 9.0], [-1.2, 9.0]];
/** Puts these balls at their spots, in order, for the next step: the ones on the table that nothing holds. */
function parkStep(ids: number[]): void {
  const lift = Math.floor(game.sim.time) % 2 ? 0.4 : 0;
  ids.forEach((id, k) => {
    if (game.sim.items.has(id) && game.sim.heldBy(id) === null) put(id, SPOTS[k][0], SPOTS[k][1] + lift);
  });
}
/** Runs `seconds` of play with these balls kept at their spots. */
const park = (seconds: number, ...ids: number[]) => run(seconds, () => parkStep(ids));
/** Reports a hit the way the sim does, and steps once so the game sees it, these balls kept at their spots. */
function hitParked(h: { kind: string; id: string; ball: number }, ...ids: number[]): void {
  (game.sim as any).report(h);
  park(DT, ...ids);
}
/**
 * Steps the table until `done()` (at most `seconds`), the `parked` balls at their spots: what `watch()` read just
 * before and just after the step that did it, or null if it never came.
 */
function stepUntil<T>(done: () => boolean, watch: () => T, parked: number[] = [], seconds = 4): { before: T; after: T } | null {
  for (let i = 0; i < seconds / DT; i++) {
    const before = watch();
    park(DT, ...parked);
    if (done()) return { before, after: watch() };
  }
  return null;
}
/**
 * Parks these balls until the spinners stand still: a spinner's turns score for the ball that last spun it, for as
 * long as it turns, so a step whose points are counted waits for them.
 */
function parkTillStill(...ids: number[]): void {
  for (let i = 0; i < 10 / DT; i++) {
    const turned = game.sim.spinnerAngles().join();
    park(DT, ...ids);
    if (game.sim.spinnerAngles().join() === turned) return;
  }
  assert.fail('the spinners never stood still');
}

/**
 * Shots through the table, each [x, z, vx, vz], as pinball-layout-test fires them: straight up each orbit lane from
 * its foot at 34 units/s, which goes round over the top and down the other lane, and up the left ramp from the
 * centre, which with the gate over goes out through its gap.
 */
const SHOTS = { leftOrbit: [-4.5, 6.8, 0, 34], rightOrbit: [3.7, 8.0, 0, 34], leftRamp: [-0.1, 3.0, -23, 44] } as const;
/** A shot square at a rising target's face, from 0.7 in front of it at 8 units/s. */
function atFace(t: Target): number[] {
  const a = ((t.angle ?? 0) * Math.PI) / 180;
  const [nx, nz] = [-Math.sin(a), Math.cos(a)];
  return [t.x - 0.7 * nx, t.z - 0.7 * nz, 8 * nx, 8 * nz];
}
/** Puts ball `id` into a shot. */
const aim = (id: number, [x, z, vx, vz]: readonly number[]) => put(id, x, z, vx, vz);

/** The hits that win a god's mode, as the physics reports them, a step apart with the ball parked: its goal's count. */
function goalHits(god: God, ball: number): void {
  for (let i = 0; i < QUEST.goals[god]; i++) {
    // The gate's switch counts a pass either way, and the pop-ups count once each.
    if (god === 'ra') hitParked({ kind: 'switch', id: 'ramp-gate', ball }, ball);
    else if (god === 'horus') hitParked({ kind: 'target', id: popups[i].id, ball }, ball);
    else if (god === 'ankh') hitParked({ kind: 'target', id: mummy.id, ball }, ball);
    else hitParked({ kind: 'tomb', id: TOMB.id, ball }, ball);
  }
}
/** These gods crossed off by ball `ball` in turn, as the physics would report it: each one's bank matched, then won. */
function crossOff(ball: number, ...gods: God[]): void {
  for (const god of gods) {
    hitParked({ kind: 'bank', id: `bank-${god}`, ball }, ball);
    goalHits(god, ball);
  }
}
/** The server restarts: a new game from the same save file and wallet, as the city makes one (its balls are lost). */
function restart(): void {
  game.save();
  game = new PinballGame(room, economy, { send: (m) => msgs.push(m) }, saveFile);
  game.load();
}

step("a bank matched starts its god's mode: its toy comes up, the state shows it, and its clock runs only while a ball is in play", () => {
  const ivo = viewer('ivo', 'Ivo');
  let ball = -1;
  for (const god of GODS) {
    ball = freshBall(ivo);
    park(0.2, ball);
    assert.deepEqual(quest(), { done: [], mode: null, finale: null }, `${god}: a cleared table, a quest with nothing in it`);
    const mark = msgs.length;
    const from = game.sim.time;
    hitParked({ kind: 'bank', id: `bank-${god}`, ball }, ball);
    const said = questCuesSince(mark);
    assert.deepEqual(said, [{ kind: 'pinballCue', cue: 'modeStart', god, at: said[0]?.at }], `${god}: its mode starts`);
    assert.ok(Math.abs(said[0].at - from) < DT, `${god}: told at the match's time ${from}, not ${said[0].at}`);
    assert.deepEqual(wanted(), TOYS.map((toy) => toy === TOY_OF[god]), `${god}: its toy is asked for, and only its`);
    park(0.3, ball);
    assert.ok(TOY_UP[god](), `${god}: its toy comes up`);
    const { mode } = quest();
    assert.ok(mode, `${god}: the state shows the mode`);
    assert.deepEqual({ ...mode, left: 0, at: 0 }, { god, left: 0, at: 0, running: true, progress: 0, goal: QUEST.goals[god] }, `${god}: running, none of its goal made`);
    // Its clock ran from the match's own step on: a step's hits come before its clock.
    assert.ok(Math.abs(mode.left - (QUEST.modeSeconds - (game.sim.time - from))) < 1e-9, `${god}: ${mode.left} s left`);
    assert.equal(mode.at, game.sim.time, `${god}: its time left as at the table's time now`);
    assert.equal(statesSince(mark).at(-1)?.quest.mode?.god, god, `${god}: and the state the stages and the card were sent shows it`);
  }
  // In play its clock runs (the Eye's mode, on the last of those tables), here past the ball's saver, so that the
  // ball's drain below is a drain.
  let timeLeft = quest().mode!.left;
  park(RULES.ballSaverStart, ball);
  assert.ok(Math.abs(quest().mode!.left - (timeLeft - RULES.ballSaverStart)) < 1e-6, 'in play its time runs');
  // The ball drains, and Jo's is next: between balls, and while Jo's waits to launch, its time stands still.
  const jo = viewer('jo', 'Jo');
  say(jo, 'ball');
  let mark = msgs.length;
  drain(ball);
  timeLeft = quest().mode!.left;
  assert.equal(quest().mode!.running, false, 'no ball in play: its clock stands still');
  assert.equal(statesSince(mark).at(-1)?.quest.mode?.running, false, 'and the state sent says so');
  run(RULES.launchDelay - 0.2);
  assert.equal(game.state().phase, 'launching', "Jo's ball waits to launch");
  assert.equal(quest().mode!.left, timeLeft, 'its time stood still');
  // On the table, Jo's ball picks the mode up where the last ball left it.
  mark = msgs.length;
  let from = game.sim.time;
  for (let i = 0; i < 1 / DT && ballOf(jo) === undefined; i++) {
    from = game.sim.time;
    run(DT);
  }
  const jos = ballOf(jo);
  assert.ok(jos !== undefined, "Jo's ball is on the table");
  assert.equal(quest().mode!.running, true, 'in play again: its clock runs');
  assert.equal(statesSince(mark).at(-1)?.quest.mode?.running, true, 'and the state sent says so');
  park(1, jos);
  assert.ok(Math.abs(quest().mode!.left - (timeLeft - (game.sim.time - from))) < 1e-6, 'from where it was left');
});

step("each mode end to end through the table: Sun Chase's orbit and ramp switches, Falcon Strike's pop-ups, the Mummy Wakes' hits, Tomb Raid's catch; the prize to the ball that finished it, the toy put away, the god crossed off", () => {
  // Whatever QUEST is tuned to, each goal is one its toy can give: The Mummy Wakes' no more hits than the mummy takes
  // before it goes down, and Falcon Strike's no more pop-ups than the table has.
  assert.ok(QUEST.goals.ankh <= MUMMY_HITS, `The Mummy Wakes wants ${QUEST.goals.ankh} hits, and the mummy goes down on hit ${MUMMY_HITS}`);
  assert.ok(QUEST.goals.horus <= popups.length, `Falcon Strike wants ${QUEST.goals.horus} pop-ups, and the table has ${popups.length}`);
  /** The won cue for this god sent since `mark`. */
  const wonCue = (mark: number, god: God) => questCuesSince(mark).find((c): c is Extract<PinballCueMsg, { cue: 'modeWon' }> => c.cue === 'modeWon' && c.god === god);
  const made = () => quest().mode?.progress ?? 0;

  // Sun Chase. The gate swings over, and its shots go round an orbit, either way, or up the left ramp and out through
  // the gate's gap. Ann's ball makes all of them but the last, and drains; Bob's, next in line, makes the last, and the
  // prize is his.
  const ann = viewer('ann', 'Ann');
  const bob = viewer('bob', 'Bob');
  let ball = freshBall(ann);
  park(RULES.ballSaverStart, ball);
  hitParked({ kind: 'bank', id: 'bank-ra', ball }, ball);
  park(0.5, ball);
  assert.ok(TOY_UP.ra(), 'the gate is over');
  const raShots = [SHOTS.leftOrbit, SHOTS.rightOrbit, SHOTS.leftRamp];
  for (let n = 1; n < QUEST.goals.ra; n++) {
    aim(ball, raShots[(n - 1) % raShots.length]);
    assert.ok(stepUntil(() => made() === n, () => 0), `Sun Chase: shot ${n} counts`);
    // Kept still past the half second a switch ignores a ball it has just seen pass (sim.ts's SWITCH_IGNORE).
    park(1, ball);
  }
  const annPoints = scoreOf(ann);
  say(bob, 'ball');
  drain(ball);
  assert.deepEqual(game.state().lastResult, { name: 'Ann', points: annPoints, coins: Math.floor(annPoints / RULES.pointsPerCoin) }, "Ann's ball is paid as any, with no prize in it");
  assert.equal(made(), QUEST.goals.ra - 1, 'the mode waits for the next ball, with the shots made');
  // Bob's launch comes round the arch and down the left orbit lane, past its switch going down: no shot.
  for (let i = 0; i < 4 / DT && ballOf(bob) === undefined; i++) run(DT);
  ball = ballOf(bob)!;
  const downTheLeftLane = () => {
    const p = game.sim.items.get(ball)?.body.translation();
    return p !== undefined && p.x < -3.5 && p.z < 10;
  };
  assert.ok(stepUntil(downTheLeftLane, () => 0, [], 3), "Bob's launch comes down the left lane");
  parkTillStill(ball);
  assert.equal(made(), QUEST.goals.ra - 1, "Bob's launch is no shot");
  let mark = msgs.length;
  aim(ball, raShots[(QUEST.goals.ra - 1) % raShots.length]);
  const raWon = stepUntil(() => quest().mode === null, () => scoreOf(bob));
  assert.ok(raWon, 'the last shot wins Sun Chase');
  assert.equal(wonCue(mark, 'ra')?.prize, QUEST.prize, 'its prize');
  assert.equal(raWon.after - raWon.before, QUEST.goalPoints + QUEST.prize, "the last shot's goal points and the prize, to Bob's ball");
  park(0.5, ball);
  assert.equal(game.toyWanted('diverter'), false, 'the gate is put away');
  assert.equal(game.sim.diverterOver, false, 'and is back at rest');
  assert.deepEqual(quest(), { done: ['ra'], mode: null, finale: null }, 'Ra crossed off');

  // Falcon Strike, under double score: the pop-ups rise, and each knocked down is a goal. Double score doubles the
  // table's own points for it, and not the quest's.
  const cy = viewer('cy', 'Cy');
  ball = freshBall(cy);
  hitParked({ kind: 'bank', id: 'bank-horus', ball }, ball);
  park(0.3, ball);
  assert.ok(TOY_UP.horus(), 'the pop-ups are up');
  (game as any).doubleUntil = game.sim.time + 60;
  mark = msgs.length;
  let won: { before: number; after: number } | null = null;
  let target = popups[0];
  for (let tries = 0; tries < 2 * popups.length && quest().mode; tries++) {
    target = popups.find((t) => (game.sim.targetsDown() & targetBit(t.id)) === 0)!;
    const before = made();
    aim(ball, atFace(target));
    const hit = stepUntil(() => made() !== before || quest().mode === null, () => scoreOf(cy), [], 2);
    if (quest().mode === null) won = hit;
    park(0.3, ball);
  }
  assert.ok(won, 'the pop-ups knocked down win Falcon Strike');
  assert.equal(wonCue(mark, 'horus')?.prize, QUEST.prize, 'its prize');
  assert.equal(won.after - won.before, 2 * target.points + QUEST.goalPoints + QUEST.prize, "the last pop-up's points doubled, the goal's and the prize as they are, to Cy's ball");
  (game as any).doubleUntil = -Infinity;
  assert.equal(game.toyWanted('popups'), false, 'the pop-ups are put away');
  assert.equal(game.sim.targetsDown() & POPUP_BITS, POPUP_BITS, 'all down');
  assert.deepEqual(quest(), { done: ['horus'], mode: null, finale: null }, 'Horus crossed off');

  // The Mummy Wakes: the mummy rises, and each hit on it is a goal.
  const dee = viewer('dee', 'Dee');
  ball = freshBall(dee);
  hitParked({ kind: 'bank', id: 'bank-ankh', ball }, ball);
  park(0.3, ball);
  assert.ok(TOY_UP.ankh(), 'the mummy is up');
  mark = msgs.length;
  won = null;
  for (let tries = 0; tries < 3 * QUEST.goals.ankh && quest().mode; tries++) {
    const before = made();
    aim(ball, atFace(mummy));
    const hit = stepUntil(() => made() !== before || quest().mode === null, () => scoreOf(dee), [], 2);
    if (quest().mode === null) won = hit;
    park(0.3, ball);
  }
  assert.ok(won, 'its hits win The Mummy Wakes');
  assert.equal(wonCue(mark, 'ankh')?.prize, QUEST.prize, 'its prize');
  assert.equal(won.after - won.before, mummy.points + QUEST.goalPoints + QUEST.prize, "the last hit's points, its goal's and the prize, to Dee's ball");
  assert.equal(game.toyWanted('mummy'), false, 'the mummy is put away');
  assert.equal(game.sim.targetsDown() & targetBit(mummy.id), targetBit(mummy.id), 'down');
  assert.deepEqual(quest(), { done: ['ankh'], mode: null, finale: null }, 'Ankh crossed off');

  // Tomb Raid, a third of its time gone: the tomb opens, and a ball it catches wins it, the prize what its countdown
  // says at the catch.
  const eli = viewer('eli', 'Eli');
  ball = freshBall(eli);
  hitParked({ kind: 'bank', id: 'bank-eye', ball }, ball);
  park(QUEST.modeSeconds / 3, ball);
  assert.ok(TOY_UP.eye(), 'the tomb is open');
  mark = msgs.length;
  let caught: { before: { score: number; left: number }; after: { score: number; left: number } } | null = null;
  for (let n = 1; n <= QUEST.goals.eye; n++) {
    rollAtTomb(ball);
    caught = stepUntil(() => game.sim.heldBy(ball) === 'tomb', () => ({ score: scoreOf(eli), left: quest().mode?.left ?? 0 }), [], 1);
    assert.ok(caught, `catch ${n}`);
    // The tomb lets it go at once, and it is kept still past the time the tomb ignores a ball it let go.
    (game.sim as any).tombHold.until = game.sim.time;
    park(1, ball);
  }
  assert.ok(caught && quest().mode === null, 'the catch wins Tomb Raid');
  const prize = tombPrize(caught.before.left);
  assert.ok(prize < tombPrize(QUEST.modeSeconds), 'its prize has counted down');
  assert.equal(wonCue(mark, 'eye')?.prize, prize, 'its prize, by the time left at the catch');
  assert.equal(caught.after.score - caught.before.score, TOMB.points + QUEST.goalPoints + prize, "the tomb's points, the goal's and the prize, to Eli's ball");
  assert.equal(game.toyWanted('tomb'), false, 'the tomb is put away');
  assert.equal(game.sim.tombOpen, false, 'shut, once the ball it held has gone');
  assert.deepEqual(quest(), { done: ['eye'], mode: null, finale: null }, 'the Eye crossed off');
});

step("Sun Chase's shots by the switches: round the orbit (up one lane, down the other within ORBIT_ROUND), into the dish going up, out through the gate's gap either way; a pass up that falls back counts nothing, and a pass that counts nothing sends no state", () => {
  const ray = viewer('ray', 'Ray');
  let ball = freshBall(ray);
  park(0.2, ball);
  /** Ray's ball passing switch `id` heading up or down the table, as the physics reports a pass; then still again. */
  const pass = (id: string, heading: 'up' | 'down') => {
    put(ball, SPOTS[0][0], SPOTS[0][1], 0, heading === 'up' ? 3 : -3);
    (game.sim as any).report({ kind: 'switch', id, ball });
    run(DT);
    park(DT, ball);
  };
  /** The shots counted (the goal cues) and the states sent while `play` runs. */
  const counted = (play: () => void) => {
    const mark = msgs.length;
    play();
    return { shots: questCuesSince(mark).filter((c) => c.cue === 'goal').length, states: statesSince(mark).length };
  };
  const NONE = { shots: 0, states: 0 };
  const switches = TABLE_IN_USE.switches.map((s) => s.id).sort();
  assert.deepEqual(switches, ['orbit-left', 'orbit-right', 'ramp-dish', 'ramp-gate'], "the table's switches");
  // With no mode running, no pass counts, either way, and none sends the state.
  for (const id of switches) {
    for (const heading of ['up', 'down'] as const) assert.deepEqual(counted(() => pass(id, heading)), NONE, `${id}, heading ${heading}, with no mode`);
  }
  /** Sun Chase from its start on a cleared table, with Ray's ball parked. */
  const sunChase = () => {
    ball = freshBall(ray);
    park(0.2, ball);
    hitParked({ kind: 'bank', id: 'bank-ra', ball }, ball);
    park(0.3, ball);
    assert.equal(quest().mode?.god, 'ra', 'Sun Chase runs');
  };
  // In Sun Chase, what counts nothing, and so sends no state.
  const nothing: [string, () => void][] = [
    ['up the left lane and back down it: it fell back', () => (pass('orbit-left', 'up'), park(1, ball), pass('orbit-left', 'down'))],
    ['up the right lane and back down it', () => (pass('orbit-right', 'up'), park(1, ball), pass('orbit-right', 'down'))],
    ['down a lane with no pass up before it, as a launch comes round the arch and down the left lane', () => pass('orbit-left', 'down')],
    [`up one lane and down the other more than ${ORBIT_ROUND} s later`, () => (pass('orbit-left', 'up'), park(ORBIT_ROUND + 0.1, ball), pass('orbit-right', 'down'))],
    ['up the left lane, then up the right, which takes its place, and back down the right', () => (pass('orbit-left', 'up'), pass('orbit-right', 'up'), pass('orbit-right', 'down'))],
    ['out of the dish and back down the left ramp past its switch', () => pass('ramp-dish', 'down')],
  ];
  for (const [what, play] of nothing) {
    sunChase();
    assert.deepEqual(counted(play), NONE, what);
  }
  // What counts: a shot each, and the state is sent with it.
  const shots: [string, () => void][] = [
    [`up the left lane and down the right within ${ORBIT_ROUND} s`, () => (pass('orbit-left', 'up'), park(ORBIT_ROUND - 0.1, ball), pass('orbit-right', 'down'))],
    ['up the right lane and down the left', () => (pass('orbit-right', 'up'), park(1, ball), pass('orbit-left', 'down'))],
    ['up the left lane, then up the right, which takes its place, and down the left', () => (pass('orbit-left', 'up'), pass('orbit-right', 'up'), pass('orbit-left', 'down'))],
    ['round the orbit, and on down past the same switch again: one shot', () => (pass('orbit-left', 'up'), pass('orbit-right', 'down'), park(1, ball), pass('orbit-right', 'down'))],
    ['up the left ramp into the dish', () => pass('ramp-dish', 'up')],
    ["out through the gate's gap, heading up the table", () => pass('ramp-gate', 'up')],
    ["out through the gate's gap, heading down it", () => pass('ramp-gate', 'down')],
  ];
  for (const [what, play] of shots) {
    sunChase();
    const made = counted(play);
    assert.equal(made.shots, 1, `${what}: a shot`);
    assert.ok(made.states > 0, `${what}: and the state sent`);
  }
});

step('a mode out of time: the toy put away, no prize; a bank matched during a mode pays 5,000 and starts nothing', () => {
  const dot = viewer('dot', 'Dot');
  const ball = freshBall(dot);
  hitParked({ kind: 'bank', id: 'bank-ankh', ball }, ball);
  park(0.3, ball);
  // Some of its goal made, short of all of it.
  if (QUEST.goals.ankh > 1) hitParked({ kind: 'target', id: mummy.id, ball }, ball);
  const running = quest().mode!;
  // A bank matched during the mode pays its bonus, as any match does, and starts nothing.
  let mark = msgs.length;
  let before = scoreOf(dot);
  hitParked({ kind: 'bank', id: 'bank-eye', ball }, ball);
  assert.equal(scoreOf(dot) - before, bankOf('eye').bonus, "the Eye bank's bonus");
  assert.equal(lastFeed(), `Dot matched the Eye bank! +${bankOf('eye').bonus.toLocaleString('en-US')}`);
  assert.deepEqual(questCuesSince(mark), [], 'no mode starts');
  assert.deepEqual([quest().mode?.god, quest().mode?.progress], ['ankh', running.progress], 'The Mummy Wakes runs on');
  assert.equal(game.toyWanted('tomb'), false, "and the Eye's toy is not asked for");
  // Its time runs out: the toy is put away, nothing is paid, and the god is left to try again.
  mark = msgs.length;
  before = scoreOf(dot);
  park(quest().mode!.left + 0.1, ball);
  const lost = questCuesSince(mark);
  assert.deepEqual(lost, [{ kind: 'pinballCue', cue: 'modeLost', god: 'ankh', at: lost[0]?.at }], 'it is lost');
  assert.equal(scoreOf(dot), before, 'no prize: nothing paid');
  assert.equal(game.toyWanted('mummy'), false, 'the mummy is put away');
  assert.equal(game.sim.targetsDown() & targetBit(mummy.id), targetBit(mummy.id), 'down');
  assert.deepEqual(quest(), { done: [], mode: null, finale: null }, 'Ankh is not crossed off');
});

step('the finale: multiball, the toys up, jackpots climbing, each toy back up after it goes down; it ends with multiball (the held lock ball let go as today) and the quest starts over', () => {
  const fin = viewer('fin', 'Fin');
  const gil = viewer('gil', 'Gil');
  const ball = freshBall(fin);
  crossOff(ball, 'ra', 'horus', 'ankh');
  hitParked({ kind: 'bank', id: 'bank-eye', ball }, ball);
  // During Tomb Raid the lock is lit and Fin's ball goes in: multiball, with Gil's ball from the line and the house's.
  say(gil, 'ball');
  game.knockAllTargets(ball);
  put(ball, TABLE_IN_USE.lock.x, TABLE_IN_USE.lock.z);
  run(DT);
  assert.equal(game.sim.heldBy(ball), 'lock', "Fin's ball is held in the lock");
  for (let i = 0; i < 3 / DT && game.sim.items.size < 3; i++) run(DT);
  const gils = ballOf(gil)!;
  const house = ballOf(null)!;
  assert.ok(gils !== undefined && house !== undefined, "Gil's ball and the house's came");
  park(0.5, gils, house);
  // Gil's ball wins Tomb Raid, crossing off the fourth god, and the finale begins. Multiball is on already (the
  // lock's), so it brings no more balls; the pop-ups and the mummy rise to join the open tomb.
  for (let n = 1; n < QUEST.goals.eye; n++) hitParked({ kind: 'tomb', id: TOMB.id, ball: gils }, gils, house);
  let mark = msgs.length;
  rollAtTomb(gils);
  assert.ok(stepUntil(() => quest().finale !== null, () => 0, [house], 1), 'the fourth god crossed off begins the finale');
  assert.deepEqual(questSaid(mark), ['goal', 'modeWon', 'finale']);
  assert.deepEqual(quest(), { done: [...GODS], mode: null, finale: { jackpot: QUEST.jackpot.first } }, 'every god crossed off, and the first jackpot to play for');
  assert.equal(game.state().multiball, true, 'multiball');
  assert.deepEqual(wanted(), [true, true, true, false], 'the pop-ups, the mummy and the tomb wanted up, and the gate not');
  (game.sim as any).tombHold.until = game.sim.time;
  park(1, gils, house);
  assert.equal(game.sim.targetsDown() & RISING, 0, 'the pop-ups and the mummy are up');
  assert.equal(game.sim.tombOpen, true, 'and the tomb open');
  assert.equal(game.sim.items.size, 3, 'no more balls came');
  // Each ball the tomb catches is a jackpot, each QUEST.jackpot.step more than the last: the house ball's first,
  // then Gil's.
  parkTillStill(gils, house);
  for (const [k, id] of [house, gils].entries()) {
    const value = QUEST.jackpot.first + k * QUEST.jackpot.step;
    mark = msgs.length;
    rollAtTomb(id);
    const caught = stepUntil(() => game.sim.heldBy(id) === 'tomb', () => pointsOn(id), [house, gils].filter((x) => x !== id), 1);
    assert.ok(caught, `catch ${k + 1}`);
    assert.equal(caught.after - caught.before, TOMB.points + value, `catch ${k + 1}: the tomb's points and a jackpot of ${value}, to that ball`);
    const said = questCuesSince(mark);
    assert.deepEqual(said.map((c) => c.cue), ['jackpot'], `catch ${k + 1}: a jackpot to the stages`);
    assert.ok(said[0].cue === 'jackpot' && said[0].value === value && nearTo(said[0], TOMB.held[0], TOMB.held[1]), `of ${value}, where the tomb holds the ball`);
    assert.deepEqual(quest().finale, { jackpot: value + QUEST.jackpot.step }, 'and the next jackpot shown');
    (game.sim as any).tombHold.until = game.sim.time;
    park(1, gils, house);
  }
  // A pop-up knocked down pays as in Falcon Strike, and comes back up QUEST.finaleRaise seconds of play later.
  const isDown = (id: string) => (game.sim.targetsDown() & targetBit(id)) !== 0;
  const first = popups[0];
  aim(gils, atFace(first));
  const knocked = stepUntil(() => isDown(first.id), () => pointsOn(gils), [house], 2);
  assert.ok(knocked, `${first.id} knocked down`);
  assert.equal(knocked.after - knocked.before, first.points + QUEST.goalPoints, "its points and a goal hit's");
  park(QUEST.finaleRaise - 0.25, gils, house);
  assert.ok(isDown(first.id), 'still down short of its time');
  park(0.5, gils, house);
  assert.ok(!isDown(first.id), 'and back up after it');
  // The mummy, put down by its third hit (the game's rule for it), comes back up after as long, with its hits counted
  // afresh: each pays as in The Mummy Wakes, and it takes MUMMY_HITS more to put it down again.
  const hitMummy = () => hitParked({ kind: 'target', id: mummy.id, ball: gils }, gils, house);
  const before = pointsOn(gils);
  hitMummy();
  assert.equal(pointsOn(gils) - before, mummy.points + QUEST.goalPoints, "a hit on it pays its points and a goal hit's");
  for (let i = 1; i < MUMMY_HITS; i++) hitMummy();
  assert.ok(isDown(mummy.id), `down on hit ${MUMMY_HITS}`);
  park(QUEST.finaleRaise - 0.25, gils, house);
  assert.ok(isDown(mummy.id), 'still down short of its time');
  park(0.5, gils, house);
  assert.ok(!isDown(mummy.id), 'and back up after it');
  for (let i = 1; i < MUMMY_HITS; i++) hitMummy();
  assert.ok(!isDown(mummy.id), 'its hits counted from when it rose again');
  hitMummy();
  assert.ok(isDown(mummy.id), `so hit ${MUMMY_HITS} since puts it down`);
  // It ends with multiball. Gil's ball drains (past its saver, so it is paid): two balls are left, and the lock lets
  // Fin's go, as it does today once the others are down to one.
  park(RULES.ballSaverStart, gils, house);
  drain(gils);
  assert.equal(game.sim.heldBy(ball), null, "the lock lets Fin's ball go");
  park(0.2, ball, house);
  assert.equal(game.state().multiball, true, 'multiball goes on with the two');
  assert.notEqual(quest().finale, null, 'and the finale with it');
  // The house ball drains, and one ball is left: multiball is over, and the finale with it. Its toys go away, and the
  // quest starts over.
  mark = msgs.length;
  drain(house);
  assert.equal(game.state().multiball, false, 'one ball left: multiball is over');
  assert.deepEqual(questSaid(mark), ['finaleEnd'], 'and the finale');
  assert.deepEqual(quest(), { done: [], mode: null, finale: null }, 'no god done');
  assert.deepEqual(wanted(), [false, false, false, false], 'every toy put away');
  park(0.5, ball);
  assert.equal(game.sim.targetsDown() & RISING, RISING, 'the pop-ups and the mummy down');
  assert.equal(game.sim.tombOpen, false, 'the tomb shut');
  mark = msgs.length;
  hitParked({ kind: 'bank', id: 'bank-eye', ball }, ball);
  assert.deepEqual(questSaid(mark), ['modeStart'], 'a match starts a mode again');
});

step("the fourth god crossed off by a ball that then drains still starts the finale, with the next ball's multiball", () => {
  const kai = viewer('kai', 'Kai');
  const lux = viewer('lux', 'Lux');
  const ball = freshBall(kai);
  park(RULES.ballSaverStart, ball);
  crossOff(ball, 'ra', 'horus', 'ankh');
  hitParked({ kind: 'bank', id: 'bank-eye', ball }, ball);
  say(lux, 'ball');
  // Kai's ball crosses off the Eye, the fourth god: the finale begins, with multiball and its balls to come.
  const mark = msgs.length;
  goalHits('eye', ball);
  assert.deepEqual(questSaid(mark).slice(-2), ['modeWon', 'finale'], 'the fourth god crossed off begins the finale');
  assert.equal(game.state().multiball, true, 'multiball');
  // And it drains straight away, past its saver: paid as any ball is, with its prize.
  const points = scoreOf(kai);
  drain(ball);
  assert.deepEqual(game.state().lastResult, { name: 'Kai', points, coins: Math.floor(points / RULES.pointsPerCoin) }, "Kai's ball is paid as any");
  assert.notEqual(quest().finale, null, 'the finale runs on');
  assert.equal(game.state().multiball, true, 'and its multiball');
  // Multiball's balls come: Lux's, next in line, and then the house's.
  for (let i = 0; i < 3 / DT && game.sim.items.size < 2; i++) run(DT);
  assert.deepEqual([...game.sim.items.values()].map((b) => b.owner).sort(), [lux.id, null].sort(), "Lux's ball from the line, and the house's");
  assert.equal(game.state().line.length, 0);
  assert.notEqual(quest().finale, null, 'the finale on with them');
});

step("the finale starting while multiball is on brings no more balls; a house ball's jackpot pays nobody", () => {
  const mae = viewer('mae', 'Mae');
  const ball = freshBall(mae);
  crossOff(ball, 'ra', 'horus', 'ankh');
  hitParked({ kind: 'bank', id: 'bank-eye', ball }, ball);
  // Multiball pressed during Tomb Raid, with nobody in line: two house balls.
  game.action(hypeAction('multiball'));
  for (let i = 0; i < 3 / DT && game.sim.items.size < 3; i++) park(DT, ball);
  const [h1, h2] = [...game.sim.items.keys()].filter((id) => id !== ball);
  assert.ok(h1 !== undefined && h2 !== undefined, 'two house balls came');
  park(0.2, ball, h1, h2);
  // Mae's ball crosses off the Eye: the finale begins, and brings no more balls.
  let mark = msgs.length;
  for (let n = 0; n < QUEST.goals.eye; n++) hitParked({ kind: 'tomb', id: TOMB.id, ball }, ball, h1, h2);
  assert.deepEqual(questSaid(mark).slice(-2), ['modeWon', 'finale'], 'the finale begins');
  park(2, ball, h1, h2);
  assert.equal(game.sim.items.size, 3, 'no more balls');
  assert.ok(!msgs.slice(mark).some((m) => m.t === 'spawn'), 'none launched');
  // A house ball's jackpot is that ball's points, and a house ball pays nobody.
  mark = msgs.length;
  rollAtTomb(h1);
  const caught = stepUntil(() => game.sim.heldBy(h1) === 'tomb', () => pointsOn(h1), [ball, h2], 1);
  assert.ok(caught, 'the tomb caught a house ball');
  assert.equal(caught.after - caught.before, TOMB.points + QUEST.jackpot.first, 'its jackpot, on the house ball');
  (game.sim as any).tombHold.until = game.sim.time;
  park(RULES.ballSaverStart, ball, h1, h2);
  mark = msgs.length;
  const before = balance(mae);
  const points = pointsOn(h1);
  drain(h1);
  assert.ok(!msgs.slice(mark).some((m) => m.t === 'score'), 'nobody paid');
  assert.equal(balance(mae), before);
  assert.equal(lastFeed(), `The house ball: ${points.toLocaleString('en-US')} points.`);
});

step('a restart mid-mode resumes it from the save, its toy asked for again; mid-finale, the finale begins again with the next ball; no prize is paid twice', () => {
  const nia = viewer('nia', 'Nia');
  let ball = freshBall(nia);
  crossOff(ball, 'ra');
  hitParked({ kind: 'bank', id: 'bank-ankh', ball }, ball);
  if (QUEST.goals.ankh > 1) hitParked({ kind: 'target', id: mummy.id, ball }, ball);
  park(2, ball);
  const was = quest().mode!;
  // The server restarts in the middle of The Mummy Wakes: a new game from the save file, with no ball on the table.
  restart();
  assert.deepEqual(quest().done, ['ra'], 'the gods crossed off come back');
  const mode = quest().mode!;
  assert.deepEqual({ ...mode, at: 0 }, { ...was, at: 0, running: false }, 'its time left and its progress come back, its clock standing still with no ball in play');
  assert.equal(game.toyWanted('mummy'), true, 'its toy is asked for again');
  run(0.5);
  assert.ok(TOY_UP.ankh(), 'and comes up');
  assert.equal(quest().mode!.left, mode.left, 'with no ball in play, its time stands still');
  // Nia's next ball picks it up, and its hits win it: one prize.
  say(nia, 'ball');
  run(RULES.launchDelay + 0.2);
  ball = ballOf(nia)!;
  park(0.2, ball);
  let mark = msgs.length;
  const before = scoreOf(nia);
  for (let i = mode.progress; i < QUEST.goals.ankh; i++) hitParked({ kind: 'target', id: mummy.id, ball }, ball);
  assert.deepEqual(questSaid(mark).filter((c) => c === 'modeWon'), ['modeWon'], 'it is won');
  assert.equal(scoreOf(nia) - before, (QUEST.goals.ankh - mode.progress) * (mummy.points + QUEST.goalPoints) + QUEST.prize, 'its goals and the prize, once');
  assert.deepEqual(quest().done, ['ra', 'ankh']);
  // A restart after the win brings back the gods done, and plays nothing again.
  mark = msgs.length;
  const balanceWas = balance(nia);
  restart();
  run(0.5);
  assert.deepEqual(quest(), { done: ['ra', 'ankh'], mode: null, finale: null }, 'Ra and Ankh are done, and nothing runs');
  assert.deepEqual(questCuesSince(mark), [], 'no moment again');
  assert.equal(balance(nia), balanceWas, 'nothing paid');
  // In the middle of the finale, a restart waits for a ball in play, and the finale begins again with it: multiball
  // and its toys, from the first jackpot.
  say(nia, 'ball');
  run(RULES.launchDelay + 0.2);
  ball = ballOf(nia)!;
  park(0.2, ball);
  crossOff(ball, 'horus', 'eye');
  hitParked({ kind: 'tomb', id: TOMB.id, ball }, ball);
  assert.deepEqual(quest().finale, { jackpot: QUEST.jackpot.first + QUEST.jackpot.step }, 'the finale, one jackpot in');
  restart();
  assert.deepEqual(quest(), { done: [...GODS], mode: null, finale: null }, 'every god done, and the finale waiting');
  assert.deepEqual(wanted(), [false, false, false, false], 'its toys wait with it');
  run(1);
  assert.equal(quest().finale, null, 'no ball in play: it waits');
  assert.equal(game.state().multiball, false);
  mark = msgs.length;
  say(nia, 'ball');
  for (let i = 0; i < 3 / DT && ballOf(nia) === undefined; i++) run(DT);
  assert.ok(ballOf(nia) !== undefined, "Nia's ball is on the table");
  assert.deepEqual(questSaid(mark), ['finale'], 'it begins again with the ball in play');
  assert.deepEqual(quest().finale, { jackpot: QUEST.jackpot.first }, 'from the first jackpot');
  assert.equal(game.state().multiball, true, 'with multiball');
  assert.deepEqual(wanted(), [true, true, true, false], 'and its toys');
  run(1.5);
  assert.equal(game.sim.items.size, 1 + RULES.maxExtraBalls, "multiball's balls came");
  // A saved quest the quest can't take starts it afresh, and the log says so, once, as it says of high scores it can't
  // read. A file with no quest (saved before there was one) or an empty one has nothing to say.
  const said: unknown[][] = [];
  const { info, warn } = log;
  log.info = () => {};
  log.warn = (...args: unknown[]) => void said.push(args);
  try {
    /** A game loaded from a save file with this quest in it (none if undefined): its quest, and what was warned. */
    const loaded = (saved: unknown) => {
      writeFileSync(saveFile, JSON.stringify({ highScores: [], ...(saved === undefined ? {} : { quest: saved }) }));
      said.length = 0;
      const back = new PinballGame(room, economy, { send: () => {} }, saveFile);
      back.load();
      return { quest: back.state().quest, warned: said.map((args) => String(args[0])) };
    };
    const afresh = { quest: { done: [], mode: null, finale: null }, warned: ['pinball: could not read the saved quest; starting it afresh'] };
    assert.deepEqual(loaded({ done: ['zeus'], mode: null, finale: false }), afresh, 'a god that is none');
    assert.deepEqual(loaded({ done: [...GODS], mode: null, finale: false }), afresh, 'every god done with no finale');
    assert.deepEqual(loaded({ done: [], mode: { god: 'ra', left: -1, progress: 0 }, finale: false }), afresh, 'a mode with no time left');
    assert.deepEqual(loaded(null), afresh, 'a quest that is null');
    assert.deepEqual(loaded(undefined), { ...afresh, warned: [] }, 'no quest in the file');
    assert.deepEqual(loaded({ done: [], mode: null, finale: false }), { ...afresh, warned: [] }, 'an empty quest');
    assert.deepEqual(loaded({ done: ['ra'], mode: null, finale: false }), { quest: { done: ['ra'], mode: null, finale: null }, warned: [] }, 'one it takes');
  } finally {
    Object.assign(log, { info, warn });
  }
});

step('the Reset mid-mode and mid-finale puts every toy away and clears the quest', () => {
  const oz = viewer('oz', 'Oz');
  let ball = freshBall(oz);
  crossOff(ball, 'ra');
  hitParked({ kind: 'bank', id: 'bank-eye', ball }, ball);
  park(0.3, ball);
  assert.ok(TOY_UP.eye(), 'Tomb Raid: the tomb is open');
  let mark = msgs.length;
  const before = balance(oz);
  /** Everything as a cleared table has it: the quest empty, every toy put away, and no moment told of it. */
  const cleared = (what: string) => {
    assert.deepEqual(quest(), { done: [], mode: null, finale: null }, `${what}: the quest is cleared`);
    assert.deepEqual(wanted(), [false, false, false, false], `${what}: no toy wanted`);
    assert.equal(game.sim.targetsDown() & RISING, RISING, `${what}: the pop-ups and the mummy down`);
    assert.equal(game.sim.tombOpen, false, `${what}: the tomb shut`);
    assert.equal(game.sim.diverterOver, false, `${what}: the gate at rest`);
    assert.deepEqual(questCuesSince(mark), [], `${what}: no moment for it`);
  };
  game.resetMachine();
  cleared('mid-mode');
  assert.equal(balance(oz), before, 'nothing paid');
  game.save();
  assert.deepEqual(JSON.parse(readFileSync(saveFile, 'utf8')).quest, { done: [], mode: null, finale: false }, 'and it is saved cleared');
  run(1);
  cleared('a second on');
  // In the middle of the finale, its balls still coming.
  ball = freshBall(oz);
  crossOff(ball, ...GODS);
  park(0.3, ball);
  assert.notEqual(quest().finale, null, 'the finale');
  assert.equal(game.state().multiball, true);
  mark = msgs.length;
  game.resetMachine();
  cleared('mid-finale');
  assert.equal(game.state().multiball, false, 'multiball is off');
  run(2);
  assert.equal(game.sim.items.size, 0, "and none of the finale's balls comes");
  cleared('two seconds on');
});

step('each quest moment is a cue to the stages, never in hello; pinballCueOf reads each kind and nothing malformed', () => {
  const pia = viewer('pia', 'Pia');
  const ball = freshBall(pia);
  park(0.2, ball);
  const where = () => game.sim.items.get(ball)!.body.translation();
  // A mode started, each goal hit at the ball's place, and the mode won with its prize.
  let mark = msgs.length;
  hitParked({ kind: 'bank', id: 'bank-ankh', ball }, ball);
  assert.deepEqual(questCuesSince(mark), [{ kind: 'pinballCue', cue: 'modeStart', god: 'ankh', at: questCuesSince(mark)[0]?.at }]);
  for (let i = 1; i <= QUEST.goals.ankh; i++) {
    mark = msgs.length;
    hitParked({ kind: 'target', id: mummy.id, ball }, ball);
    const [goal, ...rest] = questCuesSince(mark);
    assert.ok(goal.cue === 'goal' && goal.god === 'ankh' && nearTo(goal, where().x, where().z), `goal hit ${i}, where the ball was: ${JSON.stringify(goal)}`);
    assert.deepEqual(Object.keys(goal).sort(), ['at', 'cue', 'god', 'kind', 'x', 'z']);
    if (i < QUEST.goals.ankh) assert.deepEqual(rest, []);
    else assert.deepEqual(rest, [{ kind: 'pinballCue', cue: 'modeWon', god: 'ankh', prize: QUEST.prize, at: goal.at }], 'and then the mode won, with its prize');
  }
  // A mode lost.
  mark = msgs.length;
  hitParked({ kind: 'bank', id: 'bank-horus', ball }, ball);
  park(QUEST.modeSeconds + 0.1, ball);
  assert.deepEqual(questCuesSince(mark).map((c) => ({ ...c, at: 0 })), [
    { kind: 'pinballCue', cue: 'modeStart', god: 'horus', at: 0 },
    { kind: 'pinballCue', cue: 'modeLost', god: 'horus', at: 0 },
  ]);
  // The finale begun, a jackpot where the tomb holds the ball, and the finale over when multiball is.
  mark = msgs.length;
  crossOff(ball, 'ra', 'horus', 'eye');
  const finale = questCuesSince(mark).at(-1);
  assert.deepEqual(finale, { kind: 'pinballCue', cue: 'finale', at: finale?.at });
  for (let i = 0; i < 3 / DT && game.sim.items.size < 3; i++) park(DT, ball);
  const others = [...game.sim.items.keys()].filter((id) => id !== ball);
  park(0.2, ball, ...others);
  mark = msgs.length;
  rollAtTomb(ball);
  assert.ok(stepUntil(() => game.sim.heldBy(ball) === 'tomb', () => 0, others, 1), 'the tomb caught the ball');
  const [jackpot] = questCuesSince(mark);
  assert.ok(jackpot?.cue === 'jackpot' && jackpot.value === QUEST.jackpot.first && nearTo(jackpot, TOMB.held[0], TOMB.held[1]), `a jackpot where the tomb holds the ball: ${JSON.stringify(jackpot)}`);
  assert.deepEqual(Object.keys(jackpot).sort(), ['at', 'cue', 'kind', 'value', 'x', 'z']);
  (game.sim as any).tombHold.until = game.sim.time;
  park(RULES.ballSaverStart, ball, ...others);
  drain(others[0]);
  mark = msgs.length;
  drain(others[1]);
  const over = questCuesSince(mark);
  assert.deepEqual(over, [{ kind: 'pinballCue', cue: 'finaleEnd', at: over[0]?.at }]);
  // Every cue the game has sent, of every kind, reads back as itself: as it was sent, and off the wire.
  const sent = msgs.flatMap((m) => (m.t === 'machine' && (m.msg as { kind?: unknown }).kind === 'pinballCue' ? [m.msg as { cue: string }] : []));
  assert.deepEqual([...new Set(sent.map((m) => m.cue))].sort(), ['finale', 'finaleEnd', 'goal', 'jackpot', 'modeLost', 'modeStart', 'modeWon', 'toyHit'], 'every kind was sent');
  for (const m of sent) {
    assert.deepEqual(pinballCueOf(m), m, `${JSON.stringify(m)} reads as itself`);
    assert.deepEqual(pinballCueOf(JSON.parse(JSON.stringify(m))), m, 'off the wire too');
  }
  // A cue is a moment, never in hello: a page that opens mid-mode is sent the state alone.
  hitParked({ kind: 'bank', id: 'bank-ra', ball }, ball);
  const hello = game.hello();
  assert.ok(hello.t === 'hello');
  assert.equal(pinballStateOf(hello.machine)?.quest.mode?.god, 'ra', "hello's machine is the state, with the mode in it");
  assert.ok(!JSON.stringify(hello).includes('pinballCue'), 'and no cue anywhere in hello');

  // pinballCueOf: each kind with its own fields comes back as it is.
  const good: PinballCueMsg[] = [
    { kind: 'pinballCue', cue: 'modeStart', god: 'ra', at: 1 },
    { kind: 'pinballCue', cue: 'goal', god: 'horus', x: 1.5, z: 6.5, at: 2 },
    { kind: 'pinballCue', cue: 'modeWon', god: 'eye', prize: 38000, at: 3 },
    { kind: 'pinballCue', cue: 'modeLost', god: 'ankh', at: 4 },
    { kind: 'pinballCue', cue: 'jackpot', value: 75000, x: -0.4, z: 5.68, at: 5 },
    { kind: 'pinballCue', cue: 'finale', at: 6 },
    { kind: 'pinballCue', cue: 'finaleEnd', at: 7 },
  ];
  for (const c of good) {
    assert.deepEqual(pinballCueOf(c), c, `${c.cue} reads`);
    assert.deepEqual(pinballCueOf(JSON.parse(JSON.stringify(c))), c, `${c.cue} off the wire`);
    assert.equal(pinballCueOf({ ...c, at: undefined }), null, `${c.cue} with no time`);
    assert.equal(pinballCueOf({ ...c, at: '3' }), null, `${c.cue} with a time that is no number`);
    assert.equal(pinballCueOf({ ...c, kind: 'pinballHype' }), null, `${c.cue} in another kind of message`);
  }
  // And one malformed for its kind is nothing.
  const [startCue, goalCue, wonCue, lostCue, jackpotCue] = good;
  const bad: [string, unknown][] = [
    ['a mode started with no god', { ...startCue, god: undefined }],
    ['a mode started for a god that is none', { ...startCue, god: 'zeus' }],
    ["a god named from Object's prototype", { ...startCue, god: 'constructor' }],
    ['a goal of a god in capitals', { ...goalCue, god: 'HORUS' }],
    ['a goal with no x', { ...goalCue, x: undefined }],
    ['a goal at a z that is no number', { ...goalCue, z: NaN }],
    ['a mode won with no prize', { ...wonCue, prize: undefined }],
    ['a mode won with its prize a string', { ...wonCue, prize: '38000' }],
    ['a mode won with a prize without end', { ...wonCue, prize: Infinity }],
    ['a mode lost for a god that is a number', { ...lostCue, god: 1 }],
    ['a jackpot with no value', { ...jackpotCue, value: undefined }],
    ['a jackpot whose value is null (what JSON makes of NaN)', { ...jackpotCue, value: null }],
    ['a jackpot with no z', { ...jackpotCue, z: undefined }],
    ['a cue of a kind no page knows', { kind: 'pinballCue', cue: 'tilt', at: 1 }],
    ["a cue named from Object's prototype", { kind: 'pinballCue', cue: 'toString', at: 1 }],
    ['a cue that says no kind of cue', { kind: 'pinballCue', at: 1 }],
  ];
  for (const [what, m] of bad) assert.equal(pinballCueOf(m), null, what);
});

step("the dev host's quest action starts a mode or the finale only with PINBALL_TOYS=1", () => {
  const was = process.env.PINBALL_TOYS;
  try {
    const sid = viewer('sid', 'Sid');
    const ball = freshBall(sid);
    park(0.2, ball);
    const empty = { done: [], mode: null, finale: null };
    delete process.env.PINBALL_TOYS;
    game.action({ kind: 'quest', start: 'horus' });
    game.action({ kind: 'quest', start: 'finale' });
    park(0.2, ball);
    assert.deepEqual(quest(), empty, 'without PINBALL_TOYS the action is ignored like any unknown one');
    process.env.PINBALL_TOYS = '0';
    game.action({ kind: 'quest', start: 'horus' });
    assert.deepEqual(quest(), empty, 'only 1 switches it on');
    process.env.PINBALL_TOYS = '1';
    let mark = msgs.length;
    game.action({ kind: 'quest', start: 'horus' });
    assert.equal(quest().mode?.god, 'horus', 'with PINBALL_TOYS=1 it starts the mode');
    assert.deepEqual(questSaid(mark), ['modeStart']);
    park(0.3, ball);
    assert.ok(TOY_UP.horus(), 'its toy comes up');
    // Anything else is ignored: a god that is none, a start that is no god's name, or no start at all.
    const running = quest();
    for (const start of ['zeus', '', 'constructor', 'Finale', 'RA', 7, null, ['ra'], {}, undefined]) game.action({ kind: 'quest', start });
    game.action({ kind: 'quest' });
    assert.deepEqual(quest(), running, 'none of that changed the quest');
    // The finale now: the mode ends with no moment of its own, every god is crossed off, and multiball and toys come.
    mark = msgs.length;
    game.action({ kind: 'quest', start: 'finale' });
    assert.deepEqual(quest(), { done: [...GODS], mode: null, finale: { jackpot: QUEST.jackpot.first } });
    assert.deepEqual(questSaid(mark), ['finale']);
    assert.equal(game.state().multiball, true, 'multiball');
    assert.deepEqual(wanted(), [true, true, true, false], 'the pop-ups, the mummy and the tomb');
    // And a mode in place of the finale: it ends with no moment, and the quest starts over with the mode.
    mark = msgs.length;
    game.action({ kind: 'quest', start: 'ra' });
    assert.deepEqual(questSaid(mark), ['modeStart']);
    assert.deepEqual([quest().done, quest().mode?.god, quest().finale], [[], 'ra', null]);
  } finally {
    if (was === undefined) delete process.env.PINBALL_TOYS;
    else process.env.PINBALL_TOYS = was;
  }
});

for (const [name, fn] of steps) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}`);
    console.log(err);
    break;
  }
}
game = undefined as unknown as PinballGame;
economy.close();
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows may still hold the database open; the temp folder is left.
}
if (failed) process.exit(1);
console.log(`pinball-test: ${steps.length} steps passed`);
