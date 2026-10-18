// Tests the pinball game (server/game.ts) headlessly, with the real physics and wallet: the line of viewers' balls, the
// flippers and the auto-save, paying a drained ball (the owner sharing the 30% when they flipped), multiball, the ball
// saver, the table's clock, a stuck ball (nudged, then launched again), flip words only while the table runs, the high
// scores and the reset, the parts of the pyramid, and the quest's toys (the game raises, opens and swings them as it is
// asked, each waiting for a ball in its way; the mummy goes down on its third hit; a ball in the tomb scores and isn't
// stuck; a reset puts every toy away; the dev host's toy action works only with PINBALL_TOYS). Each step builds on the
// last, as the claw's claw-test does.
// Usage: npm run pinball-test (or npx tsx tests/pinball-test.ts)
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy, initPhysics, roomInfo, type User } from '@kit/server';
import type { ServerMsg } from '@kit/shared';
import { entry } from '../src/entry';
import { PinballGame, type Toy } from '../src/server/game';
import { DT, PinballSim } from '../src/server/sim';
import { LIT, RULES, TOY } from '../src/shared/pinball';
import { TABLE_IN_USE, TABLE, isLockTarget } from '../src/shared/table';

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
