// Tests when the pinball's sounds play (PinballSoundCues, stage/pinball-sounds.ts), from what the stage can see and
// what the server says: a flipper starting up, a drop target going down, a ball meeting a bumper or a sling, a toy's
// hit (the server's cue, played at its time: a pop-up knocked down, the mummy's every hit), a toy rising, the tomb's
// door and the diverter's gate moving, a launch, a drain, a saved ball, and multiball (from a press's moment, or from
// the state when the lock starts it, once either way). And that the picks (PINBALL_SOUNDS) name every moment with no
// files yet, so each plays its synth, and that the toys' three new sounds are made on the synth as they should be. No
// sound card is needed.
// Usage: npm run pinball-sounds-test
import assert from 'node:assert/strict';
import type { StageSynth } from '@kit/stage';
import { type PinballCueMsg, type PinballState, TOY } from '../src/shared/pinball';
import { TABLE, TABLE_IN_USE, type Table } from '../src/shared/table';
import type { PinballPicks } from '../src/stage/pinball-sound-picks';
import './stub-assets';

const { PINBALL_SOUNDS } = await import('../src/stage/pinball-sound-picks');
const { PinballSoundCues, PinballVoice } = await import('../src/stage/pinball-sounds');

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/**
 * The cues (for a table, the pyramid by default), every sound they asked for, as `moment` or `moment:detail`, and each
 * target hit's ball where the cue passed one (null where it passed none).
 */
function cues(table: Table = TABLE_IN_USE) {
  const heard: string[] = [];
  const met: ({ id: number; x: number; z: number } | null)[] = [];
  const c = new PinballSoundCues(
    {
      flip: (side) => heard.push(`flip:${side}`),
      bumper: (id) => heard.push(`bumper:${id}`),
      sling: (id) => heard.push(`sling:${id}`),
      target: (index, ball) => {
        heard.push(`target:${index}`);
        met.push(ball ? { ...ball } : null);
      },
      rise: (index) => heard.push(`rise:${index}`),
      door: (open) => heard.push(`door:${open ? 'open' : 'shut'}`),
      gate: (over) => heard.push(`gate:${over ? 'over' : 'back'}`),
      drain: () => heard.push('drain'),
      launch: () => heard.push('launch'),
      multiball: () => heard.push('multiball'),
      saved: () => heard.push('saved'),
    },
    table,
  );
  return { c, heard, met };
}

/** A toy-hit cue as the server sends it. */
const hit = (part: string, down: boolean, x: number, z: number, at: number): PinballCueMsg => ({ kind: 'pinballCue', cue: 'toyHit', part, down, x, z, at });
/** A target's place in the table's targets, by its id. */
const indexOf = (id: string) => TABLE_IN_USE.targets.findIndex((t) => t.id === id);
/** The rising targets' bits (the pop-ups and the mummy): each stands down until the game raises it. */
const RISING = TABLE_IN_USE.targets.reduce((bits, t, k) => (t.rise ? bits | (1 << k) : bits), 0);

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
  assert.deepEqual(Object.keys(PINBALL_SOUNDS).sort(), ['bumper', 'door', 'drain', 'flip', 'gate', 'launch', 'multiball', 'rise', 'saved', 'sling', 'target']);
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
  voice.rise();
  voice.door();
  voice.gate();
  voice.drain();
  voice.launch();
  voice.multiball();
  voice.saved();
});

/** A note the synth was asked for: its kind, wave or filter, pitch (and where it glides or sweeps to) and time. */
interface Note {
  kind: 'tone' | 'hiss' | 'bell';
  type?: string;
  hz: number;
  glideTo?: number;
  start: number;
  dur?: number;
}

/**
 * A synth that writes down each note and each file it is asked for. It allows every effect unless `allowed` says not,
 * and has decoded the files it is asked to play only if `loaded` says so.
 */
function noteTaker(allowed = true, loaded = false) {
  const notes: Note[] = [];
  const asked: { files: readonly string[]; volume?: number }[] = [];
  const node = {} as AudioNode;
  const synth: StageSynth = {
    now: () => 5,
    out: node,
    space: node,
    tone: (_to, type, hz, start, dur, _vol, glideTo) => notes.push({ kind: 'tone', type, hz, glideTo, start, dur }),
    hiss: (_to, start, dur, _vol, filter, hz, sweepTo) => notes.push({ kind: 'hiss', type: filter, hz, glideTo: sweepTo, start, dur }),
    bell: (_to, hz, start) => notes.push({ kind: 'bell', hz, start }),
    duck() {},
    allow: () => allowed,
    tray() {},
    sample: (files, o) => {
      asked.push({ files, volume: o?.volume });
      return loaded;
    },
  };
  return { synth, notes, asked };
}

