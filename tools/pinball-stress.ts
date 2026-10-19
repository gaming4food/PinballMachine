// A stress run of the table in use (TABLE_IN_USE) in the real physics: 250 launches played for 25 s each with random
// flips, then up to 3000 shots off the flippers, looking for any ball that gets down on the floor outside the outer wall
// (behind the arch: a ball there is lost). For each one found (up to 4) it prints the last second of the ball's path
// (x, y, z and its velocity, every third step), to see how it got out. The Blender spike's trace-out10.mts, seeded the
// same (11). It takes minutes, so it isn't part of npm test; expected: "found 0 in 3250 runs".
// `toys=up` makes the same run with every one of the quest's toys up: the pop-ups and the mummy raised, the tomb open
// and the gate over before each run, and a pop-up the ball knocks down raised again as soon as it can be (the physics
// waits for the ball to be clear of it), every step.
// `lock=held` makes the same run with a ball held in the lock throughout, as multiball holds one (held before each run,
// and still held after it, or the run stops): so every ball that reaches the lock is kicked back out (sim.ts's
// LOCK_KICK). The two can be given together.
// Usage: npm run pinball-stress [-- toys=up] [lock=held] (or npx tsx tools/pinball-stress.ts)
import { initPhysics } from '@kit/server';
import { DT, PinballSim } from '../src/server/sim';
import { TABLE_IN_USE as L } from '../src/shared/table';

await initPhysics();

let seed = 11;
Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const toysUp = process.argv.slice(2).includes('toys=up');
const lockHeld = process.argv.slice(2).includes('lock=held');
const sim = new PinballSim(L, () => {});
const rising = L.targets.filter((t) => t.rise).map((t) => t.id);
/** With toys=up: whichever rising target is down raised (where no ball stands), the tomb open and the gate over. */
function keepToysUp(): void {
  if (!toysUp) return;
  for (const id of rising) sim.raiseTarget(id);
  sim.openTomb();
  sim.setDiverter(true);
}
/** With lock=held, the ball the lock holds this run. */
let held = -1;
/**
 * A run's start: the table cleared and its targets reset, with lock=held a ball held in the lock as multiball holds
 * one, and with toys=up every toy up again.
 */
function fresh(): void {
  sim.clear();
  sim.resetTargets();
  if (lockHeld) {
    held = (sim as any).addBall(null, L.lock.x, L.lock.z, 0, 0);
    sim.holdInLock(held);
  }
  keepToysUp();
}
/** With lock=held, the lock still holds its ball as a run ends: otherwise the run wasn't the one it says. */
function stillHeld(): void {
  if (lockHeld && sim.heldBy(held) !== 'lock') throw new Error(`run ${runs}: the lock no longer holds its ball`);
}
if (toysUp) console.log('every toy up: the pop-ups and the mummy raised, the tomb open, the gate over');
if (lockHeld) console.log('a ball held in the lock throughout');
/** The outer wall's outline, closed along the bottom below the drain. */
const OUT = [...L.walls[0].points, [5, -2], [-5, -2]] as [number, number][];
function inside(x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = OUT.length - 1; i < OUT.length; j = i++) {
    const [ax, az] = OUT[i], [bx, bz] = OUT[j];
    if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) c = !c;
  }
  return c;
}

let found = 0, runs = 0;
/** Plays ball `id` for `seconds`, each flipper flipped now and then when the ball is near it. */
function play(id: number, seconds: number): void {
  const hold: Record<'left' | 'right', number> = { left: 0, right: 0 };
  const hist: number[][] = [];
  for (let k = 0; k < seconds / DT; k++) {
    const side = sim.nearFlipper(id);
    if (side && hold[side] <= 0 && Math.random() < 0.08) {
      sim.flip(side, true);
      hold[side] = 0.12 + Math.random() * 0.25;
    }
    for (const s of ['left', 'right'] as const) if (hold[s] > 0 && (hold[s] -= DT) <= 0) sim.flip(s, false);
    sim.step();
    keepToysUp();
    const b = sim.items.get(id);
    if (!b) return;
    const p = b.body.translation(), v = b.body.linvel();
    hist.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)]);
    if (hist.length > 40) hist.shift();
    if (!inside(p.x, p.z) && p.y < 0.6 && found < 4) {
      found++;
      console.log('OUT at run', runs, JSON.stringify(hist.filter((_, i) => i % 3 === 0)));
      return;
    }
  }
}

for (let n = 0; n < 250; n++) {
  runs++;
  fresh();
  play(sim.launch(null), 25);
  stillHeld();
}
for (let n = 0; n < 3000 && found < 4; n++) {
  runs++;
  fresh();
  const f = L.flippers[n % L.flippers.length];
  const x = f.pivot[0] + (Math.random() - 0.5) * 2.4, z = f.pivot[1] + 0.3 + Math.random() * 0.8;
  const a = Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 15 + Math.random() * 45;
  play((sim as any).addBall(null, x, z, Math.cos(a) * v, Math.sin(a) * v), 6);
  stillHeld();
}
console.log('found', found, 'in', runs, 'runs');
process.exit(found ? 1 : 0);
