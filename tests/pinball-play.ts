// Plays balls to see what a ball pays, rather than guessing at RULES.pointsPerCoin: viewers join one at a time with
// `ball`, and each ball runs until it drains. With nobody flipping only the auto-save plays. Prints the average and
// median points, coins and seconds (of table time, not wall time) per ball.
//
// It plays the Pharaoh's quest too, as the server does, and counts it from the cues the server sends the stages (the
// game's outlet is captured here): each god's modes started, won and lost, the finales and the jackpots. A ball is
// credited with what happens from its `ball` till the table is idle again, multiball's other balls included. It prints
// the spec's three aims (a mode finished about half the time, something big on most balls, the finale about once a
// stream, taken as 150 balls), and what a ball pays that finished no mode beside one that finished one (aim: 3 to 4
// times as much), with how often each is. `q.<name>=<number>` sets one of QUEST's numbers for the run (q.modeSeconds=45,
// q.goals.ra=2), so a setting can be measured before it's chosen.
//
// `chat=human` is a modelled chat instead of nobody: when a ball comes near a flipper, the ball's owner says that side
// after a reaction time (HUMAN), and now and then lets the ball by. Its flips are chat's, so the auto-save hands back
// for RULES.autoSaveAfter after each, as on a stream. HUMAN is calibrated so that a ball's seconds and its Ankh and Eye
// matches come within 15% of the spec's human-like column (HUMAN_AIM), and the run prints them beside it.
//
// `toys=up` raises every one of the quest's toys before the first ball (the pop-ups and the mummy up, the tomb open,
// the gate over) and asks again, every step, for whichever has gone down (a pop-up knocked down, the mummy put down by
// its third hit): the game moves a toy only when asked (setToy), so this is what keeps them up. `rates` also prints how
// often things happen: each bank matched, the pop-ups' and the mummy's hits, the tomb's catches, the lock's entries (a
// ball into its sensor, lit or not) and the dish's visits (a ball up on its floor, from the left ramp), each per ball
// and per 30 s of play. Play is the table's time from each `ball` to its drain (the seconds row's), so it counts each
// ball's launch delay too: a rate a mode's 30 s can count on.
// Usage: npm run pinball-play [-- balls=300 seed=1 chat=human q.modeSeconds=30 toys=up rates]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy, initPhysics, roomInfo } from '@kit/server';
import { entry } from '../src/entry';
import { PinballGame, type Toy } from '../src/server/game';
import { DT, type Hit } from '../src/server/sim';
import { GODS, pinballCueOf, QUEST, RULES, type God, type PinballCueMsg } from '../src/shared/pinball';
import { TABLE, TABLE_IN_USE } from '../src/shared/table';

await initPhysics();

