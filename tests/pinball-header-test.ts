// Tests the stage's reading of the pinball's snapshot header (stage/pinball-header.ts) against the header as the
// server writes it (server/sim.ts's snapshot): the time, how many balls, both flippers' angles, the lit inserts, the
// drop targets down and the spinner's turn, each from its own place. Usage: npm run pinball-header-test
import assert from 'node:assert/strict';
import { initPhysics } from '@kit/server';
import { PinballSim } from '../src/server/sim';
import { LIT, SNAP_PINBALL_HEADER } from '../src/shared/pinball';
import { STAND_IN } from '../src/shared/table';
import { readPinballHeader } from '../src/stage/pinball-header';

await initPhysics();

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** The header as the stage is handed it (the kit's readSnapshot): the snapshot's bytes up to where the bodies start. */
const headerOf = (sim: PinballSim, lit: number) => new DataView(new Uint8Array(sim.snapshot(lit)).buffer, 0, SNAP_PINBALL_HEADER);

test('the stage reads the header as the server wrote it: the time, the count, both flippers, the lit inserts, the targets and the spinner', () => {
  const sim = new PinballSim(STAND_IN, () => {});
  sim.launch(3);
  sim.launch(null);
  sim.flip('left', true);
  for (let i = 0; i < 10; i++) sim.step();
  // Two targets down and the spinner part way round: each number different, so one read from another's place shows.
  const inner = sim as unknown as { targets: { down: boolean }[]; spinAngle: number };
  inner.targets[1].down = true;
  inner.targets[3].down = true;
  inner.spinAngle = 1.25;
  const lit = LIT.lock | LIT.rollover1 | LIT.saver;
  const h = readPinballHeader(headerOf(sim, lit));
  assert.ok(Math.abs(h.simTime - sim.time) < 1e-9, `the time (${h.simTime} against ${sim.time})`);
  assert.deepEqual({ ...h, simTime: 0 }, { simTime: 0, count: 2, left: 30, right: 210, lit, targets: 0b1010, spinner: 1.25 });
});

test('a table at rest: no balls, both flippers down, nothing lit, every target up', () => {
  const sim = new PinballSim(STAND_IN, () => {});
  const h = readPinballHeader(headerOf(sim, 0));
  assert.deepEqual(h, { simTime: 0, count: 0, left: -30, right: 210, lit: 0, targets: 0, spinner: 0 });
});

test('the right flipper up and every lit bit on', () => {
  const sim = new PinballSim(STAND_IN, () => {});
  sim.flip('right', true);
  for (let i = 0; i < 10; i++) sim.step();
  const all = Object.values(LIT).reduce((a, b) => a | b, 0);
  const h = readPinballHeader(headerOf(sim, all));
  assert.equal(h.right, 150);
  assert.equal(h.left, -30);
  assert.equal(h.lit, all);
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
