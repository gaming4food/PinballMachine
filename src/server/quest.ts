// The Pharaoh's quest as rules on their own, with no physics: four gods in order (Ra, Horus, Ankh, Eye), each crossed
// off when its mode is won, and the finale when the fourth is. A bank matched starts a god's mode, which raises its toy
// and runs a clock while a ball is in play; its goal hits score, the last one wins it, and running out of time loses it
// and leaves the god to try again. The finale, Pharaoh's Gold, asks for multiball and the tomb, the pop-ups and the
// mummy, pays a jackpot for every ball the tomb catches, brings a pop-up or the mummy back up after it goes down, and
// ends with the multiball. The numbers are QUEST's (shared/pinball.ts).
//
// The game feeds it what happens on the table (event) and the table's clock (tick), and does what comes back
// (QuestOut): points for the ball whose event it was, toys to move, a part to raise, multiball to start, and cues for
// the stages. The game says a step's events before it ticks, so a goal hit in the step the time runs out still wins,
// and once a mode is over nothing pays. Nothing here knows the table or the physics, so the rules are tested on their
// own (npm run quest-test).
import { GODS, isGod, QUEST, tombPrize, type God } from '../shared/pinball';
// Only the type: game.ts imports this file, and a value import back would make a cycle.
import type { Toy } from './game';

/**
 * What happens on the table that the quest cares about, as the game says it. A `bank` is a bank of plaques matched
 * (`god`: its god's). An `orbit` is a ball round an orbit, and a `ramp` one up the left ramp into the dish or turned
 * by the gate into the lock. A `popupDown` is a pop-up knocked down (`part`: its id), a `mummyHit` a hit on the
 * mummy (`down`: whether it put it down), a `tomb` a ball the tomb caught. `multiballEnded` is multiball going from
 * on to off.
 */
export type QuestEvent =
  | { kind: 'bank'; god: God }
  | { kind: 'orbit' }
  | { kind: 'ramp' }
  | { kind: 'popupDown'; part: string }
  | { kind: 'mummyHit'; down: boolean }
  | { kind: 'tomb' }
  | { kind: 'multiballEnded' };

/**
 * What the stages are told. A goal is a goal hit of the god's mode; `prize` is what the mode paid (Tomb Raid's is its
 * countdown); `value` is what the jackpot paid. The game adds when each happened and, for a goal or a jackpot, where.
 */
export type QuestCue =
  | { cue: 'modeStart'; god: God }
  | { cue: 'goal'; god: God }
  | { cue: 'modeWon'; god: God; prize: number }
  | { cue: 'modeLost'; god: God }
  | { cue: 'jackpot'; value: number }
  | { cue: 'finale' }
  | { cue: 'finaleEnd' };

/** What the game is to do, in order. Points are for the ball whose event this was; a `tick` never has any. */
export type QuestOut =
  | { kind: 'points'; points: number }
  | { kind: 'toy'; toy: Toy; up: boolean }
  /** One rising target back up (the finale's pop-up or mummy); the game waits for a ball in its way. */
  | { kind: 'raise'; part: string }
  /** The finale's multiball. The game starts none if multiball is on already. */
  | { kind: 'multiball' }
  | { kind: 'cue'; cue: QuestCue };

/** What the scoreboard and the state show of the quest. */
export interface QuestView {
  /** The gods crossed off, in the quest's order. */
  done: God[];
  /** The mode that runs: seconds of play `left`, and `progress` of `goal` goal hits made. */
  mode: { god: God; left: number; progress: number; goal: number } | null;
  /** The finale that runs, with what its next jackpot pays; null while a saved finale still waits for a ball. */
  finale: { jackpot: number } | null;
}

/** What save() writes and the constructor reads: plain data, for the save file. */
export interface QuestSave {
  done: God[];
  mode: { god: God; left: number; progress: number } | null;
  /** A finale was on, or waiting: it begins again when a ball is in play. */
  finale: boolean;
}

