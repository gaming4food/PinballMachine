// Tests the quest's rules (Quest, server/quest.ts) on their own, with no physics: that a bank match starts its god's
// mode, or the next god's if its own is done, and only one mode runs at a time; that a mode's clock runs only while a
// ball is in play and the mode is lost at 0; that each mode is won by its own goal, with goal points each time and the
// prize at the end; that a hit handled before the clock wins in the step the time runs out, and nothing pays once a
// mode is over; that the fourth god crossed off begins the finale, whose jackpots climb and whose pop-ups and mummy
// come back up, each on its own, until multiball ends it; that a save comes back as it was (a finale waiting for a
// ball) and one that isn't valid starts the quest afresh; and that the Reset clears it all. Every number comes from
// QUEST (and tombPrize), so tuning them changes one place. No physics, page or sound card is needed.
// Usage: npm run quest-test
import assert from 'node:assert/strict';
import { Quest, type QuestCue, type QuestEvent, type QuestOut, type QuestView } from '../src/server/quest';
// Only the type: the game loads the physics, which the quest has no use for.
import type { Toy } from '../src/server/game';
import { GODS, GOD_COLOR, isGod, MODE_NAME, QUEST, tombPrize, type God } from '../src/shared/pinball';
import { TABLE_IN_USE } from '../src/shared/table';

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** Each god's toy, as the design has it: Ra the diverter, Horus the pop-ups, Ankh the mummy, the Eye the tomb. */
const TOY_OF: Record<God, Toy> = { ra: 'diverter', horus: 'popups', ankh: 'mummy', eye: 'tomb' };
const NO_TOYS: Record<Toy, boolean> = { popups: false, mummy: false, tomb: false, diverter: false };
/** The toys asked for when only these are. */
function wanting(...up: Toy[]): Record<Toy, boolean> {
  const wanted = { ...NO_TOYS };
  for (const t of up) wanted[t] = true;
  return wanted;
}
/** What putting every toy away comes to, as `said` lists toys. */
const ALL_DOWN = ['diverter down', 'mummy down', 'popups down', 'tomb down'];
/** The finale's toys, as `said` lists them. */
const FINALE_UP = ['mummy up', 'popups up', 'tomb up'];

/** The ids the game names to the quest: the table's pop-ups, and its mummy (the one target that holds). */
const POPUPS = TABLE_IN_USE.targets.filter((t) => t.rise === 'drop').map((t) => t.id);
const MUMMY_IDS = TABLE_IN_USE.targets.filter((t) => t.rise === 'hold').map((t) => t.id);

/** What each god's goal is, by the kinds of event the game feeds the quest (the design's table of modes). */
const GOAL_KINDS: Record<God, QuestEvent['kind'][]> = {
  ra: ['orbit', 'ramp'],
  horus: ['popupDown'],
  ankh: ['mummyHit'],
  eye: ['tomb'],
};
/** One event of every kind but a bank match. */
const SHOTS: QuestEvent[] = [
  { kind: 'orbit' },
  { kind: 'ramp' },
  { kind: 'popupDown', part: POPUPS[0] },
  { kind: 'mummyHit', down: false },
  { kind: 'mummyHit', down: true },
  { kind: 'tomb' },
  { kind: 'multiballEnded' },
];

/** The events that finish a god's mode, one goal hit each (Ankh's last puts the mummy down, as the game's does). */
function goalsOf(god: God): QuestEvent[] {
  const n = QUEST.goals[god];
  return Array.from({ length: n }, (_, i): QuestEvent => {
    switch (god) {
      case 'ra':
        return i % 2 === 0 ? { kind: 'orbit' } : { kind: 'ramp' };
      case 'horus':
        return { kind: 'popupDown', part: POPUPS[i] };
      case 'ankh':
        return { kind: 'mummyHit', down: i === n - 1 };
      case 'eye':
        return { kind: 'tomb' };
    }
  });
}

/** What a list of outs came to, by kind: points and cues in the order given, toys as 'popups up' (sorted). */
interface Said {
  points: number[];
  toys: string[];
  raise: string[];
  multiball: number;
  cues: QuestCue[];
}
function said(outs: QuestOut[]): Said {
  const s: Said = { points: [], toys: [], raise: [], multiball: 0, cues: [] };
  for (const o of outs) {
    if (o.kind === 'points') s.points.push(o.points);
    else if (o.kind === 'toy') s.toys.push(`${o.toy} ${o.up ? 'up' : 'down'}`);
    else if (o.kind === 'raise') s.raise.push(o.part);
    else if (o.kind === 'multiball') s.multiball++;
    else s.cues.push(o.cue);
  }
  s.toys.sort();
  return s;
}
/** What `said` gives for the outs expected: nothing but what is named. */
const exp = (o: Partial<Said>): Said => ({ points: [], toys: [], raise: [], multiball: 0, cues: [], ...o });

/** The quest as a fresh one shows it. */
const freshView = (): QuestView => ({ done: [], mode: null, finale: null });
const freshSave = () => ({ done: [], mode: null, finale: false });

/** A match of the god's bank starts its mode (it must be the god's), and its goal hits finish it: their outs. */
function cross(q: Quest, god: God): QuestOut[] {
  assert.deepEqual(said(q.event({ kind: 'bank', god })).cues, [{ cue: 'modeStart', god }], `${god}'s mode starts`);
  return goalsOf(god).flatMap((e) => q.event(e));
}
/** A quest with the gods crossed off, in this order. */
function crossed(...gods: God[]): Quest {
  const q = new Quest();
  for (const god of gods) cross(q, god);
  return q;
}