const args = new Map(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const balls = Number(args.get('balls') ?? 300);
const toysUp = args.get('toys') === 'up';
const rates = args.has('rates');
const human = args.get('chat') === 'human';
if (args.has('chat') && !human) throw new Error(`chat=${args.get('chat')}: the only modelled chat is chat=human`);
let seed = Number(args.get('seed') ?? 1);
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
let now = Date.UTC(2026, 9, 17);
Date.now = () => now;

// A setting to measure: each q.<path>=<number> replaces that number of QUEST's for this run. Only a number QUEST has
// can be set, so a typo stops the run instead of measuring the starting numbers under another name.
const settings: string[] = [];
for (const [key, value] of args) {
  if (!key.startsWith('q.')) continue;
  const path = key.slice(2).split('.');
  let at = QUEST as unknown as Record<string, unknown>;
  for (const name of path.slice(0, -1)) {
    const next = Object.hasOwn(at, name) ? at[name] : undefined;
    if (typeof next !== 'object' || next === null) throw new Error(`${key}: QUEST has no ${name}`);
    at = next as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (!Object.hasOwn(at, last) || typeof at[last] !== 'number' || !Number.isFinite(Number(value))) {
    throw new Error(`${key}=${value}: not one of QUEST's numbers`);
  }
  at[last] = Number(value);
  settings.push(`${key.slice(2)}=${value}`);
}

const dir = mkdtempSync(join(tmpdir(), 'coinop-play-'));
const economy = new Economy(dir);
/** The quest's cues the server sends while the ball now up plays (cleared for each ball). */
let cues: PinballCueMsg[] = [];
const outlet = {
  send: (m: unknown) => {
    const sent = m as { t?: string; msg?: unknown };
    const cue = sent.t === 'machine' ? pinballCueOf(sent.msg) : null;
    if (cue && cue.cue !== 'toyHit') cues.push(cue);
  },
};
const game = new PinballGame(roomInfo(entry.id, entry.label), economy, outlet, join(dir, 'machine-pinball.json'));
game.load();

// The hits the game is told of, tallied on their way to it: the sim's handler is the game's, so this wraps it.
const T = TABLE_IN_USE;
const tally = new Map<string, number>();
const add = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);
const sim = game.sim;
const passOn = (sim as unknown as { hits: (hit: Hit) => void }).hits;
(sim as unknown as { hits: (hit: Hit) => void }).hits = (hit) => {
  if (hit.kind === 'bank') add(hit.id);
  else if (hit.kind === 'tomb') add('tomb catches');
  else if (hit.kind === 'lock') add('lock entries');
  else if (hit.kind === 'target') {
    const rise = T.targets.find((t) => t.id === hit.id)?.rise;
    if (rise === 'drop') add('pop-up hits');
    if (rise === 'hold') add('mummy hits');
  }
  passOn(hit);
};
/** The balls up on the dish's floor last step: a ball is counted once each time it gets up there. */
const onDish = new Set<number>();
const dishes = T.dishes;
function countDish(): void {
  for (const [id, ball] of sim.items) {
    const p = ball.body.translation();
    const on = dishes.some((d) => p.y > d.y + TABLE.ballRadius - 0.05 && Math.hypot(p.x - d.x, p.z - d.z) < d.r);
    if (on && !onDish.has(id)) add('dish visits');
    if (on) onDish.add(id);
    else onDish.delete(id);
  }
}

/** Whether each toy stands as toys=up wants it: every part of it up, open or over. */
const risers: Record<'popups' | 'mummy', number> = { popups: 0, mummy: 0 };
T.targets.forEach((t, i) => {
  if (t.rise === 'drop') risers.popups |= 1 << i;
  if (t.rise === 'hold') risers.mummy |= 1 << i;
});
function keepToysUp(): void {
  const down = sim.targetsDown();
  const isUp: Record<Toy, boolean> = { popups: !(down & risers.popups), mummy: !(down & risers.mummy), tomb: sim.tombOpen, diverter: sim.diverterOver };
  for (const toy of Object.keys(isUp) as Toy[]) if (!isUp[toy]) game.setToy(toy, true);
}
if (toysUp) keepToysUp();

/**
 * The modelled chat (chat=human): it flips `delay` seconds, give or take `jitter` (evenly), after a ball comes near a
 * flipper, and lets `miss` of the balls that come near go by without a flip. A ball that is gone before the flip, or
 * there before the flipper is back down, is a miss too, as it is for a person. Calibrated against HUMAN_AIM on 300 balls
 * each of seeds 1 to 3 (2026-10-19): 10.8 s a ball, the Ankh's 0.097 a ball and the Eye's 0.198. The Eye's is 40% over,
 * and no flipping brings it down: about 0.12 a ball of it comes from the launch alone, 2 to 4 s after it, before the
 * ball reaches a flipper (unattended play has the same), so a chat that never let a ball by would still be near it.
 */
const HUMAN = { delay: 0.2, jitter: 0.15, miss: 0.5 };
/**
 * The spec's human-like column (seconds a ball, and the Ankh and Eye banks matched a ball), measured on the table at
 * 05f4bdd: 10.8, 0.12 and 0.16. Stage 1 narrowed the plaques since, so the banks are matched less often by anyone,
 * and the two are taken as about 0.10 and 0.14.
 */
const HUMAN_AIM = { seconds: 10.8, ankh: 0.1, eye: 0.14 };
/** A flipper lifted by chat is held for flipHold, and takes this long more to drop before another flip is any use. */
const HUMAN_REST = 0.15;
const sides = ['left', 'right'] as const;
/** For each side: whether this visit near it has had its one reaction, when its flip comes, and its rest after one. */
const chat = {
  reacted: { left: false, right: false },
  flipAt: { left: Infinity, right: Infinity },
  restTill: { left: -Infinity, right: -Infinity },
};
/** One step of the modelled chat, its flips said as the chat of the viewer `platformUserId` (the ball's owner). */
function humanChat(platformUserId: string, name: string): void {
  const t = sim.time;
  const near = { left: false, right: false };
  for (const id of sim.items.keys()) {
    const side = sim.nearFlipper(id);
    if (side) near[side] = true;
  }
  for (const side of sides) {
    if (t >= chat.flipAt[side]) {
      chat.flipAt[side] = Infinity;
      chat.restTill[side] = t + RULES.flipHold + HUMAN_REST;
      chat.reacted[side] = false;
      game.handle({ kind: 'chat', platform: 'youtube', userId: platformUserId, name, text: side });
      continue;
    }
    if (!near[side]) {
      chat.reacted[side] = false;
      continue;
    }
    if (chat.reacted[side] || chat.flipAt[side] < Infinity || t < chat.restTill[side]) continue;
    chat.reacted[side] = true;
    if (Math.random() < HUMAN.miss) continue;
    chat.flipAt[side] = t + HUMAN.delay + HUMAN.jitter * (2 * Math.random() - 1);
  }
}

const multiballOn = () => (game as unknown as { multiball: boolean }).multiball;
const quest = (game as unknown as { quest: { view(): { mode: unknown; finale: unknown } } }).quest;
/** What each god's modes did over the run, and the finales and the jackpots. */
const started: Record<God, number> = { ra: 0, horus: 0, ankh: 0, eye: 0 };
const won: Record<God, number> = { ra: 0, horus: 0, ankh: 0, eye: 0 };
const lost: Record<God, number> = { ra: 0, horus: 0, ankh: 0, eye: 0 };
const goals: Record<God, number> = { ra: 0, horus: 0, ankh: 0, eye: 0 };
let finales = 0;
let finaleEnds = 0;
let jackpots = 0;
let jackpotPoints = 0;
/** For each ball: whether it finished a mode, and whether something big happened while it was up. */
const finished: boolean[] = [];
const big: boolean[] = [];
/** For each ball: whether a mode or the finale ran while it was up, its own or one carried over from a ball before. */
const ran: boolean[] = [];

const points: number[] = [];
const coins: number[] = [];
const seconds: number[] = [];
for (let n = 0; n < balls; n++) {
  const user = economy.touch('youtube', `p${n}`, `Player${n}`).user;
  const before = economy.get(user.id)?.balance ?? 0;
  game.handle({ kind: 'chat', platform: 'youtube', userId: user.platformUserId, name: user.name, text: 'ball' });
  cues = [];
  let multiball = false;
  let running = false;
  let steps = 0;
  const limit = Math.round(600 / DT); // a ball that takes ten minutes is stuck: stop and say so
  do {
    if (human) humanChat(user.platformUserId, user.name);
    game.step();
    if (multiballOn()) multiball = true;
    if (!running) {
      const view = quest.view();
      running = view.mode !== null || view.finale !== null;
    }
    if (toysUp) keepToysUp();
    if (rates) countDish();
    now += DT * 1000;
    if (steps % 15 === 0) game.publish(now);
    steps++;
  } while (steps < limit && (game.state().line.length > 0 || game.state().phase !== 'idle'));
  if (steps >= limit) throw new Error(`ball ${n + 1} did not drain in 600 s`);
  const result = game.state().lastResult;
  points.push(result?.points ?? 0);
  coins.push((economy.get(user.id)?.balance ?? 0) - before);
  seconds.push(steps * DT);
  let wonOne = false;
  let bigOne = multiball;
  for (const c of cues) {
    if (c.cue === 'modeStart') {
      started[c.god]++;
      bigOne = true;
    } else if (c.cue === 'modeWon') {
      won[c.god]++;
      wonOne = bigOne = true;
    } else if (c.cue === 'modeLost') lost[c.god]++;
    else if (c.cue === 'goal') goals[c.god]++;
    else if (c.cue === 'jackpot') {
      jackpots++;
      jackpotPoints += c.value;
      bigOne = true;
    } else if (c.cue === 'finale') {
      finales++;
      bigOne = true;
    } else if (c.cue === 'finaleEnd') finaleEnds++;
  }
  finished.push(wonOne);
  big.push(bigOne);
  ran.push(running);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const row = (label: string, xs: number[]) => console.log(`${label.padEnd(8)} average ${mean(xs).toFixed(1).padStart(9)}  median ${String(Math.round(median(xs))).padStart(8)}  min ${Math.min(...xs)}  max ${Math.max(...xs)}`);
const who = human ? 'balls with the modelled chat flipping' : 'unattended balls';
console.log(`${balls} ${who} (seed ${args.get('seed') ?? 1}${toysUp ? ', every toy kept up' : ''}${settings.length ? `; ${settings.join(' ')}` : ''})`);
row('points', points);
row('coins', coins);
row('seconds', seconds);

const total = (r: Record<God, number>) => GODS.reduce((a, g) => a + r[g], 0);
const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(0)}%` : '-');
console.log('the quest:');
for (const god of GODS) {
  const ends = won[god] + lost[god];
  const counts = `started ${String(started[god]).padStart(4)}  won ${String(won[god]).padStart(4)}  lost ${String(lost[god]).padStart(4)}`;
  console.log(`  ${god.padEnd(6)} ${counts}  goal hits ${String(goals[god]).padStart(4)}  (${pct(won[god], ends)} of those ended were won)`);
}
console.log(`  finales ${finales} (${finaleEnds} ended), jackpots ${jackpots} (${jackpotPoints} points)`);
/** The balls that finished a mode (`pick`) or finished none: how many, and their average coins and points. */
function split(pick: boolean): { n: number; coins: number; points: number } {
  const which = finished.flatMap((f, k) => (f === pick ? [k] : []));
  if (which.length === 0) return { n: 0, coins: 0, points: 0 };
  return { n: which.length, coins: mean(which.map((k) => coins[k])), points: mean(which.map((k) => points[k])) };
}
const plain = split(false);
const winning = split(true);
const times = winning.n && plain.coins ? `, ${(winning.coins / plain.coins).toFixed(1)} times as much (aim: 3 to 4)` : '';
console.log('pay:');
console.log(`  balls that finished no mode  ${pct(plain.n, balls).padStart(4)}  average ${plain.coins.toFixed(1).padStart(6)} coins (${plain.points.toFixed(0)} points)`);
console.log(`  balls that finished a mode   ${pct(winning.n, balls).padStart(4)}  average ${winning.coins.toFixed(1).padStart(6)} coins (${winning.points.toFixed(0)} points)${times}`);
const ended = total(won) + total(lost);
console.log('the aims:');
console.log(`  a mode finished about half the time:  ${pct(total(won), ended)} of the ${ended} modes ended were won`);
console.log(`  something big on most balls:          ${pct(big.filter(Boolean).length, balls)} of balls (a mode started or won, multiball, a jackpot)`);
console.log(`  the finale about once a stream:       ${((150 * finales) / balls).toFixed(2)} finales per 150 balls`);
// Not one of the aims, but what a viewer sees: a mode runs on across balls, so more balls play one than start one.
console.log(`  (a mode or the finale ran on ${pct(ran.filter(Boolean).length, balls)} of balls)`);
if (human) {
  const beside = (label: string, got: number, aim: number) => {
    const off = (100 * (got - aim)) / aim;
    console.log(`  ${label.padEnd(13)} ${got.toFixed(3).padStart(7)}   spec ${aim.toFixed(3).padStart(7)}   ${off >= 0 ? '+' : ''}${off.toFixed(0)}%`);
  };
  console.log(`the modelled chat (flips ${HUMAN.delay} s ± ${HUMAN.jitter} after, lets ${HUMAN.miss} by) beside the spec's human-like column:`);
  beside('seconds', mean(seconds), HUMAN_AIM.seconds);
  beside('ankh matched', (tally.get('bank-ankh') ?? 0) / balls, HUMAN_AIM.ankh);
  beside('eye matched', (tally.get('bank-eye') ?? 0) / balls, HUMAN_AIM.eye);
}
if (rates) {
  const played = seconds.reduce((a, b) => a + b, 0);
  const keys = [...T.banks.map((b) => b.id), 'pop-up hits', 'mummy hits', 'tomb catches', 'lock entries', 'dish visits'];
  console.log(`rates over ${played.toFixed(0)} s of play:`);
  for (const key of keys) {
    const k = tally.get(key) ?? 0;
    console.log(`  ${(key.startsWith('bank-') ? `${key.slice(5)} matched` : key).padEnd(14)} ${String(k).padStart(5)}   ${(k / balls).toFixed(3)} a ball   ${((30 * k) / played).toFixed(2)} per 30 s`);
  }
}
economy.close();
rmSync(dir, { recursive: true, force: true });
