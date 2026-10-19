// Tests when the pinball's sounds play (PinballSoundCues, stage/pinball-sounds.ts), from what the stage can see: a
// flipper starting up, a drop target going down, a ball meeting a bumper, a sling or the standing mummy, a launch, a
// drain, a saved ball, and multiball (from a press's moment, or from the state when the lock starts it, once either
// way). And that the picks (PINBALL_SOUNDS) name every moment with no files yet, so each plays its synth. No sound card
// is needed.
// Usage: npm run pinball-sounds-test
import assert from 'node:assert/strict';
import type { PinballState } from '../src/shared/pinball';
import { TABLE, TABLE_IN_USE } from '../src/shared/table';
import './stub-assets';

const { PINBALL_SOUNDS } = await import('../src/stage/pinball-sound-picks');
const { PinballSoundCues, PinballVoice } = await import('../src/stage/pinball-sounds');

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/**
 * The cues, every sound they asked for, as `moment` or `moment:detail`, and each target hit's ball where the cue
 * passed one (null where it passed none).
 */
function cues() {
  const heard: string[] = [];
  const met: ({ id: number; x: number; z: number } | null)[] = [];
  const c = new PinballSoundCues({
    flip: (side) => heard.push(`flip:${side}`),
    bumper: (id) => heard.push(`bumper:${id}`),
    sling: (id) => heard.push(`sling:${id}`),
    target: (index, ball) => {
      heard.push(`target:${index}`);
      met.push(ball ? { ...ball } : null);
    },
    drain: () => heard.push('drain'),
    launch: () => heard.push('launch'),
    multiball: () => heard.push('multiball'),
    saved: () => heard.push('saved'),
  });
  return { c, heard, met };
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

test("a ball meeting the mummy's face is a hit, and the cue passes the ball, in front or behind, for its rock", () => {
  const { c, heard, met } = cues();
  const i = TABLE_IN_USE.targets.findIndex((t) => t.rise === 'hold');
  const m = TABLE_IN_USE.targets[i];
  assert.equal(m.id, 'target-mummy');
  /** The rising targets' bits: each stands down until the game raises it. */
  const rising = TABLE_IN_USE.targets.reduce((bits, t, k) => (t.rise ? bits | (1 << k) : bits), 0);
  const up = rising & ~(1 << i);
  // Out of its face (its front, toward the flippers), `d` from its middle line: touching at a ball's radius and half
  // its depth.
  const a = (m.angle! * Math.PI) / 180;
  let [nx, nz] = [-Math.sin(a), Math.cos(a)];
  if (nx * (-0.4 - m.x) + nz * (2 - m.z) < 0) [nx, nz] = [-nx, -nz];
  const touch = TABLE.ballRadius + (m.depth ?? 0.2) / 2;
  const out = (d: number) => [{ id: 1, x: m.x + nx * d, z: m.z + nz * d }];
  c.targets(rising);
  c.balls(out(2));
  c.balls(out(touch + 0.02));
  assert.deepEqual(heard, [], 'down, there is no face to meet: a ball over its slot is nothing');
  c.balls(out(2));
  c.targets(up);
  assert.deepEqual(heard, [], 'rising is silent');
  c.balls(out(touch + 0.02));
  c.balls(out(touch + 0.05));
  assert.deepEqual(heard, [`target:${i}`], 'met once, while it stays');
  c.balls(out(2));
  c.balls(out(touch + 0.03));
  assert.deepEqual(heard, [`target:${i}`, `target:${i}`], 'met again after leaving');
  // From behind it too (it stands in a lane; the physics scores a hit on any side).
  c.balls(out(-2));
  c.balls(out(-(touch + 0.02)));
  assert.deepEqual(heard, [`target:${i}`, `target:${i}`, `target:${i}`], 'met from behind');
  // Each hit came with the ball where it met the mummy (the stage rocks the mummy away from it): twice in front, then
  // behind.
  assert.deepEqual(met, [out(touch + 0.02)[0], out(touch + 0.03)[0], out(-(touch + 0.02))[0]], 'the balls that met it, where they met it');
  const side = (b: { x: number; z: number } | null) => Math.sign((b!.x - m.x) * nx + (b!.z - m.z) * nz);
  assert.deepEqual(met.map(side), [1, 1, -1], 'in front, in front, behind');
  // Its third hit puts it down: the hit was heard as the ball met it, so going down is silent.
  c.targets(rising);
  assert.deepEqual(heard, [`target:${i}`, `target:${i}`, `target:${i}`], 'going down is silent');
  // A page opening with a ball against it: only a look.
  const fresh = cues();
  fresh.c.targets(up);
  fresh.c.balls(out(touch + 0.02));
  assert.deepEqual(fresh.heard, []);
});

test('a pop-up knocked down by a ball is a hit; put away by the game, with no ball at it, it goes down silently', () => {
  const { c, heard } = cues();
  const i = TABLE_IN_USE.targets.findIndex((t) => t.id === 'target-popup-2');
  const p = TABLE_IN_USE.targets[i];
  const rising = TABLE_IN_USE.targets.reduce((bits, t, k) => (t.rise ? bits | (1 << k) : bits), 0);
  const a = (p.angle! * Math.PI) / 180;
  let [nx, nz] = [-Math.sin(a), Math.cos(a)];
  if (nx * (-0.4 - p.x) + nz * (2 - p.z) < 0) [nx, nz] = [-nx, -nz];
  const touch = TABLE.ballRadius + (p.depth ?? 0.2) / 2;
  const out = (d: number) => [{ id: 1, x: p.x + nx * d, z: p.z + nz * d }];
  c.targets(rising);
  c.balls(out(3));
  c.targets(rising & ~(1 << i));
  assert.deepEqual(heard, [], 'raised: silent');
  // A ball coming at it (as last drawn, a frame short of it) and the pop-up knocked down.
  c.balls(out(touch + 0.4));
  c.targets(rising);
  assert.deepEqual(heard, [`target:${i}`], 'knocked down: a hit');
  // Raised again, and put away with the ball across the table: no hit.
  c.balls(out(3));
  c.targets(rising & ~(1 << i));
  c.balls(out(3));
  c.targets(rising);
  assert.deepEqual(heard, [`target:${i}`], 'put away: silent');
  // The lock's drop targets go down only when hit, so theirs sound with no ball looked at.
  const eye = TABLE_IN_USE.targets.findIndex((t) => t.id === 'target-eye');
  c.targets(rising | (1 << eye));
  assert.deepEqual(heard, [`target:${i}`, `target:${eye}`]);
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