/**
 * The game's side of the toys: what it has been asked for, from the quest's toy outs in order. After every call it
 * must be what the quest says it wants (toysWanted), since that is what the game asks for again after a restart.
 */
function watch(q: Quest) {
  const asked = { ...NO_TOYS };
  return (outs: QuestOut[], what: string): QuestOut[] => {
    for (const o of outs) if (o.kind === 'toy') asked[o.toy] = o.up;
    assert.deepEqual(asked, q.toysWanted(), `${what}: the toys asked for are the toys wanted`);
    return outs;
  };
}

test('the gods are Ra, Horus, Ankh and the Eye in that order, each with a colour and a mode name, and isGod knows them', () => {
  assert.deepEqual([...GODS], ['ra', 'horus', 'ankh', 'eye']);
  assert.deepEqual(Object.keys(GOD_COLOR).sort(), [...GODS].sort());
  assert.deepEqual(MODE_NAME, { ra: 'SUN CHASE', horus: 'FALCON STRIKE', ankh: 'THE MUMMY WAKES', eye: 'TOMB RAID' });
  // isGod is for what comes in from outside (a save file, the dev host's action): a god by value, and nothing else.
  for (const god of GODS) assert.equal(isGod(god), true, god);
  for (const x of ['zeus', '', 'RA', ' ra', 'constructor', 'toString', ['ra'], null, undefined, 0, 1, {}]) {
    assert.equal(isGod(x), false, `${JSON.stringify(x) ?? 'undefined'} is no god`);
  }
});

test("the quest's numbers fit the rules and the table: whole goals, Horus's no more than the pop-ups there are, the mummy one part", () => {
  for (const god of GODS) assert.ok(Number.isInteger(QUEST.goals[god]) && QUEST.goals[god] >= 1, `${god}'s goal is a whole number of hits`);
  assert.ok(POPUPS.length >= QUEST.goals.horus, `Horus's goal (${QUEST.goals.horus}) is more than the table's ${POPUPS.length} pop-ups`);
  assert.equal(MUMMY_IDS.length, 1, 'the table has the one holding target, the mummy, which the quest raises by its id');
  assert.ok(QUEST.modeSeconds > 0 && QUEST.finaleRaise > 0, 'the times run forward');
});

test("Tomb Raid's prize counts down evenly from QUEST.tombPrize.from with all the time left to .to with none, to the nearest 1,000", () => {
  const { from, to } = QUEST.tombPrize;
  const nearest = (n: number) => Math.round(n / 1000) * 1000;
  assert.equal(tombPrize(QUEST.modeSeconds), nearest(from));
  assert.equal(tombPrize(0), nearest(to));
  assert.equal(tombPrize(QUEST.modeSeconds / 2), nearest((from + to) / 2));
  let before = Infinity;
  for (let i = 0; i <= 200; i++) {
    const left = (QUEST.modeSeconds * (200 - i)) / 200;
    const prize = tombPrize(left);
    assert.equal(prize, nearest(to + (from - to) * (left / QUEST.modeSeconds)), `with ${left} s left`);
    assert.equal(prize % 1000, 0);
    assert.ok(prize <= before, 'it only falls as the time runs out');
    before = prize;
  }
  // Out of the mode's time either way, it holds at its ends.
  assert.equal(tombPrize(QUEST.modeSeconds * 2), nearest(from));
  assert.equal(tombPrize(-QUEST.modeSeconds), nearest(to));
});

test("a bank match starts its god's mode, its toy up and a modeStart cue; a done god's match starts the next god not done, wrapping", () => {
  for (const god of GODS) {
    const q = new Quest();
    const outs = said(q.event({ kind: 'bank', god }));
    assert.deepEqual(outs, exp({ toys: [`${TOY_OF[god]} up`], cues: [{ cue: 'modeStart', god }] }), `${god}: toy and cue`);
    assert.deepEqual(q.view(), { done: [], mode: { god, left: QUEST.modeSeconds, progress: 0, goal: QUEST.goals[god] }, finale: null }, `${god}'s mode runs`);
    assert.deepEqual(q.toysWanted(), wanting(TOY_OF[god]), `${god}: only its toy is wanted`);
  }
  // A done god's match starts the next god after it that isn't done, the Eye's wrapping round to Ra.
  const cases: [done: God[], match: God, starts: God][] = [
    [['ra'], 'ra', 'horus'],
    [['horus'], 'horus', 'ankh'],
    [['ankh'], 'ankh', 'eye'],
    [['eye'], 'eye', 'ra'],
    [['ra', 'horus'], 'ra', 'ankh'],
    [['eye', 'ra'], 'eye', 'horus'],
    [['ankh', 'eye', 'ra'], 'eye', 'horus'],
    [['ra', 'horus', 'ankh'], 'ra', 'eye'],
    [['ra', 'horus', 'ankh'], 'horus', 'eye'],
    [['horus', 'ankh', 'eye'], 'eye', 'ra'],
  ];
  for (const [done, match, starts] of cases) {
    const q = crossed(...done);
    const what = `${done.join('+')} done, ${match} matched`;
    assert.deepEqual(q.view().done, GODS.filter((g) => done.includes(g)), `${what}: those are done`);
    const outs = said(q.event({ kind: 'bank', god: match }));
    assert.deepEqual(outs, exp({ toys: [`${TOY_OF[starts]} up`], cues: [{ cue: 'modeStart', god: starts }] }), what);
    assert.equal(q.view().mode?.god, starts, what);
    assert.deepEqual(q.view().done, GODS.filter((g) => done.includes(g)), `${what}: they stay done`);
  }
  // A bank that is no god's (a table with another bank) starts nothing.
  assert.deepEqual(new Quest().event({ kind: 'bank', god: 'zeus' as God }), []);
});