/** The toy each god's mode is played on. */
const GOD_TOY: Record<God, Toy> = { ra: 'diverter', horus: 'popups', ankh: 'mummy', eye: 'tomb' };
/** Every toy down. Being a record keeps TOYS whole: a toy the game gains is a type error here until it is added. */
const NO_TOYS: Record<Toy, boolean> = { popups: false, mummy: false, tomb: false, diverter: false };
const TOYS = Object.keys(NO_TOYS) as Toy[];
/** The toys the finale asks for: all but the gate, which is Sun Chase's alone. */
const FINALE_TOYS: readonly Toy[] = ['tomb', 'popups', 'mummy'];
/**
 * The mummy's part on the pyramid table. A pop-up's id comes with its event, but a hit on the mummy names no part, and
 * the finale has to say which rising target to raise (quest-test holds this to the table's one holding target).
 */
const MUMMY_PART = 'target-mummy';

const pay = (points: number): QuestOut => ({ kind: 'points', points });
const move = (toy: Toy, up: boolean): QuestOut => ({ kind: 'toy', toy, up });
const tell = (cue: QuestCue): QuestOut => ({ kind: 'cue', cue });
const putAway = (): QuestOut[] => TOYS.map((toy) => move(toy, false));

/** The mode that runs. `seen` is the pop-ups it has counted, since Horus's goal is different pop-ups. */
interface Mode {
  god: God;
  left: number;
  progress: number;
  seen: Set<string>;
}

/** The finale that runs: what its next jackpot pays, and each part down with the seconds of play before it returns. */
interface Finale {
  jackpot: number;
  raises: Map<string, number>;
}

/**
 * A saved quest as the constructor takes it, or null if it isn't one save() could have written: the shape and the
 * numbers must be right, and the finale is on exactly when every god is crossed off (and then no mode runs). A mode may
 * have more time than QUEST.modeSeconds now (the numbers were tuned since), and is cut to it.
 */
function readSave(saved: unknown): QuestSave | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const { done, mode, finale } = saved as { done?: unknown; mode?: unknown; finale?: unknown };
  if (!Array.isArray(done) || !done.every(isGod) || typeof finale !== 'boolean') return null;
  const gods = GODS.filter((god) => done.includes(god));
  if (finale !== (gods.length === GODS.length)) return null;
  if (mode === null) return { done: gods, mode: null, finale };
  if (finale || typeof mode !== 'object') return null;
  const { god, left, progress } = mode as { god?: unknown; left?: unknown; progress?: unknown };
  if (!isGod(god) || typeof left !== 'number' || !Number.isFinite(left) || left <= 0) return null;
  if (typeof progress !== 'number' || !Number.isInteger(progress) || progress < 0 || progress >= QUEST.goals[god]) return null;
  return { done: gods, mode: { god, left: Math.min(left, QUEST.modeSeconds), progress }, finale };
}

/**
 * The table's quest, which carries across balls and across a restart (the game keeps save() with the high scores). At
 * most one of a mode, the finale and a finale waiting for a ball is on at a time.
 */
export class Quest {
  /** The gods crossed off. */
  private done = new Set<God>();
  /** The mode that runs, if one does. */
  private mode: Mode | null = null;
  /** The finale that runs, once it has begun. */
  private finale: Finale | null = null;
  /**
   * A saved finale. Its multiball went with the balls when the server restarted, so it waits for a ball to be in play
   * and begins then (tick), as the fourth god's win would have begun it.
   */
  private waiting = false;

  /** A quest as save() wrote it. A save that isn't valid starts afresh: a damaged file loses only the quest. */
  constructor(saved?: unknown) {
    const s = readSave(saved);
    if (!s) return;
    this.done = new Set(s.done);
    this.waiting = s.finale;
    // Which pop-ups Horus's mode had counted isn't saved, only how many: the toys come back up (toysWanted) and count
    // from that progress.
    if (s.mode) this.mode = { ...s.mode, seen: new Set() };
  }

  /**
   * Something happened on the table. The game says a step's events before it ticks. An event that is not the running
   * mode's goal gives nothing, and after a mode is won or lost nothing pays, in the same step too.
   */
  event(e: QuestEvent): QuestOut[] {
    if (e.kind === 'bank') return this.bank(e.god);
    // Multiball ends the finale and nothing else: one that ends during a mode (the lock's, a bought one) leaves it be.
    if (e.kind === 'multiballEnded') return this.finale ? this.endFinale() : [];
    if (this.mode) return this.counts(this.mode, e) ? this.goal(this.mode, e) : [];
    if (this.finale) return this.finaleHit(this.finale, e);
    return [];
  }

