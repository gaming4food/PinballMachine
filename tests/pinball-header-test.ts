// Tests the stage's reading of the pinball's snapshot header (stage/pinball-header.ts) against the header as the
// server writes it (server/sim.ts's snapshot): the time, how many balls, the three flippers' angles, the lit inserts,
// the targets down and turned, both spinners' turns and the toys' bits, each from its own place.
// Usage: npm run pinball-header-test
import assert from 'node:assert/strict';
import { initPhysics } from '@kit/server';
import { PinballSim } from '../src/server/sim';
import { LIT, SNAP_PINBALL_HEADER, TOY } from '../src/shared/pinball';
import { TABLE_IN_USE } from '../src/shared/table';
import { readPinballHeader } from '../src/stage/pinball-header';

await initPhysics();

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** The header as the stage is handed it (the kit's readSnapshot): the snapshot's bytes up to where the bodies start. */
const headerOf = (sim: PinballSim, lit: number) => new DataView(new Uint8Array(sim.snapshot(lit)).buffer, 0, SNAP_PINBALL_HEADER);
/** The rising targets (the pop-ups and the mummy) start down: their bits are set in every fresh sim's header. */
const RISING = TABLE_IN_USE.targets.reduce((bits, t, i) => (t.rise ? bits | (1 << i) : bits), 0);

test(`the header round-trips ${TABLE_IN_USE.targets.length} targets, three flippers and the toy bits`, () => {
  const sim = new PinballSim(TABLE_IN_USE, () => {});
  sim.flip('right', true);
  // The second pop-up and the mummy raised (the mummy is the last target, bit 17), the tomb open and the gate over.
  const index = (id: string) => TABLE_IN_USE.targets.findIndex((t) => t.id === id);
  const popup2 = index('target-popup-2');
  const mummy = index('target-mummy');
  assert.equal(mummy, TABLE_IN_USE.targets.length - 1);
  assert.ok(sim.raiseTarget('target-popup-2') && sim.raiseTarget('target-mummy'));
  sim.openTomb();
  assert.ok(sim.setDiverter(true));
  for (let i = 0; i < 10; i++) sim.step();
  // Target 12 down; 9 and 13 turned; the spinners part way round, each number different.
  const inner = sim as unknown as { targets: { down: boolean; turned: boolean }[]; spinAngle: number };
  inner.targets[12].down = true;
  inner.targets[9].turned = true;
  inner.targets[13].turned = true;
  inner.spinAngle = 1.25;
  const h = readPinballHeader(headerOf(sim, LIT.centre2));
  assert.equal(SNAP_PINBALL_HEADER, 47);
  assert.equal(h.targetsDown & (1 << 12), 1 << 12);
  assert.equal(h.targetsDown, ((1 << 12) | RISING) & ~(1 << popup2) & ~(1 << mummy));
  assert.equal(h.targetsTurned, (1 << 9) | (1 << 13));
  assert.equal(h.toys, TOY.tombOpen | TOY.diverterOver, 'the toy bits');
  assert.equal(h.toys, sim.toys());
  assert.equal(h.flippers.length, 3);
  assert.equal(h.spinners.length, 2);
  assert.equal(h.lit, LIT.centre2);
  assert.deepEqual(h.flippers, sim.flipperAngles().map((a) => Math.fround(a)));
  assert.equal(h.flippers[1], 150, 'the right flipper is up');
  assert.deepEqual(h.spinners, sim.spinnerAngles().map((a) => Math.fround(a)));
  assert.equal(h.spinners[0], 1.25);
});

test('the stage reads the header as the server wrote it: the time, the count, the flippers and the lit inserts', () => {
  const sim = new PinballSim(TABLE_IN_USE, () => {});
  sim.launch(3);
  sim.launch(null);
  sim.flip('left', true);
  for (let i = 0; i < 10; i++) sim.step();
  const lit = LIT.lock | LIT.rollover1 | LIT.saver | LIT.centre0 | LIT.centre3;
  const h = readPinballHeader(headerOf(sim, lit));
  assert.ok(Math.abs(h.time - sim.time) < 1e-9, `the time (${h.time} against ${sim.time})`);
  assert.equal(h.count, 2);
  assert.equal(h.flippers[0], 30);
  assert.equal(h.flippers[1], 210);
  assert.equal(h.lit, lit);
});

test('a table at rest: no balls, flippers down, nothing lit, every target up but the rising ones, which stand down, and no toy bits', () => {
  const sim = new PinballSim(TABLE_IN_USE, () => {});
  const h = readPinballHeader(headerOf(sim, 0));
  assert.deepEqual(h, { time: 0, count: 0, flippers: sim.flipperAngles().map((a) => Math.fround(a)), lit: 0, targetsDown: RISING, targetsTurned: 0, spinners: [0, 0], toys: 0 });
});

test('each toy bit on its own: the tomb open, then the gate over', () => {
  const sim = new PinballSim(TABLE_IN_USE, () => {});
  sim.openTomb();
  assert.equal(readPinballHeader(headerOf(sim, 0)).toys, TOY.tombOpen);
  assert.ok(sim.closeTomb() && sim.setDiverter(true));
  assert.equal(readPinballHeader(headerOf(sim, 0)).toys, TOY.diverterOver);
});

test('every lit bit on', () => {
  const sim = new PinballSim(TABLE_IN_USE, () => {});
  const all = Object.values(LIT).reduce((a, b) => a | b, 0);
  assert.equal(all, (1 << 11) - 1);
  assert.equal(readPinballHeader(headerOf(sim, all)).lit, all);
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