test('one mode at a time: a match during a mode or the finale starts nothing', () => {
  const q = new Quest();
  q.event({ kind: 'bank', god: 'horus' });
  q.tick(1, true);
  const running = q.view();
  for (const god of GODS) assert.deepEqual(q.event({ kind: 'bank', god }), [], `a ${god} match during a mode`);
  assert.deepEqual(q.view(), running, 'the mode runs on as it was');
  assert.deepEqual(q.toysWanted(), wanting('popups'));
  const f = crossed(...GODS);
  const finale = f.view();
  assert.deepEqual(finale, { done: [...GODS], mode: null, finale: { jackpot: QUEST.jackpot.first } });
  for (const god of GODS) assert.deepEqual(f.event({ kind: 'bank', god }), [], `a ${god} match during the finale`);
  assert.deepEqual(f.view(), finale, 'the finale runs on as it was');
});

test('the clock runs only while a ball is in play, and the mode is lost at 0: its toy down, a modeLost cue, the god not crossed off', () => {
  const half = QUEST.modeSeconds / 2;
  for (const god of GODS) {
    const q = new Quest();
    q.event({ kind: 'bank', god });
    // One goal hit short of the goal, where the goal takes more than one: progress to lose.
    const goals = goalsOf(god);
    for (const e of goals.slice(0, -1)) q.event(e);
    // With no ball in play (the next ball waiting, or launching) the time stands still.
    for (let i = 0; i < 5; i++) assert.deepEqual(q.tick(QUEST.modeSeconds, false), [], `${god}: no ball, no time`);
    assert.equal(q.view().mode?.left, QUEST.modeSeconds, `${god}: the time stood still`);
    // In play it runs, and stands still again between balls.
    assert.deepEqual(q.tick(half, true), []);
    assert.equal(q.view().mode?.left, half);
    assert.deepEqual(q.tick(QUEST.modeSeconds * 10, false), []);
    assert.equal(q.view().mode?.left, half, `${god}: it stood still again`);
    // The time runs out: the mode is lost.
    const lost = said(q.tick(half, true));
    assert.deepEqual(lost, exp({ toys: [`${TOY_OF[god]} down`], cues: [{ cue: 'modeLost', god }] }), `${god}: lost at 0`);
    assert.deepEqual(q.view(), freshView(), `${god}: the god is not crossed off, and no mode runs`);
    assert.deepEqual(q.toysWanted(), NO_TOYS);
    assert.deepEqual(q.tick(QUEST.modeSeconds, true), [], `${god}: lost once`);
    // The god is left to try again on a later match, from the start.
    const again = said(q.event({ kind: 'bank', god }));
    assert.deepEqual(again, exp({ toys: [`${TOY_OF[god]} up`], cues: [{ cue: 'modeStart', god }] }));
    assert.deepEqual(q.view().mode, { god, left: QUEST.modeSeconds, progress: 0, goal: QUEST.goals[god] }, `${god}: afresh`);
  }
  // A tick that runs past 0 loses it as well.
  const q = new Quest();
  q.event({ kind: 'bank', god: 'ra' });
  assert.deepEqual(said(q.tick(QUEST.modeSeconds * 3, true)).cues, [{ cue: 'modeLost', god: 'ra' }]);
});

test("each mode won by its own goal: Ra's three shots (orbit or ramp), Horus's three pop-ups (each counted once), Ankh's three mummy hits, the Eye's one catch; goal points each time, the prize at the end (the tomb's by its countdown), the toy down, the god crossed off", () => {
  // The Eye's prize is its countdown, so each mode is won with all its time left and with half.
  for (const spent of [0, QUEST.modeSeconds / 2]) {
    for (const god of GODS) {
      const q = new Quest();
      q.event({ kind: 'bank', god });
      q.tick(spent, true);
      const goals = goalsOf(god);
      goals.slice(0, -1).forEach((e, i) => {
        assert.deepEqual(said(q.event(e)), exp({ points: [QUEST.goalPoints], cues: [{ cue: 'goal', god }] }), `${god}: goal hit ${i + 1}`);
        assert.equal(q.view().mode?.progress, i + 1, `${god}: ${i + 1} made`);
      });
      const prize = god === 'eye' ? tombPrize(QUEST.modeSeconds - spent) : QUEST.prize;
      const won = said(q.event(goals[goals.length - 1]));
      assert.deepEqual(
        won,
        exp({ points: [QUEST.goalPoints, prize], toys: [`${TOY_OF[god]} down`], cues: [{ cue: 'goal', god }, { cue: 'modeWon', god, prize }] }),
        `${god}: the last goal hit pays its goal points and the prize`,
      );
      assert.deepEqual(q.view(), { done: [god], mode: null, finale: null }, `${god}: crossed off, no mode`);
      assert.deepEqual(q.toysWanted(), NO_TOYS, `${god}: the toy is put away`);
    }
  }
  // Ra's shots are orbit or ramp, in any mix.
  for (const kinds of [['orbit'], ['ramp'], ['ramp', 'orbit']] as const) {
    const q = new Quest();
    q.event({ kind: 'bank', god: 'ra' });
    const shots = Array.from({ length: QUEST.goals.ra }, (_, i) => kinds[i % kinds.length]);
    const outs = shots.flatMap((kind) => q.event({ kind }));
    assert.deepEqual(q.view().done, ['ra'], `${shots.join(', ')} win Sun Chase`);
    assert.equal(said(outs).cues.filter((c) => c.cue === 'modeWon').length, 1);
  }
  // Ankh's mummy hits count whether or not they put it down.
  for (const down of [false, true]) {
    const a = new Quest();
    a.event({ kind: 'bank', god: 'ankh' });
    for (let i = 0; i < QUEST.goals.ankh; i++) a.event({ kind: 'mummyHit', down });
    assert.deepEqual(a.view().done, ['ankh'], `${QUEST.goals.ankh} hits with down ${down} win The Mummy Wakes`);
  }
  // Horus's pop-ups count once each: the same one reported again, while the mode runs, is nothing (a mode of one pop-up
  // has none to report again: its one hit wins it).
  if (QUEST.goals.horus > 1) {
    const h = new Quest();
    h.event({ kind: 'bank', god: 'horus' });
    assert.deepEqual(said(h.event({ kind: 'popupDown', part: POPUPS[0] })), exp({ points: [QUEST.goalPoints], cues: [{ cue: 'goal', god: 'horus' }] }));
    assert.deepEqual(h.event({ kind: 'popupDown', part: POPUPS[0] }), [], 'the same pop-up again counts nothing');
    assert.equal(h.view().mode?.progress, 1);
    assert.deepEqual(said(h.event({ kind: 'popupDown', part: POPUPS[1] })).cues[0], { cue: 'goal', god: 'horus' }, 'another pop-up counts');
  }
});