  /**
   * The table's clock: `dt` seconds have passed, and a ball is in play or not. A mode's time and the finale's waits run
   * only in play, so the time between balls (the next ball up, or launching) is not the mode's: the next viewer's ball
   * picks it up where the last left it. The first tick with a ball in play begins a saved finale. A tick pays nothing:
   * running out of time and a finale beginning have no ball to pay.
   */
  tick(dt: number, inPlay: boolean): QuestOut[] {
    if (!inPlay) return [];
    if (this.waiting) return this.startFinale();
    if (this.mode) {
      this.mode.left -= dt;
      return this.mode.left > 0 ? [] : this.lose(this.mode);
    }
    return this.finale ? this.raiseDue(this.finale, dt) : [];
  }

  /**
   * The dev host's switch, and the tests': starts this god's mode now, even if it is done. Whatever ran ends without a
   * cue or a prize, as it is neither won nor lost, and a finale that ends takes the quest with it. Anything that isn't
   * a god (the host passes on what a client sent) starts nothing, and what runs runs on.
   */
  begin(god: God): QuestOut[] {
    if (!isGod(god)) return [];
    return [...this.abandon(), ...this.start(god)];
  }

  /**
   * The dev host's switch, and the tests', for the finale: it begins now, with every god crossed off, and whatever ran
   * ends first as in begin (a finale already on begins again, from its first jackpot).
   */
  beginFinale(): QuestOut[] {
    return [...this.abandon(), ...this.startFinale()];
  }

  /**
   * The toys the quest has asked for and not put away: the game asks for them again after a restart. A pop-up that was
   * knocked down is still wanted, and a saved finale wants none until it begins.
   */
  toysWanted(): Record<Toy, boolean> {
    const wanted = { ...NO_TOYS };
    if (this.mode) wanted[GOD_TOY[this.mode.god]] = true;
    if (this.finale) for (const toy of FINALE_TOYS) wanted[toy] = true;
    return wanted;
  }

  view(): QuestView {
    const { mode, finale } = this;
    return {
      done: this.doneGods(),
      mode: mode && { god: mode.god, left: mode.left, progress: mode.progress, goal: QUEST.goals[mode.god] },
      finale: finale && { jackpot: finale.jackpot },
    };
  }

  /** What to keep in the save file. The pop-ups a Horus mode has counted aren't kept (the constructor says why). */
  save(): QuestSave {
    const { mode } = this;
    return {
      done: this.doneGods(),
      mode: mode && { god: mode.god, left: mode.left, progress: mode.progress },
      finale: this.finale !== null || this.waiting,
    };
  }

  /** The streamer's Reset: the quest cleared and every toy put away, nothing paid and no cue (the table is cleared). */
  reset(): QuestOut[] {
    this.done.clear();
    this.mode = null;
    this.finale = null;
    this.waiting = false;
    return putAway();
  }

  private doneGods(): God[] {
    return GODS.filter((god) => this.done.has(god));
  }

  /** A bank matched: its god's mode starts, or the next god's if that one is done. A mode or the finale takes none. */
  private bank(god: God): QuestOut[] {
    if (this.mode || this.finale || this.waiting) return [];
    const from = GODS.indexOf(god);
    if (from < 0) return [];
    for (let k = 0; k < GODS.length; k++) {
      // After the Eye comes Ra.
      const next = GODS[(from + k) % GODS.length];
      if (!this.done.has(next)) return this.start(next);
    }
    // Every god done is the finale, which took the match above, so this is never reached.
    return [];
  }

  private start(god: God): QuestOut[] {
    this.mode = { god, left: QUEST.modeSeconds, progress: 0, seen: new Set() };
    return [move(GOD_TOY[god], true), tell({ cue: 'modeStart', god })];
  }

  /** Whether the event is a goal hit of the mode. A pop-up counts once: two balls reported on it in a step are one. */
  private counts(mode: Mode, e: QuestEvent): boolean {
    switch (mode.god) {
      case 'ra':
        return e.kind === 'orbit' || e.kind === 'ramp';
      case 'horus':
        return e.kind === 'popupDown' && !mode.seen.has(e.part);
      case 'ankh':
        return e.kind === 'mummyHit';
      case 'eye':
        return e.kind === 'tomb';
    }
  }