test('the rise is a whirr upward with a click, the door a stone slide over a thud, the gate a clack and a bell, each on the synth', () => {
  const play = (moment: 'rise' | 'door' | 'gate', allowed = true) => {
    const { synth, notes } = noteTaker(allowed);
    // With no picks the synth plays, straight into the stage's out.
    new PinballVoice(synth, {})[moment]();
    return notes;
  };
  const rise = play('rise');
  const whirr = rise.find((n) => n.kind === 'tone');
  assert.deepEqual(whirr && [whirr.type, whirr.hz, whirr.glideTo, whirr.dur], ['sawtooth', 220, 440, 0.25], 'a sawtooth whirr from 220 up to 440 Hz in 0.25 s');
  assert.ok(rise.some((n) => n.kind === 'hiss'), 'with a click');
  assert.deepEqual(play('rise', false), [], 'the rise, which comes three at a time, waits for the stage to allow another effect');
  const door = play('door');
  const slide = door.find((n) => n.kind === 'hiss');
  assert.deepEqual(slide && [slide.type, slide.hz, slide.glideTo, slide.dur], ['bandpass', 400, 900, 0.3], 'a bandpass hiss sweeping from 400 to 900 Hz in 0.3 s');
  const thud = door.find((n) => n.kind === 'tone');
  assert.ok(thud && thud.hz < 100, 'over a low thud');
  const gate = play('gate');
  const clack = gate.find((n) => n.kind === 'tone');
  assert.deepEqual(clack && [clack.type, clack.hz, clack.dur], ['square', 300, 0.05], 'a square clack at 300 Hz for 0.05 s');
  assert.ok(gate.some((n) => n.kind === 'bell'), 'and a bell');
});