test('a hit handled before the clock in the step the time runs out wins; after the mode is over nothing pays', () => {
  const half = QUEST.modeSeconds / 2;
  for (const god of GODS) {
    const goals = goalsOf(god);
    const last = goals[goals.length - 1];
    const lead = () => {
      const q = new Quest();
      q.event({ kind: 'bank', god });
      for (const e of goals.slice(0, -1)) q.event(e);
      return q;
    };
    // The step the time runs out: the game sends the hit, then the clock. The hit wins, and the clock finds no mode.
    const q = lead();
    q.tick(half, true);
    assert.deepEqual(said(q.event(last)).cues.map((c) => c.cue), ['goal', 'modeWon'], `${god}: the hit before the clock wins`);
    assert.deepEqual(q.tick(half, true), [], `${god}: the clock that would have run it out finds no mode`);
    assert.deepEqual(q.view(), { done: [god], mode: null, finale: null });
    // Once it is over nothing pays: the same goals again, and more time.
    for (const e of goals) assert.deepEqual(q.event(e), [], `${god}: nothing pays after it is won`);
    assert.deepEqual(q.tick(QUEST.modeSeconds, true), []);
    // The other way round, the clock first: the mode is lost, and the hit after it pays nothing.
    const late = lead();
    assert.deepEqual(said(late.tick(QUEST.modeSeconds, true)).cues, [{ cue: 'modeLost', god }]);
    assert.deepEqual(late.event(last), [], `${god}: nothing pays after it is lost`);
    assert.deepEqual(late.view(), freshView(), `${god}: the god is not crossed off`);
  }
});

test('two goal hits in one step that finish a mode pay one prize', () => {
  for (const god of GODS) {
    const goals = goalsOf(god);
    const n = goals.length;
    const prize = god === 'eye' ? tombPrize(QUEST.modeSeconds) : QUEST.prize;
    // Two hits in one step, with the mode two short of its goal (where it has two to make): both are needed. Or one
    // short: the first wins it, and the second, a goal hit of the same kind, comes too late.
    for (const short of [1, 2]) {
      if (short > n) continue;
      const q = new Quest();
      q.event({ kind: 'bank', god });
      for (const e of goals.slice(0, n - short)) q.event(e);
      const pair = short === 2 ? [goals[n - 2], goals[n - 1]] : [goals[n - 1], goals[0]];
      const outs = said(pair.flatMap((e) => q.event(e)));
      const what = `${god}, ${short} short`;
      assert.equal(outs.cues.filter((c) => c.cue === 'modeWon').length, 1, `${what}: won once`);
      assert.deepEqual(outs.points, [...Array(short).fill(QUEST.goalPoints), prize], `${what}: the goal points of the hits that counted, and one prize`);
      assert.deepEqual(q.view(), { done: [god], mode: null, finale: null }, what);
    }
  }
});

test("a shot that is another mode's goal gives nothing (an orbit shot during Falcon Strike, a tomb catch during Sun Chase)", () => {
  const horus = new Quest();
  horus.event({ kind: 'bank', god: 'horus' });
  assert.deepEqual(horus.event({ kind: 'orbit' }), [], 'an orbit shot during Falcon Strike');
  assert.deepEqual(horus.event({ kind: 'ramp' }), [], 'a ramp shot during Falcon Strike');
  const ra = new Quest();
  ra.event({ kind: 'bank', god: 'ra' });
  assert.deepEqual(ra.event({ kind: 'tomb' }), [], 'a tomb catch during Sun Chase');
  // Every shot that isn't the running mode's goal, in every mode: no points and no cue, and the mode untouched.
  // (Multiball ending is none of a mode's business either: a lock's or a bought multiball during a mode leaves it
  // running.)
  for (const god of GODS) {
    const q = new Quest();
    q.event({ kind: 'bank', god });
    q.tick(1, true);
    const running = q.view();
    for (const e of SHOTS) {
      if (GOAL_KINDS[god].includes(e.kind)) continue;
      assert.deepEqual(q.event(e), [], `${e.kind} during ${MODE_NAME[god]}`);
    }
    assert.deepEqual(q.view(), running, `${MODE_NAME[god]} runs on untouched`);
  }
  // With no mode running no shot is anything.
  const idle = new Quest();
  for (const e of SHOTS) assert.deepEqual(idle.event(e), [], `${e.kind} with no mode`);
  assert.deepEqual(idle.view(), freshView());
});

