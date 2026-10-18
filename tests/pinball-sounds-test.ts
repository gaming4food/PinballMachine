// Tests when the pinball's sounds play (PinballSoundCues, stage/pinball-sounds.ts), from what the stage can see: a
// flipper starting up, a drop target going down, a ball meeting a bumper or a sling, a launch, a drain, a saved ball,
// and multiball (from a press's moment, or from the state when the lock starts it, once either way). And that the
// picks (PINBALL_SOUNDS) name every moment with no files yet, so each plays its synth. No sound card is needed.
// Usage: npm run pinball-sounds-test
import assert from 'node:assert/strict';
import type { PinballState } from '../src/shared/pinball';
import { TABLE_IN_USE } from '../src/shared/table';
import './stub-assets';

const { PINBALL_SOUNDS } = await import('../src/stage/pinball-sound-picks');
const { PinballSoundCues, PinballVoice } = await import('../src/stage/pinball-sounds');

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** The cues, and every sound they asked for, as `moment` or `moment:detail`. */
function cues() {
  const heard: string[] = [];
  const c = new PinballSoundCues({
    flip: (side) => heard.push(`flip:${side}`),
    bumper: (id) => heard.push(`bumper:${id}`),
    sling: (id) => heard.push(`sling:${id}`),
    target: (index) => heard.push(`target:${index}`),
    drain: () => heard.push('drain'),
    launch: () => heard.push('launch'),
    multiball: () => heard.push('multiball'),
    saved: () => heard.push('saved'),
  });
  return { c, heard };
}

const state = (multiball: boolean): PinballState => ({
  phase: 'playing',
  balls: [],
  line: [],
  multiball,
  doubleUntil: null,
  saverUntil: null,
  lockLit: false,
  lastResult: null,
  waiting: [],
});

test('the picks name every moment, each with no files yet (so each plays its synth)', () => {
  assert.deepEqual(Object.keys(PINBALL_SOUNDS).sort(), ['bumper', 'drain', 'flip', 'launch', 'multiball', 'saved', 'sling', 'target']);
  for (const [moment, pick] of Object.entries(PINBALL_SOUNDS)) {
    assert.deepEqual(pick!.files, [], `${moment} has no files`);
    assert.ok(pick!.volume > 0, `${moment} has a volume`);
  }
});

test('with no synth (a muted preview) every sound is silent and nothing throws', () => {
  const voice = new PinballVoice(null);
  voice.flip();
  voice.bumper();
  voice.sling();
  voice.target();
  voice.drain();
  voice.launch();
  voice.multiball();
  voice.saved();
});

test('a flipper starting up flips once; held up, nothing more; down and up again, again', () => {
  const { c, heard } = cues();
  c.flippers(1, -30, 210);
  c.flippers(1.02, -10, 210);
  c.flippers(1.04, 30, 210);
  c.flippers(1.06, 30, 210);
  assert.deepEqual(heard, ['flip:left']);
  c.flippers(1.1, 0, 210);
  c.flippers(1.14, -30, 210);
  c.flippers(1.16, 0, 180);
  assert.deepEqual(heard, ['flip:left', 'flip:left', 'flip:right'], 'both together');
});

test("the first look at a flipper already up isn't a flip (a page opening mid-flip)", () => {
  const { c, heard } = cues();
  c.flippers(1, 30, 150);
  assert.deepEqual(heard, []);
});

test('a drop target going down sounds once; the bank coming back up is silent', () => {
  const { c, heard } = cues();
  c.targets(0);
  c.targets(0b0100);
  c.targets(0b0100);
  c.targets(0b0101);
  c.targets(0);
  assert.deepEqual(heard, ['target:2', 'target:0']);
});

test('every target on the table sounds when it goes down, past the first eight', () => {
  const { c, heard } = cues();
  c.targets(0);
  c.targets(1 << 7);
  c.targets((1 << 7) | (1 << 13));
  assert.deepEqual(heard, ['target:7', 'target:13']);
});