test('the rise, the door and the gate each play their own picked files in place of the synth', () => {
  for (const moment of ['rise', 'door', 'gate'] as const) {
    const { synth, notes, asked } = noteTaker(true, true);
    const picks: PinballPicks = { [moment]: { files: [`${moment}.ogg`], volume: 0.5 } };
    new PinballVoice(synth, picks)[moment]();
    assert.deepEqual(asked, [{ files: [`${moment}.ogg`], volume: 0.5 }], `${moment} asks for its own files`);
    assert.deepEqual(notes, [], `${moment}: a file that has loaded plays in place of the synth`);
  }
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

test("a toy's hit is its cue's, at the cue's time: the mummy's every hit, with the ball's place for its rock, and a pop-up's; a ball drawn at the mummy with no cue is nothing; a cue more than 2 s late is let go", () => {
  const { c, heard, met } = cues();
  const i = indexOf('target-mummy');
  const m = TABLE_IN_USE.targets[i];
  assert.equal(m.rise, 'hold');
  const popup = indexOf('target-popup-2');
  const p = TABLE_IN_USE.targets[popup];
  // Out of the mummy's face (its front, toward the flippers), `d` from its middle line: touching at a ball's radius and
  // half its depth.
  const a = (m.angle! * Math.PI) / 180;
  let [nx, nz] = [-Math.sin(a), Math.cos(a)];
  if (nx * (-0.4 - m.x) + nz * (2 - m.z) < 0) [nx, nz] = [-nx, -nz];
  const touch = TABLE.ballRadius + (m.depth ?? 0.2) / 2;
  const out = (d: number) => ({ x: m.x + nx * d, z: m.z + nz * d });
  /** The ball a cue's hit plays with: the cue's place, and no ball of the stage's own (id -1). */
  const ball = (x: number, z: number) => ({ id: -1, x, z });
  // The mummy stands. A ball drawn meeting it, in front or behind, is nothing without a cue: the server says each hit.
  c.targets(RISING & ~(1 << i));
  c.frame(20);
  for (const d of [2, touch + 0.02, touch + 0.05, 2, touch + 0.03, -2, -(touch + 0.02)]) c.balls([{ id: 1, ...out(d) }]);
  c.frame(20.5);
  assert.deepEqual(heard, [], 'a ball drawn at the mummy, with no cue, is nothing');
  // Its hits come as cues, from the front and from behind (it stands in a lane; the physics scores a hit on any side),
  // each at its own time. Its third puts it down, and is a hit like the others.
  const front = out(touch + 0.02);
  const behind = out(-(touch + 0.02));
  c.cue(hit(m.id, false, front.x, front.z, 21));
  c.frame(20.9);
  assert.deepEqual(heard, [], "not before the cue's time");
  c.frame(21);
  c.frame(21.4);
  assert.deepEqual(heard, [`target:${i}`], 'at its time, once');
  c.cue(hit(m.id, false, behind.x, behind.z, 22));
  c.frame(22);
  c.cue(hit(m.id, true, front.x, front.z, 23));
  c.frame(23);
  assert.deepEqual(heard, [`target:${i}`, `target:${i}`, `target:${i}`], "the mummy's every hit, its third too");
  // Each hit came with the ball where it met the mummy (the stage rocks the mummy away from it): the cue's place.
  assert.deepEqual(met, [ball(front.x, front.z), ball(behind.x, behind.z), ball(front.x, front.z)], 'where the balls met it');
  // Its third hit put it down: its cue sounded the hit, so going down is silent.
  c.targets(RISING);
  assert.equal(heard.length, 3, 'going down is silent');
  // A pop-up's hit is a cue too, with the ball where it knocked it down.
  c.cue(hit(p.id, true, p.x - 0.1, p.z + 0.2, 24));
  c.frame(24);
  assert.deepEqual(heard.slice(3), [`target:${popup}`], "a pop-up's hit");
  assert.deepEqual(met.slice(3), [ball(p.x - 0.1, p.z + 0.2)], 'with the ball where it knocked it down');
  // Cues play in the order of their times, whatever order they came in.
  c.cue(hit(m.id, false, 1, 2, 26));
  c.cue(hit(p.id, true, 3, 4, 25.5));
  c.frame(26);
  assert.deepEqual(heard.slice(4), [`target:${popup}`, `target:${i}`], 'in the order of their times');
  assert.deepEqual(met.slice(4), [ball(3, 4), ball(1, 2)]);
  // A cue drawn 2 s after its time (a page catching up) still plays; one drawn more than 2 s after it is let go, and
  // isn't played later either.
  c.cue(hit(m.id, false, 5, 6, 30));
  c.frame(32);
  assert.equal(heard.length, 7, 'exactly 2 s late still plays');
  c.cue(hit(m.id, false, 7, 8, 40));
  c.frame(42.1);
  c.frame(43);
  assert.equal(heard.length, 7, 'more than 2 s late is let go');
});

test("a pop-up or the mummy rising sounds a rise once; going down is silent (its cue sounds a hit); the lock's drop targets still sound by their bits", () => {
  const { c, heard } = cues();
  const popup = indexOf('target-popup-2');
  const mummy = indexOf('target-mummy');
  const eye = indexOf('target-eye');
  const p = TABLE_IN_USE.targets[popup];
  c.targets(RISING);
  assert.deepEqual(heard, [], 'the first look is only a look');
  c.targets(RISING & ~(1 << popup));
  c.targets(RISING & ~(1 << popup));
  assert.deepEqual(heard, [`rise:${popup}`], 'rising sounds once; standing up is silent');
  // Down again, with a ball drawn right at it: silent, since its hit is its cue's.
  c.balls([{ id: 1, x: p.x, z: p.z }]);
  c.targets(RISING);
  assert.deepEqual(heard, [`rise:${popup}`], 'going down is silent');
  c.balls([]);
  c.targets(RISING & ~(1 << mummy));
  c.targets(RISING);
  assert.deepEqual(heard, [`rise:${popup}`, `rise:${mummy}`], 'the mummy rises the same way, and going down (its third hit) is silent');
  // All of them together, in the order of the table's targets.
  c.targets(0);
  const risers = TABLE_IN_USE.targets.flatMap((t, k) => (t.rise ? [k] : []));
  assert.deepEqual(heard.slice(2), risers.map((k) => `rise:${k}`), 'every rising target at once');
  // The lock's drop targets sound as they go down, with the rising ones going down at the same look silent.
  c.targets(RISING | (1 << eye));
  assert.deepEqual(heard.slice(2 + risers.length), [`target:${eye}`], "the lock's drop target still sounds by its bit");
  c.targets(RISING);
  assert.equal(heard.length, 2 + risers.length + 1, 'coming back up is silent');
  // A page opening with the toys already up: only a look.
  const fresh = cues();
  fresh.c.targets(0);
  assert.deepEqual(fresh.heard, []);
});

test("the tomb's door and the gate sound when they move, either way; the first look is silent; the tomb's catch makes no sound", () => {
  const { c, heard } = cues();
  c.toys(TOY.tombOpen);
  assert.deepEqual(heard, [], 'a page opening on an open tomb is only a look');
  c.toys(TOY.tombOpen);
  c.toys(0);
  c.toys(0);
  assert.deepEqual(heard, ['door:shut'], 'the door shutting sounds once');
  c.toys(TOY.tombOpen);
  assert.deepEqual(heard, ['door:shut', 'door:open'], 'and opening');
  c.toys(TOY.tombOpen | TOY.diverterOver);
  c.toys(TOY.tombOpen | TOY.diverterOver);
  c.toys(TOY.tombOpen);
  assert.deepEqual(heard.slice(2), ['gate:over', 'gate:back'], 'the gate swinging over and back, with the door standing open, sounds the gate alone');
  c.toys(TOY.diverterOver);
  assert.deepEqual(heard.slice(4), ['door:shut', 'gate:over'], 'both at once, each sounds');
  // A fresh hello forgets what was looked at: the next look is only a look again.
  const before = heard.length;
  c.reset();
  c.toys(0);
  assert.equal(heard.length, before, 'the first look after a hello is silent');
  c.toys(TOY.tombOpen);
  assert.deepEqual(heard.slice(before), ['door:open']);
  // The tomb's catch has no sound of its own, so its cue, at its time, is nothing.
  const tomb = TABLE_IN_USE.tomb!;
  const quiet = heard.length;
  c.frame(50);
  c.cue(hit(tomb.id, false, tomb.held[0], tomb.held[1], 51));
  c.frame(51);
  c.frame(52);
  assert.equal(heard.length, quiet, "the tomb's catch makes no sound");
});

test("a cue for a part the table hasn't got, or for a target that isn't a pop-up or the mummy, sounds nothing", () => {
  const { c, heard } = cues();
  c.frame(10);
  // The lock's drop targets and the plaques sound by their bits, so a cue for one would sound it twice.
  for (const part of ['target-sphinx', '', 'constructor', 'toString', 'diverter', 'target-eye', 'target-scarab', 'target-ra-1']) {
    c.cue(hit(part, true, 1, 2, 10));
  }
  c.frame(10.5);
  c.frame(13);
  assert.deepEqual(heard, []);
  // The table asked is the one the cues are read against: with no scarab (every later target's place moves up one) and
  // no mummy, the mummy's cue is nothing and a pop-up's is by its place in that table.
  const bare: Table = { ...TABLE_IN_USE, targets: TABLE_IN_USE.targets.filter((t) => t.id !== 'target-scarab' && t.id !== 'target-mummy') };
  const other = cues(bare);
  other.c.frame(10);
  other.c.cue(hit('target-mummy', false, 1, 2, 10));
  other.c.cue(hit('target-popup-1', true, 3, 4, 10));
  other.c.frame(10.5);
  assert.deepEqual(other.heard, [`target:${bare.targets.findIndex((t) => t.id === 'target-popup-1')}`]);
  assert.notEqual(bare.targets.findIndex((t) => t.id === 'target-popup-1'), indexOf('target-popup-1'), 'a place that moved');
});

test("the table's clock starting again lets go of the toys' cues waiting on the old clock, and keeps those already on the new clock", () => {
  const popup1 = indexOf('target-popup-1');
  const popup2 = indexOf('target-popup-2');
  for (const how of ['frame', 'reset'] as const) {
    const { c, heard } = cues();
    c.frame(600);
    c.cue(hit('target-popup-1', true, 1, 1, 601));
    if (how === 'reset') c.reset();
    // The restarted server's cue, sent before the page's first frame on its clock.
    c.cue(hit('target-popup-2', true, 2, 2, 0.5));
    c.frame(0.25);
    c.frame(0.6);
    assert.deepEqual(heard, [`target:${popup2}`], `${how}: the cue already on the new clock plays at its time`);
    c.frame(601);
    c.frame(603);
    assert.deepEqual(heard, [`target:${popup2}`], `${how}: the old clock's cue is let go`);
  }
  // The edge: a cue exactly a second ahead of the new time is on the new clock; one further ahead is the old clock's.
  const edge = cues();
  edge.c.frame(600);
  edge.c.cue(hit('target-popup-1', true, 1, 1, 1.25));
  edge.c.cue(hit('target-popup-2', true, 2, 2, 1.5));
  edge.c.frame(0.25);
  edge.c.frame(2);
  edge.c.frame(3);
  assert.deepEqual(edge.heard, [`target:${popup1}`], 'a second ahead stays; further ahead goes');
  // A small step back (the drawn time slips back a little after a pause) is no restart: the cue waiting stays.
  const slip = cues();
  slip.c.frame(100);
  slip.c.cue(hit('target-popup-1', true, 1, 1, 101));
  slip.c.frame(99.5);
  slip.c.frame(101);
  assert.deepEqual(slip.heard, [`target:${popup1}`]);
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