test('the fourth god crossed off begins the finale: multiball asked for, the tomb, pop-ups and mummy up, a finale cue', () => {
  for (const last of GODS) {
    const q = crossed(...GODS.filter((g) => g !== last));
    assert.equal(q.view().finale, null, `${last} last: three gods are no finale`);
    q.event({ kind: 'bank', god: last });
    const goals = goalsOf(last);
    for (const e of goals.slice(0, -1)) q.event(e);
    const prize = last === 'eye' ? tombPrize(QUEST.modeSeconds) : QUEST.prize;
    const outs = said(q.event(goals[goals.length - 1]));
    assert.equal(outs.multiball, 1, `${last} last: multiball is asked for`);
    assert.deepEqual(outs.points, [QUEST.goalPoints, prize], `${last} last: the finale itself pays nothing`);
    assert.deepEqual(outs.cues.map((c) => c.cue), ['goal', 'modeWon', 'finale'], `${last} last: its win, then the finale`);
    // The mode's own toy goes down, and the finale's three are asked up (the gate stays at rest).
    assert.deepEqual(outs.toys, [`${TOY_OF[last]} down`, ...FINALE_UP].sort(), `${last} last: the toys`);
    assert.deepEqual(q.view(), { done: [...GODS], mode: null, finale: { jackpot: QUEST.jackpot.first } }, `${last} last: the finale runs`);
    assert.deepEqual(q.toysWanted(), wanting('popups', 'mummy', 'tomb'), `${last} last: the toys wanted`);
  }
});

test("the finale's jackpots climb by QUEST.jackpot.step; a pop-up or the mummy comes back up QUEST.finaleRaise seconds of play after it goes down, each on its own", () => {
  const q = new Quest();
  q.beginFinale();
  // A tomb catch is a jackpot, each worth the step more than the one before, and the scoreboard shows the next.
  for (let k = 0; k < 4; k++) {
    const value = QUEST.jackpot.first + k * QUEST.jackpot.step;
    assert.deepEqual(q.view().finale, { jackpot: value }, `the next jackpot shown, catch ${k + 1}`);
    assert.deepEqual(said(q.event({ kind: 'tomb' })), exp({ points: [value], cues: [{ cue: 'jackpot', value }] }), `catch ${k + 1}`);
  }
  assert.deepEqual(q.view().finale, { jackpot: QUEST.jackpot.first + 4 * QUEST.jackpot.step });
  // Orbit and ramp shots are nothing in the finale.
  for (const e of [{ kind: 'orbit' }, { kind: 'ramp' }] as const) assert.deepEqual(q.event(e), []);

  const half = QUEST.finaleRaise / 2;
  const [a, b, c] = POPUPS;
  // A pop-up knocked down is goal points (the toy's own hit is the game's cue), and comes back up on its own: the first
  // is down for `finaleRaise` seconds of play, however many seconds pass with no ball in play.
  assert.deepEqual(said(q.event({ kind: 'popupDown', part: a })), exp({ points: [QUEST.goalPoints] }));
  assert.deepEqual(q.event({ kind: 'popupDown', part: a }), [], 'reported again while it is down: counted once');
  assert.deepEqual(q.tick(QUEST.finaleRaise * 10, false), [], 'the time with no ball in play does not count');
  assert.deepEqual(q.tick(half, true), [], 'half its time');
  // The second goes down half a time later, and the third half a time after that: each comes back a time after its own.
  assert.deepEqual(said(q.event({ kind: 'popupDown', part: b })), exp({ points: [QUEST.goalPoints] }));
  assert.deepEqual(said(q.tick(half, true)), exp({ raise: [a] }), 'the first comes back alone');
  assert.deepEqual(said(q.event({ kind: 'popupDown', part: c })), exp({ points: [QUEST.goalPoints] }));
  assert.deepEqual(said(q.tick(half, true)), exp({ raise: [b] }), 'the second comes back alone');
  assert.deepEqual(said(q.tick(half, true)), exp({ raise: [c] }), 'and the third');
  assert.deepEqual(q.tick(QUEST.finaleRaise * 10, true), [], 'nothing more to raise');
  // One that came back can be knocked down again, and is again goal points.
  assert.deepEqual(said(q.event({ kind: 'popupDown', part: a })), exp({ points: [QUEST.goalPoints] }));
  assert.deepEqual(said(q.tick(QUEST.finaleRaise, true)), exp({ raise: [a] }), 'and comes back again');

  // The mummy: every hit is goal points, as in The Mummy Wakes, the ones that leave it up too. The hit that puts it
  // down also sets its return, by its part, as a pop-up's knock-down does.
  for (const hit of [1, 2]) {
    assert.deepEqual(said(q.event({ kind: 'mummyHit', down: false })), exp({ points: [QUEST.goalPoints] }), `hit ${hit}, which leaves it up`);
  }
  assert.deepEqual(q.tick(QUEST.finaleRaise * 10, true), [], 'a hit that leaves it up sets no return');
  assert.deepEqual(said(q.event({ kind: 'mummyHit', down: true })), exp({ points: [QUEST.goalPoints] }), 'the hit that puts it down');
  assert.deepEqual(q.tick(half, true), [], 'half its time');
  // A second report of its going down is a hit like the others, and doesn't start its wait again.
  assert.deepEqual(said(q.event({ kind: 'mummyHit', down: true })), exp({ points: [QUEST.goalPoints] }));
  assert.deepEqual(said(q.tick(half, true)), exp({ raise: MUMMY_IDS }), "the mummy comes back: the table's mummy part");
  // A pop-up and the mummy down together come back each at its own time, in the order they went down.
  q.event({ kind: 'mummyHit', down: true });
  q.tick(half, true);
  q.event({ kind: 'popupDown', part: b });
  assert.deepEqual(said(q.tick(half, true)), exp({ raise: MUMMY_IDS }));
  assert.deepEqual(said(q.tick(half, true)), exp({ raise: [b] }));
});