test('a flip plaque turning to its back sounds as a target; turning back (its bank matched) is silent', () => {
  const { c, heard } = cues();
  c.targets(0, 0);
  c.targets(0, 1 << 10);
  c.targets(0, 1 << 10);
  c.targets(0, (1 << 10) | (1 << 4));
  c.targets(0, 0);
  assert.deepEqual(heard, ['target:10', 'target:4']);
});

test("targets already down when the page opens aren't hits", () => {
  const { c, heard } = cues();
  c.targets(0b0011);
  assert.deepEqual(heard, []);
});

test('a ball meeting a bumper pops it once, and again only after it has left', () => {
  const { c, heard } = cues();
  const b = TABLE_IN_USE.bumpers[0];
  c.balls([{ id: 1, x: b.x, z: b.z - 2 }]);
  c.balls([{ id: 1, x: b.x, z: b.z - b.radius - 0.3 }]);
  c.balls([{ id: 1, x: b.x, z: b.z - b.radius - 0.32 }]);
  assert.deepEqual(heard, [`bumper:${b.id}`]);
  c.balls([{ id: 1, x: b.x, z: b.z - 2 }]);
  c.balls([{ id: 1, x: b.x + b.radius + 0.3, z: b.z }]);
  assert.deepEqual(heard, [`bumper:${b.id}`, `bumper:${b.id}`]);
});

test('a ball seen first touching a bumper (a page opening) is no hit; a sling hit sounds', () => {
  const { c, heard } = cues();
  const b = TABLE_IN_USE.bumpers[1];
  c.balls([{ id: 4, x: b.x, z: b.z - b.radius - 0.3 }]);
  assert.deepEqual(heard, []);
  const s = TABLE_IN_USE.slings[0];
  const mid = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  c.balls([{ id: 5, x: mid[0] + 1.5, z: mid[1] }]);
  c.balls([{ id: 5, x: mid[0] + 0.3, z: mid[1] }]);
  assert.deepEqual(heard, [`sling:${s.id}`]);
});

test('launches, drains and saves each sound', () => {
  const { c, heard } = cues();
  c.launched();
  c.drained();
  c.saved();
  assert.deepEqual(heard, ['launch', 'drain', 'saved']);
});

test("multiball from a press plays at its moment's time, and the state turning it on doesn't play it again", () => {
  const { c, heard } = cues();
  c.state(state(false));
  c.frame(9);
  c.hype({ kind: 'pinballHype', id: 'multiball', at: 10 });
  c.state(state(true));
  c.frame(9.9);
  assert.deepEqual(heard, [], 'not before its time');
  c.frame(10);
  c.frame(10.5);
  assert.deepEqual(heard, ['multiball'], 'once');
});

test('multiball from the lock (the state alone) plays; the other hype buttons have no multiball sound', () => {
  const { c, heard } = cues();
  c.state(state(false));
  c.frame(5);
  c.hype({ kind: 'pinballHype', id: 'double', at: 5 });
  c.frame(5.1);
  c.state(state(true));
  assert.deepEqual(heard, ['multiball']);
});

test("the table's clock starting again (the server restarted) doesn't silence the lock's multiball", () => {
  for (const how of ['frame', 'reset'] as const) {
    const { c, heard } = cues();
    c.state(state(false));
    c.frame(600);
    c.state(state(true));
    assert.deepEqual(heard, ['multiball'], `${how}: on the old clock`);
    c.state(state(false));
    c.hype({ kind: 'pinballHype', id: 'multiball', at: 900 });
    if (how === 'reset') {
      // A fresh hello, then the new clock.
      c.reset();
      c.state(state(false));
    }
    c.frame(1);
    c.frame(2);
    c.state(state(true));
    assert.deepEqual(heard, ['multiball', 'multiball'], `${how}: the lock's multiball on the new clock plays`);
    c.frame(901);
    assert.deepEqual(heard, ['multiball', 'multiball'], `${how}: the old clock's press is let go`);
  }
});

test("hello's state with multiball already on is silent", () => {
  const { c, heard } = cues();
  c.state(state(true));
  assert.deepEqual(heard, []);
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
