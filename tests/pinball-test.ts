// Tests the pinball game (server/game.ts) headlessly, with the real physics and wallet: the line of viewers' balls, the
// flippers and the auto-save, paying a drained ball, multiball, the ball saver, the table's clock, a stuck ball, the
// high scores and the reset. Each step builds on the last, as the claw's claw-test does.
// Usage: npm run pinball-test (or npx tsx tests/pinball-test.ts)
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy, initPhysics, roomInfo, type User } from '@kit/server';
import type { ServerMsg } from '@kit/shared';
import { entry } from '../src/entry';
import { PinballGame } from '../src/server/game';
import { DT } from '../src/server/sim';
import { RULES } from '../src/shared/pinball';
import { STAND_IN, TABLE } from '../src/shared/table';

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
  put(id, -0.4, STAND_IN.drainZ - 0.05, 0, -5);
  run(DT);
  assert.ok(!game.sim.items.has(id), `ball ${id} drained`);
}
/** Where a ball sits on the left flipper at rest, rolling toward its tip. */
const onLeftFlipper = (id: number) => put(id, -1.2, 2.1);
const left = STAND_IN.flippers.find((f) => f.side === 'left')!;
const right = STAND_IN.flippers.find((f) => f.side === 'right')!;
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
  assert.equal(game.state().lockLit, true, 'all 4 targets down light the lock');
  put(held, STAND_IN.lock.x, STAND_IN.lock.z);
  run(DT);
  assert.equal(game.state().lockLit, false, 'the lock took the ball');
  assert.equal(game.state().multiball, true);
  run(2);
  assert.equal(game.sim.items.size, 3, '3 balls on the table');
  assert.deepEqual([...game.sim.items.values()].map((b) => b.owner).sort(), [gus.id, hal.id, null].sort());
  assert.equal(game.state().line.length, 0, "Hal's ball came from the line");
  const p = game.sim.items.get(held)!.body.translation();
  assert.ok(Math.hypot(p.x - STAND_IN.lock.x, p.z - STAND_IN.lock.z) < 0.01, "Gus's ball is held in the lock");
});

step('a house ball pays nobody', () => {
  const house = ballOf(null)!;
  // Past its ball saver, so the drain counts.
  hold(house, -0.4, 8, RULES.ballSaverStart + 0.1);
  game.addPoints(house, 5 * RULES.pointsPerCoin);
  const before = [ana, ben, cal, dan, fay, gus, hal].map(balance);
  const scores = msgs.filter((m) => m.t === 'score').length;
  drain(house);
  assert.deepEqual([ana, ben, cal, dan, fay, gus, hal].map(balance), before);
  assert.equal(msgs.filter((m) => m.t === 'score').length, scores, 'no score popups');
  assert.ok(feed().includes(`The house ball: ${(5 * RULES.pointsPerCoin).toLocaleString('en-US')} points.`));
  // That was the multiball's last ball but one (or Hal's went first): Gus's ball is let go.
  run(0.5);
  const p = game.sim.items.get(held)?.body.translation();
  assert.ok(!p || Math.hypot(p.x - STAND_IN.lock.x, p.z - STAND_IN.lock.z) > 0.2, "Gus's ball left the lock");
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
  assert.deepEqual([ivy, jon].map((u, i) => balance(u) - before[i]), [1, 1], 'the flippers still there are paid');
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