test('multiball ending ends the finale: every toy down, no god done, a finaleEnd cue', () => {
  const q = crossed(...GODS);
  q.event({ kind: 'tomb' });
  q.event({ kind: 'popupDown', part: POPUPS[0] });
  assert.deepEqual(said(q.event({ kind: 'multiballEnded' })), exp({ toys: ALL_DOWN, cues: [{ cue: 'finaleEnd' }] }));
  assert.deepEqual(q.view(), freshView(), 'no god done, nothing running');
  assert.deepEqual(q.toysWanted(), NO_TOYS);
  assert.deepEqual(q.save(), freshSave());
  assert.deepEqual(q.tick(QUEST.finaleRaise * 2, true), [], 'the pop-up waiting to come back is let go');
  assert.deepEqual(q.event({ kind: 'multiballEnded' }), [], 'ended once');
  assert.deepEqual(q.event({ kind: 'tomb' }), [], 'the tomb is no jackpot now');
  // The quest starts over: a match starts a mode, and the next finale begins again at the first jackpot.
  assert.deepEqual(said(q.event({ kind: 'bank', god: 'ra' })).cues, [{ cue: 'modeStart', god: 'ra' }]);
  const again = crossed(...GODS);
  assert.deepEqual(again.view().finale, { jackpot: QUEST.jackpot.first });
  // Multiball already on when the finale begins (the lock's, say, during the last mode). The quest can't know, so it
  // asks for multiball as ever and the game starts no more balls; the finale then runs until that multiball ends. A
  // multiball that ended before the finale began (an earlier one) neither ended the mode nor began anything.
  const mode = crossed(...GODS.slice(0, -1));
  mode.event({ kind: 'bank', god: 'eye' });
  assert.deepEqual(mode.event({ kind: 'multiballEnded' }), [], 'an earlier multiball ending leaves the mode running');
  assert.equal(mode.view().mode?.god, 'eye');
  const won = said(goalsOf('eye').flatMap((e) => mode.event(e)));
  assert.deepEqual(won.cues.map((c) => c.cue).slice(-2), ['modeWon', 'finale'], 'the last god won, the finale begins');
  assert.equal(won.multiball, 1, 'multiball is asked for, once');
  assert.deepEqual(said(mode.event({ kind: 'tomb' })).cues, [{ cue: 'jackpot', value: QUEST.jackpot.first }], 'it is live');
  assert.deepEqual(said(mode.event({ kind: 'multiballEnded' })).cues, [{ cue: 'finaleEnd' }], 'and ends with that multiball');
});

