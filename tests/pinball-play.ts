// Plays unattended balls to see what a ball pays, rather than guessing at RULES.pointsPerCoin: viewers join one at a
// time with `ball`, nobody flips, so only the auto-save plays, and each ball runs until it drains. Prints the average
// and median points, coins and seconds (of table time, not wall time) per ball.
//
// `toys=up` raises every one of the quest's toys before the first ball (the pop-ups and the mummy up, the tomb open,
// the gate over) and asks again, every step, for whichever has gone down (a pop-up knocked down, the mummy put down by
// its third hit): the game moves a toy only when asked (setToy), so this is what keeps them up. `rates` also prints how
// often things happen: each bank matched, the pop-ups' and the mummy's hits, the tomb's catches, the lock's entries (a
// ball into its sensor, lit or not) and the dish's visits (a ball up on its floor, from the left ramp), each per ball
// and per 30 s of play. Play is the table's time from each `ball` to its drain (the seconds row's), so it counts each
// ball's launch delay too: a rate a mode's 30 s can count on.
// Usage: npm run pinball-play [-- balls=300 seed=1 toys=up rates]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy, initPhysics, roomInfo } from '@kit/server';
import { entry } from '../src/entry';
import { PinballGame, type Toy } from '../src/server/game';
import { DT, type Hit } from '../src/server/sim';
import { TABLE, TABLE_IN_USE } from '../src/shared/table';

await initPhysics();

const args = new Map(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const balls = Number(args.get('balls') ?? 300);
const toysUp = args.get('toys') === 'up';
const rates = args.has('rates');
let seed = Number(args.get('seed') ?? 1);
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
let now = Date.UTC(2026, 9, 17);
Date.now = () => now;

const dir = mkdtempSync(join(tmpdir(), 'coinop-play-'));
const economy = new Economy(dir);
const game = new PinballGame(roomInfo(entry.id, entry.label), economy, { send: () => {} }, join(dir, 'machine-pinball.json'));
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

const points: number[] = [];
const coins: number[] = [];
const seconds: number[] = [];
for (let n = 0; n < balls; n++) {
  const user = economy.touch('youtube', `p${n}`, `Player${n}`).user;
  const before = economy.get(user.id)?.balance ?? 0;
  game.handle({ kind: 'chat', platform: 'youtube', userId: user.platformUserId, name: user.name, text: 'ball' });
  let steps = 0;
  const limit = Math.round(600 / DT); // a ball that takes ten minutes is stuck: stop and say so
  do {
    game.step();
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
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const row = (label: string, xs: number[]) => console.log(`${label.padEnd(8)} average ${mean(xs).toFixed(1).padStart(9)}  median ${String(Math.round(median(xs))).padStart(8)}  min ${Math.min(...xs)}  max ${Math.max(...xs)}`);
console.log(`${balls} unattended balls (seed ${args.get('seed') ?? 1}${toysUp ? ', every toy kept up' : ''})`);
row('points', points);
row('coins', coins);
row('seconds', seconds);
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
