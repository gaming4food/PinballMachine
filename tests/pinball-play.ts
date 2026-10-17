// Plays unattended balls to see what a ball pays, rather than guessing at RULES.pointsPerCoin: viewers join one at a
// time with `ball`, nobody flips, so only the auto-save plays, and each ball runs until it drains. Prints the average
// and median points, coins and seconds (of table time, not wall time) per ball.
// Usage: npm run pinball-play [-- balls=300 seed=1]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Economy, initPhysics, roomInfo } from '@kit/server';
import { entry } from '../src/entry';
import { PinballGame } from '../src/server/game';
import { DT } from '../src/server/sim';

await initPhysics();

const args = new Map(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const balls = Number(args.get('balls') ?? 300);
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
console.log(`${balls} unattended balls (seed ${args.get('seed') ?? 1})`);
row('points', points);
row('coins', coins);
row('seconds', seconds);
economy.close();
rmSync(dir, { recursive: true, force: true });