test("a save mid-mode comes back with its time, progress and toy; a save mid-finale waits for a ball in play, then begins it; a save that isn't valid starts afresh", () => {
  // Through the JSON the game keeps it in.
  const round = (q: Quest) => new Quest(JSON.parse(JSON.stringify(q.save())));
  const half = QUEST.modeSeconds / 2;
  for (const god of GODS) {
    const goals = goalsOf(god);
    const play = () => {
      const q = new Quest();
      q.event({ kind: 'bank', god });
      q.tick(half, true);
      for (const e of goals.slice(0, -1)) q.event(e);
      return q;
    };
    const q = play();
    const back = round(q);
    assert.deepEqual(back.view(), q.view(), `${god}: its time and progress come back`);
    assert.equal(back.view().mode?.left, half);
    assert.equal(back.view().mode?.progress, goals.length - 1);
    assert.deepEqual(back.toysWanted(), wanting(TOY_OF[god]), `${god}: its toy is asked for again`);
    assert.deepEqual(back.save(), q.save(), `${god}: and saves as it did`);
    // It carries on from there: the time runs out half a mode on, and the next goal hit wins it.
    assert.deepEqual(said(round(q).tick(half, true)).cues, [{ cue: 'modeLost', god }], `${god}: its time went on`);
    const won = said(round(q).event(goals[goals.length - 1]));
    assert.deepEqual(won.cues.map((c) => c.cue), ['goal', 'modeWon'], `${god}: its goal went on`);
  }
  // Gods crossed off come back, and a restart is no new quest: the next match starts the next god.
  const done = crossed('ra', 'ankh');
  assert.deepEqual(round(done).view(), done.view());
  assert.deepEqual(done.save(), { done: ['ra', 'ankh'], mode: null, finale: false });
  assert.deepEqual(said(round(done).event({ kind: 'bank', god: 'ra' })).cues, [{ cue: 'modeStart', god: 'horus' }]);

  // Mid-finale it waits: the multiball went with the balls, so it begins again with the first ball in play.
  const f = crossed(...GODS);
  f.event({ kind: 'tomb' });
  f.event({ kind: 'popupDown', part: POPUPS[0] });
  assert.deepEqual(f.save(), { done: [...GODS], mode: null, finale: true });
  const w = round(f);
  assert.deepEqual(w.view(), { done: [...GODS], mode: null, finale: null }, 'a finale waiting has not begun');
  assert.deepEqual(w.toysWanted(), NO_TOYS, 'and its toys wait too');
  assert.deepEqual(w.tick(QUEST.modeSeconds, false), [], 'no ball in play, no finale');
  assert.deepEqual(w.event({ kind: 'bank', god: 'ra' }), [], 'a finale waiting takes no mode');
  assert.deepEqual(w.event({ kind: 'tomb' }), [], 'and no jackpot yet');
  assert.deepEqual(w.event({ kind: 'multiballEnded' }), [], 'multiball ending is no end of a finale that has not begun');
  assert.deepEqual(w.save(), { done: [...GODS], mode: null, finale: true }, 'it is saved as it was');
  const begun = said(w.tick(1, true));
  assert.deepEqual(begun, exp({ multiball: 1, toys: FINALE_UP, cues: [{ cue: 'finale' }] }), 'it begins with the first tick with a ball in play, paying nothing');
  assert.deepEqual(w.view(), { done: [...GODS], mode: null, finale: { jackpot: QUEST.jackpot.first } }, 'again from the first jackpot');
  assert.deepEqual(w.tick(1, true), [], 'begun once');
  assert.deepEqual(w.save(), { done: [...GODS], mode: null, finale: true });
  assert.deepEqual(said(w.event({ kind: 'multiballEnded' })).cues, [{ cue: 'finaleEnd' }], 'and ends as a finale does');

  // A time longer than a mode's now (the numbers were tuned since) is cut to it.
  const longer = new Quest({ done: [], mode: { god: 'ra', left: QUEST.modeSeconds * 2, progress: 0 }, finale: false });
  assert.equal(longer.view().mode?.left, QUEST.modeSeconds);
  // Gods in any order, repeated or not, are the gods done, in the quest's order.
  assert.deepEqual(new Quest({ done: ['eye', 'ra', 'eye'], mode: null, finale: false }).view().done, ['ra', 'eye']);

  // A save that isn't what save() writes starts the quest afresh: nothing done, nothing running, every toy down.
  const ra = { god: 'ra', left: 5, progress: 0 };
  const bad: [string, unknown][] = [
    ['none', undefined],
    ['null', null],
    ['a string', 'ra'],
    ['a number', 42],
    ['an empty list', []],
    ['an empty object', {}],
    ['done not a list', { done: 'ra', mode: null, finale: false }],
    ['a god that is not one', { done: ['zeus'], mode: null, finale: false }],
    ['a god that is not one among real ones', { done: ['ra', 'zeus'], mode: null, finale: false }],
    ['a god of another kind', { done: [1], mode: null, finale: false }],
    ['a god of another kind among real ones', { done: ['ra', 1], mode: null, finale: false }],
    ['a mode of a god that is not one', { done: [], mode: { ...ra, god: 'zeus' }, finale: false }],
    ['no mode', { done: [], finale: false }],
    ['no finale', { done: [], mode: null }],
    ['a mode that is not an object', { done: [], mode: 'ra', finale: false }],
    ['a finale that is not a boolean', { done: [...GODS], mode: null, finale: 'yes' }],
    ['no time left', { done: [], mode: { god: 'ra', progress: 0 }, finale: false }],
    ['time left a string', { done: [], mode: { ...ra, left: '5' }, finale: false }],
    ['time left 0', { done: [], mode: { ...ra, left: 0 }, finale: false }],
    ['time left negative', { done: [], mode: { ...ra, left: -1 }, finale: false }],
    ['time left NaN', { done: [], mode: { ...ra, left: NaN }, finale: false }],
    ['time left null (what JSON makes of NaN)', { done: [], mode: { ...ra, left: null }, finale: false }],
    ['time left infinite', { done: [], mode: { ...ra, left: Infinity }, finale: false }],
    ['progress negative', { done: [], mode: { ...ra, progress: -1 }, finale: false }],
    ['progress a fraction', { done: [], mode: { ...ra, progress: 0.5 }, finale: false }],
    ['progress a string', { done: [], mode: { ...ra, progress: '1' }, finale: false }],
    ['progress at its goal (it would have been won)', { done: [], mode: { ...ra, progress: QUEST.goals.ra }, finale: false }],
    ['a finale and a mode', { done: [...GODS], mode: ra, finale: true }],
    ['a finale with gods not all done', { done: ['ra'], mode: null, finale: true }],
    ['every god done and no finale', { done: [...GODS], mode: null, finale: false }],
  ];
  for (const [what, junk] of bad) {
    const q = new Quest(junk);
    assert.deepEqual(q.view(), freshView(), `${what}: starts afresh`);
    assert.deepEqual(q.save(), freshSave(), `${what}: saves afresh`);
    assert.deepEqual(q.toysWanted(), NO_TOYS, `${what}: no toy asked for`);
  }
});

test('reset puts every toy down and clears the quest', () => {
  const states: [string, () => Quest][] = [
    ['idle', () => new Quest()],
    ['with gods done', () => crossed('ra', 'ankh')],
    [
      'mid-mode',
      () => {
        const q = crossed('horus');
        q.event({ kind: 'bank', god: 'eye' });
        q.tick(1, true);
        return q;
      },
    ],
    [
      'mid-finale, a part waiting to come back',
      () => {
        const q = crossed(...GODS);
        q.event({ kind: 'popupDown', part: POPUPS[0] });
        return q;
      },
    ],
    ['a finale waiting for a ball', () => new Quest({ done: [...GODS], mode: null, finale: true })],
  ];
  for (const [what, make] of states) {
    const q = make();
    const outs = q.reset();
    assert.deepEqual(said(outs), exp({ toys: ALL_DOWN }), `${what}: every toy down, and nothing paid or told`);
    assert.deepEqual(q.view(), freshView(), `${what}: cleared`);
    assert.deepEqual(q.save(), freshSave(), `${what}: saved clear`);
    assert.deepEqual(q.toysWanted(), NO_TOYS);
    assert.deepEqual(q.tick(QUEST.modeSeconds + QUEST.finaleRaise, true), [], `${what}: nothing runs on, not even a finale waiting`);
    assert.deepEqual(q.event({ kind: 'multiballEnded' }), []);
    // And it is a new quest: a match starts a mode.
    assert.deepEqual(said(q.event({ kind: 'bank', god: 'ankh' })).cues, [{ cue: 'modeStart', god: 'ankh' }], `${what}: starts afresh`);
  }
});