  /** A goal hit: goal points and a cue, the last one too, and then the mode is won. */
  private goal(mode: Mode, e: QuestEvent): QuestOut[] {
    if (e.kind === 'popupDown') mode.seen.add(e.part);
    mode.progress++;
    const outs = [pay(QUEST.goalPoints), tell({ cue: 'goal', god: mode.god })];
    return mode.progress < QUEST.goals[mode.god] ? outs : [...outs, ...this.win(mode)];
  }

  /**
   * The mode is won: the prize (Tomb Raid's by what is left of its time), the toy put away, the god crossed off. The
   * fourth god begins the finale at once, with the rest of this event's outs; a hit after it in the step is a finale's.
   */
  private win(mode: Mode): QuestOut[] {
    const prize = mode.god === 'eye' ? tombPrize(mode.left) : QUEST.prize;
    this.mode = null;
    this.done.add(mode.god);
    const outs = [pay(prize), tell({ cue: 'modeWon', god: mode.god, prize }), move(GOD_TOY[mode.god], false)];
    return this.done.size < GODS.length ? outs : [...outs, ...this.startFinale()];
  }

  /** The time ran out: no prize, the god stays undone, and its progress goes with the mode. */
  private lose(mode: Mode): QuestOut[] {
    this.mode = null;
    return [tell({ cue: 'modeLost', god: mode.god }), move(GOD_TOY[mode.god], false)];
  }

  /** The finale begins: multiball and its toys asked for, and every god shown crossed off while it runs. */
  private startFinale(): QuestOut[] {
    this.done = new Set(GODS);
    this.waiting = false;
    this.finale = { jackpot: QUEST.jackpot.first, raises: new Map() };
    return [{ kind: 'multiball' }, ...FINALE_TOYS.map((toy) => move(toy, true)), tell({ cue: 'finale' })];
  }

  /**
   * In the finale a ball in the tomb is a jackpot, and a pop-up knocked down and every hit on the mummy are goal
   * points, as in their modes. A pop-up, or the mummy when a hit puts it down, comes back up QUEST.finaleRaise seconds
   * of play later (raiseDue).
   */
  private finaleHit(finale: Finale, e: QuestEvent): QuestOut[] {
    switch (e.kind) {
      case 'tomb': {
        const value = finale.jackpot;
        finale.jackpot += QUEST.jackpot.step;
        return [pay(value), tell({ cue: 'jackpot', value })];
      }
      case 'popupDown':
        // One already down is waiting to come back, so a second report of it counts nothing, as in a mode.
        if (finale.raises.has(e.part)) return [];
        finale.raises.set(e.part, QUEST.finaleRaise);
        return [pay(QUEST.goalPoints)];
      case 'mummyHit':
        // Every hit pays, as in The Mummy Wakes, but its wait is set once, by the hit that puts it down: a second
        // report of its going down is a hit like the rest, and doesn't start the wait again.
        if (e.down && !finale.raises.has(MUMMY_PART)) finale.raises.set(MUMMY_PART, QUEST.finaleRaise);
        return [pay(QUEST.goalPoints)];
      default:
        return [];
    }
  }

  /** Each part whose time down is up comes back on its own, and they come in the order they went down. */
  private raiseDue(finale: Finale, dt: number): QuestOut[] {
    const outs: QuestOut[] = [];
    for (const [part, left] of [...finale.raises]) {
      const rest = left - dt;
      if (rest > 0) {
        finale.raises.set(part, rest);
      } else {
        finale.raises.delete(part);
        outs.push({ kind: 'raise', part });
      }
    }
    return outs;
  }

  /** Multiball ended: every toy goes down and the quest starts over, with no god done. */
  private endFinale(): QuestOut[] {
    this.done.clear();
    this.finale = null;
    return [...putAway(), tell({ cue: 'finaleEnd' })];
  }

  /** Ends whatever runs without a cue or a prize, for the dev switch: its toys go down, a finale takes the quest. */
  private abandon(): QuestOut[] {
    const wanted = this.toysWanted();
    if (this.finale || this.waiting) this.done.clear();
    this.mode = null;
    this.finale = null;
    this.waiting = false;
    return TOYS.filter((toy) => wanted[toy]).map((toy) => move(toy, false));
  }
}