test('the toys asked for in the outs are always the toys wanted: through modes won and lost, the finale and the Reset', () => {
  const q = new Quest();
  const go = watch(q);
  go(q.event({ kind: 'bank', god: 'ra' }), 'Ra starts');
  go(q.tick(QUEST.modeSeconds, true), 'Ra lost');
  for (const god of GODS) {
    go(q.event({ kind: 'bank', god }), `${god} starts`);
    go(q.tick(1, true), `${god} ticks`);
    for (const e of goalsOf(god)) go(q.event(e), `${god} goal`);
  }
  go(q.event({ kind: 'tomb' }), 'a jackpot');
  go(q.event({ kind: 'popupDown', part: POPUPS[1] }), 'a pop-up down');
  go(q.tick(QUEST.finaleRaise, true), 'a pop-up raised');
  go(q.event({ kind: 'multiballEnded' }), 'the finale ends');
  go(q.event({ kind: 'bank', god: 'horus' }), 'a new quest');
  go(q.reset(), 'the Reset');
});

test("the dev switch starts a god's mode or the finale now, whatever ran ending without a cue or a prize", () => {
  const q = new Quest();
  const go = watch(q);
  // From nothing, as a match of its bank would start it.
  assert.deepEqual(said(go(q.begin('horus'), 'begin')), exp({ toys: ['popups up'], cues: [{ cue: 'modeStart', god: 'horus' }] }));
  q.tick(1, true);
  // Anything that isn't a god (the dev host's action takes what a client sends) starts nothing, and what runs runs on.
  const running = { view: q.view(), save: q.save() };
  for (const junk of ['zeus', '', 'constructor', undefined, null, 1, {}]) {
    assert.deepEqual(go(q.begin(junk as God), 'begin junk'), [], `begin(${String(junk)}) gives nothing`);
  }
  assert.deepEqual({ view: q.view(), save: q.save() }, running, 'the mode runs on as it was');
  assert.deepEqual(new Quest().begin('zeus' as God), [], 'and with nothing running');
  // Another god's mode while one runs: the first ends quietly (no modeLost, nothing paid) and the second starts afresh.
  const swapped = said(go(q.begin('ankh'), 'swap'));
  assert.deepEqual(swapped, exp({ toys: ['mummy up', 'popups down'], cues: [{ cue: 'modeStart', god: 'ankh' }] }));
  assert.deepEqual(q.view(), { done: [], mode: { god: 'ankh', left: QUEST.modeSeconds, progress: 0, goal: QUEST.goals.ankh }, finale: null });
  // The same god again starts it afresh, in time and in progress.
  q.tick(1, true);
  if (QUEST.goals.ankh > 1) q.event({ kind: 'mummyHit', down: false });
  go(q.begin('ankh'), 'again');
  assert.deepEqual(q.view().mode, { god: 'ankh', left: QUEST.modeSeconds, progress: 0, goal: QUEST.goals.ankh });
  // A god that is done can have its mode run again, and winning it crosses nothing off twice.
  const done = crossed('ra');
  done.begin('ra');
  assert.deepEqual(done.view().mode, { god: 'ra', left: QUEST.modeSeconds, progress: 0, goal: QUEST.goals.ra });
  for (const e of goalsOf('ra')) done.event(e);
  assert.deepEqual(done.view(), { done: ['ra'], mode: null, finale: null });
  // The finale now, from a mode: the mode ends quietly, every god is crossed off, and it begins as it would on the
  // fourth. (`go` holds the toys to the toys wanted; one the old mode had up may go down and up again, no matter.)
  const finale = said(go(q.beginFinale(), 'finale'));
  assert.deepEqual([finale.multiball, finale.points, finale.cues], [1, [], [{ cue: 'finale' }]]);
  assert.deepEqual(q.toysWanted(), wanting('popups', 'mummy', 'tomb'));
  assert.deepEqual(q.view(), { done: [...GODS], mode: null, finale: { jackpot: QUEST.jackpot.first } });
  // A mode in place of the finale ends it without a finaleEnd, and the quest starts over.
  const over = said(go(q.begin('eye'), 'over the finale'));
  assert.deepEqual([over.multiball, over.points, over.cues], [0, [], [{ cue: 'modeStart', god: 'eye' }]]);
  assert.deepEqual(q.toysWanted(), wanting('tomb'), "the finale's other toys are put away");
  assert.deepEqual(q.view().done, [], 'the quest starts over');
  // A finale that is waiting is ended the same way.
  const waiting = new Quest({ done: [...GODS], mode: null, finale: true });
  assert.deepEqual(said(waiting.begin('ra')).cues, [{ cue: 'modeStart', god: 'ra' }]);
  assert.deepEqual(waiting.view(), { done: [], mode: { god: 'ra', left: QUEST.modeSeconds, progress: 0, goal: QUEST.goals.ra }, finale: null });
  assert.deepEqual(waiting.save(), { done: [], mode: { god: 'ra', left: QUEST.modeSeconds, progress: 0 }, finale: false });
  // Beginning the finale while it runs begins it again, from the first jackpot.
  q.beginFinale();
  q.event({ kind: 'tomb' });
  go(q.beginFinale(), 'again');
  assert.deepEqual(q.view().finale, { jackpot: QUEST.jackpot.first });
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
