// The pinball game on the server (Task 4 of the pinball plan): viewers line their balls up with `ball`, and each
// launches when the table is free; all of chat flips with `left` and `right`, and when chat goes quiet the auto-save
// flips for it (missing now and then). The table's parts score, a bank of plaques all turned to their backs pays its
// bonus, both drop targets (the scarab and the eye) light the lock, a ball in the lit lock starts multiball (more balls
// from the line, then the house's), all 3 top rollovers light the kickback, the ball saver gives a quick drain back, a
// stuck ball gets a nudge, and one no nudge frees goes back to the plunger lane. A drained ball pays: its points make
// coins, 70% to its owner and the rest shared by everyone who flipped it (the owner too, if they flipped). The quest's
// toys (the pop-ups, the mummy, the tomb and the diverter's gate) are raised, opened and swung as the game is asked to
// (setToy), each only when no ball is in its way; the mummy goes down on its third hit, and a ball in the tomb scores.
// Each hit on a toy also goes to the stages, as a cue (cue). The Pharaoh's quest (quest.ts has its rules) hears what
// happens on the table and its clock, and the game does what it says (The quest, below): its modes and their toys,
// their goals and prizes, the finale and its multiball, and its moments to the stages. It is saved with the high
// scores. Chat's three events are hype buttons too (Chat's events, below): a sandstorm's wind across the table,
// Pharaoh's curse swapping chat's left and right, and the summoned mummy, whose third hit pays its ball 10,000.
//
// The physics is sim.ts; this is the rules. Every timer here runs on the table's clock (sim.time), never Date.now():
// the city and the stand-in host stop stepping the machine while no stage shows it (runsUnseen: false), and the ball,
// its saver, the auto-save and the quest all wait with it. The one wall-clock check is whether the table is running at
// all, for chat's flip words (chatFlip).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { BodyState, FeedItem, FeedTone, Platform, RoomInfo, ServerMsg } from '@kit/shared';
import { type Economy, hypeId, type HypePurchase, log, type Machine, type MachineOutlet, type StreamEvent, type User } from '@kit/server';
import { gust, type HypeBuyer, isGod, LIT, parsePinballCommands, type PinballCueMsg, type PinballHypeMsg, type PinballMsg, type PinballState, RULES } from '../shared/pinball';
import { TABLE_IN_USE, TABLE, isLockTarget, type Table } from '../shared/table';
import { Quest, type QuestCue, type QuestEvent, type QuestOut, type QuestSave } from './quest';
import { DT, PinballSim, type Hit } from './sim';

/** How many high scores are kept. */
const HIGH_SCORES = 10;
/** How many lines of the feed a stage that connects is sent. */
const FEED_KEPT = 12;
/** The auto-save misses 1 flip in this many. */
const AUTO_MISS = 6;
/** After an auto-save flip, the flipper is left down this long before the next, so it can drop and swing again. */
const AUTO_REST = 0.15;
/**
 * Both drop targets down: they stay down this long (s) before they come back up, so the stage shows the second one drop
 * (raised in the substep it dropped, it never showed down), and longer while a ball stands where one rises.
 */
const DROPS_SHOW = 1;
/** Multiball's balls are launched this far apart (s), so two never sit in the plunger lane at once. */
const MULTIBALL_GAP = 0.6;
/** The centre lane's four rollovers, in order, and the insert each lights (LIT). All four lit pay CENTRE_BONUS. */
const CENTRE_LAMPS = ['centre-1', 'centre-2', 'centre-3', 'centre-4'] as const;
const CENTRE_LIT = [LIT.centre0, LIT.centre1, LIT.centre2, LIT.centre3] as const;
const CENTRE_BONUS = 1000;
/** The three top lanes: lighting all of them lights the kickback. The inlane and outlane rollovers only score. */
const TOP_LANES = ['rollover-1', 'rollover-2', 'rollover-3'] as const;
/** A stuck ball is nudged this many times; stuck still after them, it goes back to the plunger lane (watchStuck). */
const STUCK_NUDGES = 3;
/**
 * The quest's toys the game moves (setToy): all the pop-up targets, the mummy, the tomb's door and the diverter's gate.
 * The pop-ups and the mummy are the table's rising targets (Target.rise: RISERS says which a toy stands for).
 */
const TOYS = ['popups', 'mummy', 'tomb', 'diverter'] as const;
export type Toy = (typeof TOYS)[number];
const isToy = (x: unknown): x is Toy => TOYS.some((toy) => toy === x);
const RISERS = { popups: 'drop', mummy: 'hold' } as const;
const RISING_TOYS = Object.keys(RISERS) as (keyof typeof RISERS)[];
/**
 * The mummy goes down on this many hits since it rose. The Mummy Wakes can ask no more hits than this
 * (QUEST.goals.ankh, which pinball-test holds to it): down, the mummy takes none until it is asked up again.
 */
export const MUMMY_HITS = 3;
/** The switch across each orbit lane (pyramid.ts), by which Sun Chase counts a shot round the orbit (ORBIT_ROUND). */
const ORBIT_SWITCHES = ['orbit-left', 'orbit-right'] as const;
/** The left ramp's switch at its top, into the dish: every ball that gets in comes back down the ramp past it. */
const DISH_SWITCH = 'ramp-dish';
/** The left ramp's switch beside the gate's gap, into the lock: no ball comes back in through the gap. */
const GATE_SWITCH = 'ramp-gate';
/**
 * An orbit shot goes round the orbit, up one lane and over the top, so it counts when a ball that passed one orbit
 * switch going up the table comes down past the other lane's within this long (s). A pass up alone is no shot: of the
 * real flips that pass the right lane's switch going up, only 46 of 69 go round (pyramid.ts), and the rest fall back.
 * Round the orbit took 0.75 to 3.47 s from the pass up to the other lane's switch (1.23 s the median, in 302 balls that
 * went round), so 4 s takes in every one. The other lane's switch is met going down: a ball that falls back from one
 * lane and is flipped up the other meets that one going up, which is a pass up of its own and takes the first's place.
 */
export const ORBIT_ROUND = 4;
/**
 * A flip word counts only within this long (wall-clock ms) of the table's last step. Every machine the city has made
 * hears every chat line, and the claw's and the Speedway's players say left and right too: while the pinball is
 * paused (no stage shows it), their words aren't flips here.
 */
const FLIPS_AFTER_STEP_MS = 1000;

/** What a bought press's line says the viewer bought: "Ben bought a nudge!" (buyHype). */
const BOUGHT: Record<string, string> = {
  multiball: 'multiball',
  saver: 'a ball saver',
  double: 'double score',
  nudge: 'a nudge',
  sandstorm: 'a sandstorm',
  curse: "Pharaoh's curse",
  mummy: 'the mummy',
};
/** A press's line for the streamer (its first), and what follows the buyer's name in a bought one (its second). */
const NEWS: Record<string, readonly [string, string]> = {
  multiball: ['Multiball!', '2 more balls are coming.'],
  saver: ['Ball saver!', 'No ball can drain for 15 seconds.'],
  double: ['Double score!', 'Every point counts twice for 30 seconds.'],
  nudge: ['Nudge!', 'The table jolts.'],
  sandstorm: ['Sandstorm!', 'The sand blows.'],
  curse: ["Pharaoh's curse!", 'Left is right.'],
  mummy: ['The mummy rises!', 'Three hits put it down.'],
};
/**
 * What paid support presses (supported), by the size of a gift as the city sizes them (a sub as a gift up to $5), each
 * then the hype it gives way to when it can't happen: no ball to nudge or start multiball with, a saver already waiting.
 */
const SUPPORT_HYPE: readonly (readonly string[])[] = [
  ['nudge', 'saver', 'double', 'multiball'], // under $1
  ['saver', 'double', 'nudge', 'multiball'], // a sub, or up to $5
  ['double', 'saver', 'nudge', 'multiball'], // up to $20
  ['multiball', 'double', 'saver', 'nudge'], // $20 and up
];
/** A gift's size, as coin-op-city's card sizes it (city-services.ts): 1 under $1 to 4 from $20. */
const giftTier = (usdCents: number) => (usdCents >= 2000 ? 4 : usdCents >= 500 ? 3 : usdCents >= 100 ? 2 : 1);
/** The card's effect line for what paid support set off (supportEffect). */
const SUPPORT_EFFECT: Record<string, string> = {
  multiball: 'MULTIBALL!',
  saver: 'BALL SAVER!',
  double: 'DOUBLE SCORE!',
  nudge: 'NUDGE!',
};
/** A press set off by paid support (supported): free, so nothing ever goes back, and its line thanks the supporter. */
interface SupportPress extends HypePurchase {
  readonly thanks: string;
}
const thanksOf = (purchase: HypePurchase | undefined) => (purchase as Partial<SupportPress> | undefined)?.thanks;
/** How a moment names the viewer who bought it (PinballHypeMsg.by). */
const buyerOf = (purchase: HypePurchase): HypeBuyer => ({ name: purchase.user.name, color: purchase.user.color });

/** The table's physics, with the snapshot the city asks for (no arguments) lit as the game has it. */
class LitSim extends PinballSim {
  constructor(table: Table, hits: (hit: Hit) => void, private readonly litNow: () => number) {
    super(table, hits);
  }

  override snapshot(lit: number = this.litNow()): Buffer {
    return super.snapshot(lit);
  }
}

/** A ball on the table, as the game keeps it. */
interface BallPlay {
  /** Its owner (null for a house ball). */
  owner: User | null;
  points: number;
  /** Everyone who flipped while it was on the table, each once (its owner too, who then shares the 30% as one). */
  flippers: Map<number, User>;
  /** When it was first launched: the ball saver's start (a save keeps it, so a save doesn't start a new one). */
  launchedAt: number;
  /** Where it last was more than a ball's radius from, and when: a ball that stays put for stuckSeconds is nudged. */
  anchor: { x: number; z: number; at: number };
  /** The nudges it has had since it last moved (watchStuck). */
  nudges: number;
  /** Where it last was across the table, for the score popups when it drains. */
  x: number;
}

/** What save() writes: the high scores, and the quest as it is (Quest.save), which a restart takes up where it was. */
interface SavedPinball {
  highScores: { name: string; points: number }[];
  quest: QuestSave;
}

/** Whether a saved quest has nothing in it (no god done, no mode, no finale): what a quest just begun saves. */
function emptyQuest(saved: unknown): boolean {
  const s = saved as Partial<QuestSave> | null | undefined;
  return Array.isArray(s?.done) && s.done.length === 0 && s.mode === null && s.finale === false;
}

export class PinballGame implements Machine {
  readonly sim: LitSim;
  avatarUrl: (userId: number) => string | null = () => null;

  /** The balls waiting their turn, in order. */
  private line: User[] = [];
  /** The ball whose launch moment it is, and when it launches. */
  private upNext: { user: User; at: number } | null = null;
  /** Multiball's balls still to launch (null: a house ball), and when the next goes. */
  private extraBalls: (User | null)[] = [];
  private nextExtraAt = 0;
  private readonly balls = new Map<number, BallPlay>();
  /** The ball held in the lock for multiball, or null. */
  private heldBall: number | null = null;
  private multiball = false;
  private lockLit = false;
  private kickbackLit = false;
  /** The drop targets hit since both last went down, by id (the second clears it, and both stay down DROPS_SHOW). */
  private readonly targetsHit = new Set<string>();
  /** When both drop targets, down, come back up (DROPS_SHOW after the second dropped); Infinity: none is waiting to. */
  private dropsUpAt = Infinity;
  /** The top lanes' rollovers lit since all three last lit (which lights the kickback), by id. */
  private readonly rolloversLit = new Set<string>();
  /** The centre lane's lamps lit, by rollover id (centre-1 to centre-4). */
  private readonly centreLit = new Set<string>();
  /**
   * What each toy was last asked to be (setToy): up is raised, open or over. They all start down, shut and at rest, as
   * the table does.
   */
  private readonly toyUp: Record<Toy, boolean> = { popups: false, mummy: false, tomb: false, diverter: false };
  /**
   * The parts of the toys not yet where they were asked to be, by part (a rising target's id, or 'tomb' or 'diverter'),
   * each with its toy and whether it was asked up: a ball is in the way, and moveToys tries again next step. Only what
   * was asked for is here: a pop-up a ball knocks down is not. Each part keeps what it was asked, since a toy asked up
   * can leave a part as it was (setToy's `except`): the mummy asked down by its third hit stays asked down when the
   * finale that hit began asks its toy up.
   */
  private readonly toyWaits = new Map<string, { toy: Toy; up: boolean }>();
  /** The hits the mummy has taken since it last rose: its MUMMY_HITS-th puts it down. */
  private mummyHits = 0;
  /** The Pharaoh's quest: its rules (quest.ts), which the game feeds and does as they say (The quest, below). */
  private quest = new Quest();
  /**
   * Each ball's last pass up an orbit lane, by its switch, and when on the table's clock: the ball coming down past the
   * other lane's switch within ORBIT_ROUND is an orbit shot (switchPassed). A later pass up takes its place, and a ball
   * that leaves the table takes its own with it.
   */
  private readonly orbitUp = new Map<number, { id: string; at: number }>();
  /** Double score and the bought ball saver run until these, on the table's clock (-Infinity: off). */
  private doubleUntil = -Infinity;
  private saverUntil = -Infinity;
  /** When chat's last flip word came, and till when each flipper is held up for chat and for the auto-save. */
  private lastWord = -Infinity;
  private readonly chatUp = { left: -Infinity, right: -Infinity };
  private readonly autoUp = { left: -Infinity, right: -Infinity };
  /** The auto-save's next flip on each side waits till this (its rest after a flip, or after a miss). */
  private readonly autoNext = { left: -Infinity, right: -Infinity };
  /**
   * Chat's events (Chat's events, below), each null while it isn't on, timed on the table's clock: the sandstorm from
   * its start until its end, blowing toward `dir` along x (gust's arguments); Pharaoh's curse until its end; and the
   * summoned mummy until it goes down unpaid. None is saved, so a restart forgets them.
   */
  private storm: { start: number; until: number; dir: 1 | -1 } | null = null;
  private curseUntil: number | null = null;
  private summonUntil: number | null = null;
  /** A ball saver pressed with no ball on the table: it starts with the next launch (null: none waits). */
  private saverWaiting: { purchase?: HypePurchase } | null = null;
  /** What the last paid support set off (supported), for the city's card, which it builds straight after the machines hear the event. */
  private supportDid: string | null = null;
  private lastResult: PinballState['lastResult'] = null;
  private scores: { name: string; points: number }[] = [];
  private lastStepMs = 0;
  /** When the table last stepped, by the wall clock (Date.now()): the one wall-clock time here (FLIPS_AFTER_STEP_MS). */
  private lastStepWall = -Infinity;

  private readonly feedLog: FeedItem[] = [];
  private feedId = 1;
  private boardDirty = true;
  private meterDirty = true;
  private stateDirty = true;
  private lastBoardAt = 0;
  private lastLeadersAt = 0;

  constructor(
    readonly room: RoomInfo,
    private readonly economy: Economy,
    private readonly out: MachineOutlet,
    private readonly saveFile: string,
    private readonly table: Table = TABLE_IN_USE,
  ) {
    this.sim = new LitSim(table, (hit) => this.hit(hit), () => this.lit());
  }

  private get platforms(): ReadonlySet<Platform> {
    return new Set(this.room.platforms);
  }

  /** The balls in the line (the status line's "in line"). */
  get queued(): number {
    return this.line.length;
  }

  get stepMs(): number {
    return this.lastStepMs;
  }

  /** Whether the auto-save has the flippers (no flip from chat for autoSaveAfter). */
  get autoSaving(): boolean {
    return this.sim.time - this.lastWord >= RULES.autoSaveAfter;
  }

  // --- Saving ---

  load(): void {
    if (!existsSync(this.saveFile)) return;
    try {
      const saved = JSON.parse(readFileSync(this.saveFile, 'utf8')) as Partial<SavedPinball>;
      const rows = Array.isArray(saved.highScores) ? saved.highScores : [];
      this.scores = rows
        .filter((r) => typeof r?.name === 'string' && Number.isFinite(r?.points))
        .map((r) => ({ name: r.name, points: Math.max(0, Math.round(r.points)) }))
        .sort((a, b) => b.points - a.points)
        .slice(0, HIGH_SCORES);
      log.info(`pinball: ${this.scores.length} high scores from the last session`);
      // The quest as it was: a mode with its time left and its progress, or a finale that begins again with the next
      // ball in play (quest.ts). One the quest can't take starts afresh, which is said here as unread scores are: a
      // file whose quest had something in it, and a quest from it with nothing.
      this.quest = new Quest(saved.quest);
      if (saved.quest !== undefined && !emptyQuest(saved.quest) && emptyQuest(this.quest.save())) {
        log.warn('pinball: could not read the saved quest; starting it afresh');
      }
      // Its toys, asked for again: they come up from the first step, as the game asked for them before the restart.
      const wanted = this.quest.toysWanted();
      for (const toy of TOYS) if (wanted[toy]) this.setToy(toy, true);
    } catch (err) {
      log.warn('pinball: could not read the saved high scores; starting with none', err);
    }
  }

  save(): void {
    const tmp = `${this.saveFile}.tmp`;
    const saved: SavedPinball = { highScores: this.scores, quest: this.quest.save() };
    writeFileSync(tmp, JSON.stringify(saved));
    renameSync(tmp, this.saveFile);
  }

  /** The best balls so far, best first (at most 10). */
  highScores(): { name: string; points: number }[] {
    return this.scores.map((s) => ({ ...s }));
  }

  // --- What the stages and the panel get ---

  hello(): ServerMsg {
    return {
      t: 'hello',
      room: this.room,
      simTime: this.sim.time,
      pusherZ: 0,
      bodies: [...this.balls.keys()].filter((id) => this.sim.items.has(id)).map((id) => this.body(id)),
      avatars: {},
      board: this.leaderboard(),
      meter: this.economy.meterState(this.room.id),
      feed: this.feedLog,
      machine: this.panelState(),
    };
  }

  /** The pinball as its stage and its card get it: hello's and each 'machine' message's. */
  panelState(): PinballMsg {
    return { kind: 'pinball', state: this.state() };
  }

  state(): PinballState {
    const now = this.sim.time;
    return {
      phase: this.balls.size > 0 ? 'playing' : this.upNext ? 'launching' : 'idle',
      balls: [...this.balls.values()].map((b) => ({ owner: b.owner?.id ?? null, name: b.owner?.name ?? null, score: b.points })),
      line: this.line.map((u) => ({ userId: u.id, name: u.name })),
      multiball: this.multiball,
      doubleUntil: this.doubleUntil > now ? this.doubleUntil : null,
      saverUntil: this.saverEnds(),
      lockLit: this.lockLit,
      lastResult: this.lastResult,
      waiting: this.saverWaiting ? ['saver'] : [],
      quest: this.questState(),
      events: {
        sandstorm: this.storm && { until: this.storm.until, dir: this.storm.dir },
        curse: this.curseUntil === null ? null : { until: this.curseUntil },
        mummy: this.summonUntil === null ? null : { until: this.summonUntil },
      },
    };
  }

  /** When the ball saver now on ends (the bought one, or a fresh ball's), or null when none is on. */
  private saverEnds(): number | null {
    let ends = this.saverUntil;
    for (const b of this.balls.values()) ends = Math.max(ends, b.launchedAt + RULES.ballSaverStart);
    return ends > this.sim.time ? ends : null;
  }

  /** The inserts lit, for the snapshot (shared/pinball.ts LIT). */
  private lit(): number {
    let bits = 0;
    if (this.lockLit) bits |= LIT.lock;
    if (this.kickbackLit) bits |= LIT.kickback;
    const rollovers = [LIT.rollover0, LIT.rollover1, LIT.rollover2];
    this.table.rollovers.forEach((r, i) => {
      if (i < rollovers.length && this.rolloversLit.has(r.id)) bits |= rollovers[i];
    });
    CENTRE_LAMPS.forEach((id, i) => {
      if (this.centreLit.has(id)) bits |= CENTRE_LIT[i];
    });
    if (this.doubleUntil > this.sim.time) bits |= LIT.double;
    if (this.saverEnds() !== null) bits |= LIT.saver;
    return bits;
  }

  /** A ball's body state for the stages, with its owner (sim.state) and their name effect, for its tag. */
  private body(id: number): BodyState {
    const body = this.sim.state(id);
    const owner = this.balls.get(id)?.owner;
    if (owner?.nameFx) body.fx = owner.nameFx;
    return body;
  }

  avatarReady(userId: number, url: string): void {
    this.out.send({ t: 'avatar', owner: userId, url });
  }

  leaderboard(): ReturnType<Economy['leaderboard']> {
    return this.economy.leaderboard(this.platforms);
  }

  leaders(): ServerMsg {
    return { t: 'leaders', leaders: this.economy.careerLeaders(this.platforms) };
  }

  recentFeed(): FeedItem[] {
    return this.feedLog;
  }

  /** A line in this machine's live feed, from the channel (its answers to !coins and !color). */
  announce(text: string, tone: FeedTone, user?: User): void {
    this.feed(text, tone, user);
  }

  markBoardDirty(): void {
    this.boardDirty = true;
  }

  /** Nothing to prune: chat's words aren't rate limited (a flood of flips counts each viewer once, on each ball). */
  pruneLimits(): void {}

  resetMeter(): void {
    this.economy.resetMeter(this.room.id);
    this.meterDirty = true;
  }

  /** Board, meter and pinball updates that have piled up. Called a few times a second. */
  publish(now: number): void {
    if (now - this.lastLeadersAt >= 30_000) {
      this.lastLeadersAt = now;
      this.out.send(this.leaders());
    }
    if (this.meterDirty) {
      this.meterDirty = false;
      this.out.send({ t: 'meter', meter: this.economy.meterState(this.room.id) });
    }
    if (this.boardDirty && now - this.lastBoardAt >= 1000) {
      this.boardDirty = false;
      this.lastBoardAt = now;
      this.out.send({ t: 'board', rows: this.leaderboard() });
    }
    if (this.stateDirty) {
      this.stateDirty = false;
      this.out.send({ t: 'machine', msg: this.panelState() });
    }
  }

  // --- The panel ---

  /**
   * From the control panel (a 'machine.action'). `{ kind: 'remove', userId }` takes that viewer's ball out of the line
   * (not off the table); a hype button (hypeId; the buttons are listed in entry.ts) is pressed for free, as often as
   * the streamer likes (press). Two more are the dev host's, taken only where PINBALL_TOYS is '1', which
   * `npm run dev:toys` sets: the city never does, and shows no button for them. `{ kind: 'toy', toy, up }` raises or
   * puts away a toy (setToy), and `{ kind: 'quest', start }` starts a god's mode, or with 'finale' the finale, now
   * (Quest.begin and beginFinale: whatever ran ends with no moment and no prize). Anything can arrive, so anything
   * else, a hype button this table hasn't got among it, a toy that isn't one, a god that isn't one, is ignored.
   */
  action(action: unknown): void {
    const hype = hypeId(action);
    if (hype !== null) {
      this.press(hype);
      return;
    }
    const a = action as { kind?: unknown; userId?: unknown; toy?: unknown; up?: unknown; start?: unknown } | null;
    if (a?.kind === 'toy') {
      if (process.env.PINBALL_TOYS === '1' && isToy(a.toy) && typeof a.up === 'boolean') this.setToy(a.toy, a.up);
      return;
    }
    if (a?.kind === 'quest') {
      if (process.env.PINBALL_TOYS !== '1') return;
      if (a.start === 'finale') this.followQuest(this.quest.beginFinale(), null);
      else if (isGod(a.start)) this.followQuest(this.quest.begin(a.start), null);
      return;
    }
    if (a?.kind !== 'remove' || typeof a.userId !== 'number') return;
    const user = this.line.find((u) => u.id === a.userId) ?? (this.upNext?.user.id === a.userId ? this.upNext.user : null);
    if (!user) return;
    this.line = this.line.filter((u) => u.id !== a.userId);
    if (this.upNext?.user.id === a.userId) this.upNext = null;
    this.feed(`${user.name}'s ball leaves the line.`, 'info', user);
    this.stateDirty = true;
  }

  /** From the control panel: the table cleared and the line emptied, paying nothing. */
  resetMachine(): void {
    for (const id of this.sim.clear()) this.out.send({ t: 'despawn', at: this.sim.time, id, reason: 'cleared' });
    this.balls.clear();
    this.line = [];
    this.upNext = null;
    this.extraBalls = [];
    this.heldBall = null;
    this.multiball = false;
    this.lockLit = false;
    this.kickbackLit = false;
    this.targetsHit.clear();
    this.dropsUpAt = Infinity;
    this.rolloversLit.clear();
    this.centreLit.clear();
    this.orbitUp.clear();
    this.sim.resetTargets();
    // The quest cleared, with nothing paid and no moment (Quest.reset), and every toy put away through the game, the
    // quest's and any the dev host's switch raised: the pop-ups and the mummy down, the tomb shut, the gate at rest.
    // The table is clear (a ball the tomb held went with the rest), so no ball is in the way and none has to wait. The
    // sim's clear() leaves the gate where it was, so this is what sets it back.
    this.followQuest(this.quest.reset(), null);
    for (const toy of TOYS) this.setToy(toy, false);
    this.moveToys();
    // Bought hype must not outlive the reset: the saver and double score, and a saver still waiting, whose buyer gets
    // their coins back (refund) when the city says so.
    this.saverUntil = this.doubleUntil = -Infinity;
    // And chat's events end with nothing paid: the wind calm now, not at the next step, and the mummy down with the
    // toys above.
    this.storm = null;
    this.curseUntil = this.summonUntil = null;
    this.sim.setWind(0);
    this.lastWord = -Infinity;
    this.autoNext.left = this.autoNext.right = -Infinity;
    const waiting = this.saverWaiting;
    this.saverWaiting = null;
    if (waiting?.purchase) this.refund(waiting.purchase, 'The machine was reset');
    this.chatUp.left = this.chatUp.right = -Infinity;
    this.autoUp.left = this.autoUp.right = -Infinity;
    this.setFlippers();
    this.feed('The table is cleared.', 'info');
    this.stateDirty = true;
  }

  // --- Chat ---

  handle(ev: StreamEvent): void {
    // Known to the wallet either way; the pusher gives newcomers their welcome bonus, since it sees them first.
    const { user } = this.economy.touch(ev.platform, ev.userId, ev.name);
    if (ev.kind === 'sub' || ev.kind === 'gift') this.supported(user, ev);
    if (ev.kind !== 'chat') return;
    const cmd = parsePinballCommands(ev.text);
    if (cmd.join) this.join(user);
    // Pharaoh's curse swaps chat's words here, where they're read, so the auto-save keeps its own sides and a cursed
    // flip still counts its viewer on the ball, as any flip does.
    const cursed = this.cursed;
    if (cmd.left) this.chatFlip(cursed ? 'right' : 'left', user);
    if (cmd.right) this.chatFlip(cursed ? 'left' : 'right', user);
  }

  // --- The hype buttons ---

  /**
   * Chat buys a press of hype button `id` (coin-op-city's chat-hype.ts, which has taken the coins already). It does what
   * the streamer's press does, for that viewer, and returns null. Or it does nothing and returns why not, in lowercase
   * with no full stop: the city gives the coins straight back and tells the viewer. Where it differs: a press that
   * would do nothing is refused with no line in the feed; its line leads with the buyer and its moment names them; a
   * saver that waits keeps its purchase, and a reset gives the coins back (refund).
   */
  buyHype(id: string, purchase: HypePurchase): string | null {
    return this.press(id, purchase);
  }

  /**
   * Paid support presses a hype button for free, by its size (SUPPORT_HYPE): a gift under $1 nudges, a sub or a gift up
   * to $5 is a ball saver, up to $20 double score, and from $20 multiball. One that can't happen gives way to the next
   * that can, as a bought press is refused (press). Its line thanks the supporter and its moment names them. The city's
   * card for it then names what it set off (supportEffect).
   */
  private supported(user: User, ev: Extract<StreamEvent, { kind: 'sub' | 'gift' }>): void {
    const tier = ev.kind === 'sub' ? 2 : giftTier(ev.usdCents);
    const thanks = ev.says || (ev.kind === 'sub' ? 'subscribed' : `sent ${ev.label}`);
    const press: SupportPress = { user, paid: 0, thanks, refund: () => false };
    this.supportDid = SUPPORT_HYPE[tier - 1].find((id) => this.press(id, press) === null) ?? null;
  }

  /** The effect line on paid support's card here: what it set off, once (supported), or null when it set nothing off. */
  supportEffect(_support: { kind: 'sub' | 'gift'; tier: number }): string | null {
    const did = this.supportDid;
    this.supportDid = null;
    return did ? SUPPORT_EFFECT[did] : null;
  }

  /**
   * A hype button pressed: by the streamer (action), or bought by a viewer (`purchase`: buyHype). Returns why it does
   * nothing, or null. The streamer's press that does nothing says why in the feed; a bought one is told instead.
   */
  private press(id: string, purchase?: HypePurchase): string | null {
    const now = this.sim.time;
    const onTable = this.sim.items.size > 0;
    switch (id) {
      case 'multiball': {
        if (!onTable) return this.refuse(purchase, "there's no ball on the table", "There's no ball on the table.");
        if (this.multiball) return this.refuse(purchase, 'multiball is already on', 'Multiball is already on.');
        this.pressLine(purchase, id);
        // "2 more balls in now": the ball in play stays in play; only a shot into the lit lock holds one.
        this.startMultiball(null);
        this.moment(id, purchase);
        break;
      }
      case 'saver':
        if (this.saverWaiting) return this.refuse(purchase, 'a ball saver is already waiting', 'A ball saver is already waiting.');
        if (onTable) {
          this.saverUntil = now + RULES.saverHype;
          this.pressLine(purchase, id);
          this.moment(id, purchase);
        } else {
          this.saverWaiting = { purchase };
          this.pressLine(purchase, id, 'It starts with the next ball.');
        }
        break;
      case 'double':
        this.doubleUntil = Math.max(now, this.doubleUntil) + RULES.doubleHype;
        this.pressLine(purchase, id);
        this.moment(id, purchase);
        break;
      case 'nudge':
        if (!onTable) return this.refuse(purchase, "there's no ball to nudge", "There's no ball to nudge.");
        this.sim.nudge();
        this.pressLine(purchase, id);
        this.moment(id, purchase);
        break;
      case 'sandstorm':
      case 'curse':
      case 'mummy': {
        if (!onTable) return this.refuse(purchase, "there's no ball on the table", "There's no ball on the table.");
        const why = this.startEvent(id);
        if (why) return this.refuse(purchase, why, `${why.charAt(0).toUpperCase()}${why.slice(1)}.`);
        this.pressLine(purchase, id);
        this.moment(id, purchase);
        break;
      }
      default:
        return "that hype isn't for sale";
    }
    this.stateDirty = true;
    return null;
  }

  // --- Chat's events ---

  /** Whether Pharaoh's curse is on: chat's left and right are swapped (handle). */
  private get cursed(): boolean {
    return this.curseUntil !== null && this.sim.time < this.curseUntil;
  }

  /**
   * Starts one of chat's events, with a ball on the table (press has seen to it), or says why it can't, in lowercase
   * with no full stop. Every clock is the table's, from now, and runs on whether a ball is in play or not: the events
   * are short, and belong to the moment they were bought in.
   * - A sandstorm blows its wind (gust) for RULES.sandstormHype, toward a side picked at random. One on already blows
   *   on as long again from its end, its own way, and keeps its start, so its ease out moves to the new end.
   * - Pharaoh's curse swaps chat's left and right (handle) for RULES.curseHype, and a second adds as long again.
   * - The summoned mummy is raised as the quest raises it (setToy: it waits for a ball in its way), for RULES.mummyHype
   *   from now, even while it waits: its third hit pays summonPrize (hit), and at its time it goes down unpaid
   *   (eventClocks). It is refused while it is up already, summoned or the quest's, and in its own mode and the finale,
   *   which have it. It is allowed in Sun Chase: up, it blocks the left ramp and so Sun Chase's gate shots, but the
   *   orbits still count, and its hits are no shot of Sun Chase's.
   */
  private startEvent(id: 'sandstorm' | 'curse' | 'mummy'): string | null {
    const now = this.sim.time;
    switch (id) {
      case 'sandstorm':
        if (this.storm) this.storm.until += RULES.sandstormHype;
        else this.storm = { start: now, until: now + RULES.sandstormHype, dir: Math.random() < 0.5 ? -1 : 1 };
        return null;
      case 'curse':
        this.curseUntil = Math.max(now, this.curseUntil ?? now) + RULES.curseHype;
        return null;
      case 'mummy': {
        const { mode, finale } = this.quest.view();
        if (mode?.god === 'ankh') return 'the mummy is in its mode';
        if (finale) return 'the mummy is in the finale';
        if (this.summonUntil !== null || this.toyWanted('mummy')) return 'the mummy is up already';
        this.summonUntil = now + RULES.mummyHype;
        this.setToy('mummy', true);
        return null;
      }
    }
  }

  /**
   * Chat's events' clocks, once a step before the physics: each event over at its time is sent as over (the state), the
   * summoned mummy put down unpaid (unless the quest wants it up, which never leaves a summon on: followQuest ends it),
   * and the wind set for the step from the storm, or calm with none.
   */
  private eventClocks(): void {
    const now = this.sim.time;
    if (this.storm && now >= this.storm.until) {
      this.storm = null;
      this.stateDirty = true;
    }
    if (this.curseUntil !== null && now >= this.curseUntil) {
      this.curseUntil = null;
      this.stateDirty = true;
    }
    if (this.summonUntil !== null && now >= this.summonUntil) {
      this.summonUntil = null;
      if (!this.quest.toysWanted().mummy) this.setToy('mummy', false);
      this.stateDirty = true;
    }
    const { storm } = this;
    this.sim.setWind(storm ? gust(now, storm.start, storm.until, storm.dir) : 0);
  }

  /**
   * The summoned mummy put down by its third hit, by ball `ball` (its play `b`): summonPrize to that ball as it is, not
   * doubled, since double score doubles the table's own parts and not set prizes; the summon over; and a summonDown cue
   * to the stages at the ball's place, after the hit's own.
   */
  private summonDown(b: BallPlay, ball: number): void {
    this.summonUntil = null;
    this.score(b, RULES.summonPrize);
    const { x, z } = this.sim.items.get(ball)!.body.translation();
    const msg: PinballCueMsg = { kind: 'pinballCue', cue: 'summonDown', value: RULES.summonPrize, x, z, at: this.sim.time };
    this.out.send({ t: 'machine', msg });
  }

  /** A press that does nothing, and why: the streamer's says so in the feed (`line`); a bought one is told `reason` instead. */
  private refuse(purchase: HypePurchase | undefined, reason: string, line: string): string {
    if (!purchase) this.feed(line, 'info');
    return reason;
  }

  /**
   * A press's line in the feed: the streamer's own, or one that leads with the buyer and what they bought (BOUGHT), in
   * their colour: "Ben bought a nudge! The table jolts." A supporter's line thanks them instead. `news` replaces what
   * follows.
   */
  private pressLine(purchase: HypePurchase | undefined, id: string, news = NEWS[id][1]): void {
    const thanks = thanksOf(purchase);
    if (purchase && thanks) this.feed(`${purchase.user.name} ${thanks}: ${BOUGHT[id]}! ${news}`, 'gift', purchase.user);
    else if (purchase) this.feed(`${purchase.user.name} bought ${BOUGHT[id]}! ${news}`, 'milestone', purchase.user);
    else this.feed(`${NEWS[id][0]} ${news}`, 'milestone');
  }

  /** A hype button's moment, to the stages (PinballHypeMsg). Bought, it names the buyer. Not to the panel's state. */
  private moment(id: string, by?: HypePurchase): void {
    const msg: PinballHypeMsg = { kind: 'pinballHype', id, at: this.sim.time, ...(by ? { by: buyerOf(by) } : {}) };
    this.out.send({ t: 'machine', msg });
  }

  /** Gives a buyer their coins back for a hype that can't happen after all; the line only when the city says they went back. */
  private refund(purchase: HypePurchase, why: string): boolean {
    if (!purchase.refund()) return false;
    this.feed(`${why}: ${purchase.user.name} gets their ${purchase.paid} coins back.`, 'info', purchase.user);
    return true;
  }

  /** `ball`: into the line, unless they have a ball in it, up next, or on the table already. */
  private join(user: User): void {
    const has =
      this.line.some((u) => u.id === user.id) ||
      this.upNext?.user.id === user.id ||
      this.extraBalls.some((u) => u?.id === user.id) ||
      [...this.balls.values()].some((b) => b.owner?.id === user.id);
    if (has) {
      this.feed(`${user.name} already has a ball.`, 'info', user);
      return;
    }
    this.line.push(user);
    this.feed(`${user.name} is in line (${ordinal(this.line.length)}).`, 'drop', user);
    this.stateDirty = true;
  }

  /**
   * `left` or `right`: that flipper up for flipHold from now, and the viewer counted once on every ball in play. Unless
   * the table hasn't stepped for FLIPS_AFTER_STEP_MS: paused, the word is another machine's chat (the claw's and the
   * Speedway's players say left and right too), so it flips nothing, counts nobody and isn't chat's last word. This
   * one check is by the wall clock because the table's own clock stands still while it's paused; every timer of the
   * game's stays on sim.time.
   */
  private chatFlip(side: 'left' | 'right', user: User): void {
    if (Date.now() - this.lastStepWall > FLIPS_AFTER_STEP_MS) return;
    const now = this.sim.time;
    this.lastWord = now;
    this.chatUp[side] = now + RULES.flipHold;
    // The auto-save hands back at once: a flip of its own still up drops.
    this.autoUp.left = this.autoUp.right = -Infinity;
    for (const [id, b] of this.balls) if (id !== this.heldBall) b.flippers.set(user.id, user);
    this.setFlippers();
  }

  // --- The toys ---

  /**
   * Asks for a toy up (the pop-ups or the mummy raised, the tomb open, the gate swung over) or down (put away). The
   * game moves it from the next step on, and never into a ball: a pop-up or the mummy isn't raised where a ball stands,
   * the door isn't shut on a ball in the doorway or held there, the gate isn't swung while a ball is in its sweep (nor
   * over while one is on its ramp or in the dish above, which it would shut in). What a ball is in the way of waits,
   * and is tried again every step (moveToys). It is a request to move, not a standing order: a pop-up a ball knocks
   * down stays down until it is asked up again (a mode that wants all three down needs it so). The mummy asked up
   * afresh has taken no hits; asked up again while up, it keeps its count. The parts named in `except` are left as they
   * were last asked (the quest's finale leaves the part the winning hit put down, and raises it later: raisePart).
   */
  setToy(toy: Toy, up: boolean, except: readonly string[] = []): void {
    this.ask(toy, up, this.partsOf(toy).filter((part) => !except.includes(part)));
  }

  /**
   * Asks for one rising target back up, by its id: a pop-up, or the mummy (the finale raises each again after it goes
   * down, the mummy by the game's own three-hit rule). It waits for a ball in its way as a toy's parts do (moveToys),
   * its toy is wanted up, and the mummy asked up afresh has taken no hits, as setToy has it: always, since a part is
   * raised only after it went down, even when its toy was left wanted up (setToy's `except`). An id that is no rising
   * target's does nothing.
   */
  raisePart(part: string): void {
    const rise = this.table.targets.find((t) => t.id === part)?.rise;
    const toy = RISING_TOYS.find((t) => RISERS[t] === rise);
    if (!toy) return;
    if (toy === 'mummy') this.mummyHits = 0;
    this.ask(toy, true, [part]);
  }

  /** What setToy and raisePart ask for: the toy wanted up (or down), and these of its parts moved to it (moveToys). */
  private ask(toy: Toy, up: boolean, parts: string[]): void {
    if (toy === 'mummy' && up && !this.toyUp.mummy) this.mummyHits = 0;
    this.toyUp[toy] = up;
    for (const part of parts) this.toyWaits.set(part, { toy, up });
  }

  /** Whether the toy was last asked up (setToy): the mummy's third hit asks it down, and so does a reset. */
  toyWanted(toy: Toy): boolean {
    return this.toyUp[toy];
  }

  /**
   * What a toy is made of: the ids of the rising targets it stands for, or the tomb's or the gate's own name. A table
   * without a tomb or a gate has nothing to move for it.
   */
  private partsOf(toy: Toy): string[] {
    if (toy === 'tomb') return this.table.tomb ? [toy] : [];
    if (toy === 'diverter') return this.table.diverter ? [toy] : [];
    return this.table.targets.filter((t) => t.rise === RISERS[toy]).map((t) => t.id);
  }

  /** Brings about what the toys were asked to be, a part at a time; a part a ball is in the way of waits a step. */
  private moveToys(): void {
    for (const [part, { toy, up }] of this.toyWaits) if (this.moveToy(toy, part, up)) this.toyWaits.delete(part);
  }

  /** Moves one part of a toy as it was asked: true when it is there, false while a ball is in the way. */
  private moveToy(toy: Toy, part: string, up: boolean): boolean {
    switch (toy) {
      case 'popups':
      case 'mummy':
        if (up) return this.sim.raiseTarget(part);
        this.sim.lowerTarget(part);
        return true;
      case 'tomb':
        if (!up) return this.sim.closeTomb();
        this.sim.openTomb();
        return true;
      case 'diverter':
        return this.sim.setDiverter(up);
    }
  }

  // --- Stepping ---

  step(): void {
    const t0 = performance.now();
    this.lastStepWall = Date.now();
    this.launches();
    this.autoSave();
    this.setFlippers();
    this.eventClocks();
    this.sim.step();
    this.questClock();
    this.raiseDrops();
    this.moveToys();
    this.watchStuck();
    this.lastStepMs = performance.now() - t0;
  }

  /** Both drop targets back up when their time down is over, once no ball stands where one rises. */
  private raiseDrops(): void {
    if (this.sim.time < this.dropsUpAt || this.sim.ballAtDropTarget()) return;
    this.dropsUpAt = Infinity;
    this.sim.resetDropTargets();
  }

  /** Multiball's balls and the line's next ball (after its moment), as their times come. */
  private launches(): void {
    const now = this.sim.time;
    if (this.extraBalls.length && now >= this.nextExtraAt) {
      const user = this.extraBalls.shift()!;
      this.launch(user && this.economy.get(user.id) ? user : null);
      this.nextExtraAt = now + MULTIBALL_GAP;
    }
    if (this.upNext && now >= this.upNext.at) {
      const { user } = this.upNext;
      this.upNext = null;
      if (this.economy.get(user.id)) this.launch(user);
    }
    if (!this.upNext && this.balls.size === 0 && this.extraBalls.length === 0) {
      const user = this.nextInLine();
      if (user) {
        this.upNext = { user, at: now + RULES.launchDelay };
        this.feed(`${user.name} is up!`, 'drop', user);
        this.stateDirty = true;
      }
    }
  }

  /** The line's next viewer, skipping any the wallet no longer has (removed). */
  private nextInLine(): User | undefined {
    while (this.line.length && !this.economy.get(this.line[0].id)) this.line.shift();
    const user = this.line.shift();
    if (user) this.stateDirty = true;
    return user;
  }

  /** Fires a ball for `owner` (null: the house's) up the plunger lane, and tells the stages. A save carries its play. */
  private launch(owner: User | null, carry?: BallPlay): number {
    const id = this.sim.launch(owner?.id ?? null);
    const now = this.sim.time;
    if (this.saverWaiting && !carry) {
      // A saver bought with no ball on the table starts with this launch.
      const { purchase } = this.saverWaiting;
      this.saverWaiting = null;
      this.saverUntil = now + RULES.saverHype;
      this.moment('saver', purchase);
    }
    const p = this.sim.items.get(id)!.body.translation();
    this.balls.set(id, {
      owner,
      points: carry?.points ?? 0,
      flippers: carry?.flippers ?? new Map(),
      launchedAt: carry?.launchedAt ?? now,
      anchor: { x: p.x, z: p.z, at: now },
      nudges: 0,
      x: p.x,
    });
    this.out.send({ t: 'spawn', at: now, body: this.body(id), ...(owner ? { label: owner.name } : {}) });
    this.stateDirty = true;
    return id;
  }

  /** With chat quiet, a ball near a flipper is flipped at, missing 1 time in AUTO_MISS. */
  private autoSave(): void {
    if (!this.autoSaving) return;
    const now = this.sim.time;
    for (const id of this.balls.keys()) {
      if (id === this.heldBall) continue;
      const side = this.sim.nearFlipper(id);
      if (!side || now < this.autoNext[side]) continue;
      this.autoNext[side] = now + RULES.flipHold + AUTO_REST;
      if (Math.random() * AUTO_MISS < 1) continue; // a miss: the flipper stays down this time
      this.autoUp[side] = now + RULES.flipHold;
    }
  }

  private setFlippers(): void {
    const now = this.sim.time;
    for (const side of ['left', 'right'] as const) this.sim.flip(side, now < this.chatUp[side] || now < this.autoUp[side]);
  }

  /**
   * A ball that has stayed within a ball's radius of one spot for stuckSeconds gets the table nudged. One still stuck
   * after STUCK_NUDGES nudges is never left there: it's taken off and launched again up the plunger lane (unstick). A
   * ball something holds still on purpose isn't stuck: the lock's, a saucer's (the magnet is one) and the tomb's.
   */
  private watchStuck(): void {
    const now = this.sim.time;
    const stuck: number[] = [];
    for (const [id, b] of this.balls) {
      const ball = this.sim.items.get(id);
      if (!ball) continue;
      const p = ball.body.translation();
      b.x = p.x;
      const heldBy = this.sim.heldBy(id);
      if (id === this.heldBall || heldBy === 'saucer' || heldBy === 'tomb' || Math.hypot(p.x - b.anchor.x, p.z - b.anchor.z) > TABLE.ballRadius) {
        b.anchor = { x: p.x, z: p.z, at: now };
        b.nudges = 0;
      } else if (now - b.anchor.at >= RULES.stuckSeconds) {
        stuck.push(id);
      }
    }
    if (!stuck.length) return;
    const nudged = stuck.filter((id) => this.balls.get(id)!.nudges < STUCK_NUDGES);
    for (const id of stuck) if (!nudged.includes(id)) this.unstick(id);
    for (const b of this.balls.values()) b.anchor.at = now;
    if (!nudged.length) return;
    this.sim.nudge();
    for (const id of nudged) this.balls.get(id)!.nudges++;
    this.feed('The table gets a nudge.', 'info');
  }

  /**
   * A stuck ball no nudge freed: off the table and launched again for the same owner, with its points, its flippers
   * and its ball saver's start, as a save carries them. Launched again rather than drained and paid, since the table
   * lost it, not the player: their turn goes on. Not a drain to the stages ('cleared'), so they neither play one nor
   * take it for a saved ball.
   */
  private unstick(id: number): void {
    const b = this.balls.get(id)!;
    this.sim.remove(id);
    this.balls.delete(id);
    this.orbitUp.delete(id);
    this.out.send({ t: 'despawn', at: this.sim.time, id, reason: 'cleared' });
    this.launch(b.owner, b);
    this.feed(`${b.owner ? `${b.owner.name}'s ball` : 'The house ball'} is stuck: back to the plunger.`, 'info', b.owner ?? undefined);
  }

  // --- The table's hits ---

  /** A part of the table was hit (after a substep, so this may launch, remove and clear). */
  private hit(hit: Hit): void {
    if (hit.kind === 'drain') {
      this.drained(hit.ball);
      return;
    }
    const b = this.balls.get(hit.ball);
    if (!b) return;
    const points = this.pointsFor(hit);
    this.score(b, points);
    switch (hit.kind) {
      case 'target': {
        // A pop-up or the mummy is a toy, and its hit is a cue to the stages. The physics has dropped a pop-up that was
        // hit, so its cue says `down`. The mummy goes down on its MUMMY_HITS-th hit since it rose (each hit scored
        // above, the last too), and only that hit's cue says `down`: a hit after that, from a second ball in the same
        // step, asks it down again and changes nothing. Asked up afresh, it starts again from none (setToy).
        const rise = this.table.targets.find((t) => t.id === hit.id)?.rise;
        if (rise) {
          let down = true;
          if (rise === 'hold') {
            this.mummyHits++;
            down = this.mummyHits === MUMMY_HITS;
            if (this.mummyHits >= MUMMY_HITS) this.setToy('mummy', false);
          }
          this.cue(hit.id, down, hit.ball);
          // The summoned mummy's third hit pays (summonDown). The quest takes a summoned mummy over before its mode or
          // the finale could count this hit (followQuest), so a summon still on here is never the quest's mummy.
          if (rise === 'hold' && down && this.summonUntil !== null) this.summonDown(b, hit.ball);
          // And the quest hears of it: a pop-up knocked down, or a hit on the mummy, saying whether it put it down.
          this.questEvent(rise === 'hold' ? { kind: 'mummyHit', down } : { kind: 'popupDown', part: hit.id }, hit.ball);
          break;
        }
        // Only the lock's two drop targets (the scarab and the eye) count toward it: the flip plaques have their banks.
        const drops = this.table.targets.filter(isLockTarget);
        if (!drops.some((t) => t.id === hit.id)) break;
        this.targetsHit.add(hit.id);
        if (drops.every((t) => this.targetsHit.has(t.id))) {
          // The drop targets come back up for the next time round (DROPS_SHOW later, raiseDrops); the lock stays lit
          // till a ball goes in.
          this.targetsHit.clear();
          this.dropsUpAt = this.sim.time + DROPS_SHOW;
          if (!this.lockLit) {
            this.lockLit = true;
            this.feed('Lock lit!', 'milestone');
          }
        }
        break;
      }
      case 'bank':
        this.bankMatched(b, hit.id, points, hit.ball);
        break;
      case 'rollover':
        if (CENTRE_LAMPS.some((id) => id === hit.id)) {
          this.centreLit.add(hit.id);
          if (CENTRE_LAMPS.every((id) => this.centreLit.has(id))) {
            this.centreLit.clear();
            this.score(b, this.doubled(CENTRE_BONUS));
          }
          break;
        }
        if (!TOP_LANES.some((id) => id === hit.id)) break;
        this.rolloversLit.add(hit.id);
        if (TOP_LANES.every((id) => this.rolloversLit.has(id))) {
          this.rolloversLit.clear();
          if (!this.kickbackLit) {
            this.kickbackLit = true;
            this.feed('Kickback lit!', 'milestone');
          }
        }
        break;
      case 'lock':
        if (this.lockLit && !this.multiball) this.startMultiball(hit.ball);
        break;
      case 'kickback':
        if (this.kickbackLit) {
          this.kickbackLit = false;
          this.sim.kickback(hit.ball);
          this.feed('Kickback!', 'win', b.owner ?? undefined);
        }
        break;
      case 'tomb':
        // The ball the tomb caught scored above; the stages are told of the catch, and so is the quest.
        this.cue(hit.id, false, hit.ball);
        this.questEvent({ kind: 'tomb' }, hit.ball);
        break;
      case 'switch':
        // A switch scores nothing, and a shot it counts sends the state itself (followQuest). Most passes count nothing
        // and change nothing, so they send no state to every stage.
        this.switchPassed(hit.id, hit.ball);
        return;
    }
    this.stateDirty = true;
  }

  /**
   * A toy hit, to the stages (PinballCueMsg): the part, whether the hit put it down, where the ball is and when. Like a
   * hype moment, it goes to every client and is never part of hello; the panel's card reads only the state. The physics
   * reports a hit only for a ball it still has, so the ball is on the table here.
   */
  private cue(part: string, down: boolean, ball: number): void {
    const { x, z } = this.sim.items.get(ball)!.body.translation();
    const msg: PinballCueMsg = { kind: 'pinballCue', cue: 'toyHit', part, down, x, z, at: this.sim.time };
    this.out.send({ t: 'machine', msg });
  }

  /**
   * A bank's plaques all show their backs, by ball `ball` (its play `b`): its title to the stages, a line in the feed
   * with the bonus scored, and then the match to the quest, which starts its god's mode (or the next god's not done)
   * when no mode or finale runs.
   */
  private bankMatched(b: BallPlay, id: string, paid: number, ball: number): void {
    const name = id.replace(/^bank-/, '');
    this.moment(id);
    const who = b.owner ? b.owner.name : 'The house ball';
    this.feed(`${who} matched the ${name.charAt(0).toUpperCase()}${name.slice(1)} bank! +${paid.toLocaleString('en-US')}`, 'win', b.owner ?? undefined);
    if (isGod(name)) this.questEvent({ kind: 'bank', god: name }, ball);
  }

  private doubled(points: number): number {
    return this.doubleUntil > this.sim.time ? points * 2 : points;
  }

  /** What a hit scores, from the table (doubled under double score). */
  private pointsFor(hit: Hit): number {
    const t = this.table;
    let points = 0;
    if (hit.kind === 'bumper') points = t.bumpers.find((p) => p.id === hit.id)?.points ?? 0;
    else if (hit.kind === 'sling') points = t.slings.find((p) => p.id === hit.id)?.points ?? 0;
    else if (hit.kind === 'target') points = t.targets.find((p) => p.id === hit.id)?.points ?? 0;
    else if (hit.kind === 'rollover') points = t.rollovers.find((p) => p.id === hit.id)?.points ?? 0;
    else if (hit.kind === 'spinner') points = hit.id === 'spinner' ? t.spinner.pointsPerTurn : (t.spinners.find((p) => p.id === hit.id)?.pointsPerTurn ?? 0);
    else if (hit.kind === 'saucer') points = t.saucers.find((p) => p.id === hit.id)?.points ?? 0;
    else if (hit.kind === 'bank') points = t.banks.find((p) => p.id === hit.id)?.bonus ?? 0;
    else if (hit.kind === 'tomb') points = t.tomb?.points ?? 0;
    return this.doubled(points);
  }

  private score(b: BallPlay, points: number): void {
    if (points <= 0) return;
    b.points += points;
    this.stateDirty = true;
  }

  /**
   * Multiball begins: maxExtraBalls more, from the line and then the house. From the lit lock (`id`: the ball that went
   * in), the lock holds that ball till the others are down to one; from a press (null), no ball is held, and multiball
   * ends when one ball is left (drained).
   */
  private startMultiball(id: number | null): void {
    this.multiball = true;
    for (let i = 0; i < RULES.maxExtraBalls; i++) this.extraBalls.push(this.nextInLine() ?? null);
    this.nextExtraAt = this.sim.time;
    if (id === null) return;
    this.lockLit = false;
    this.heldBall = id;
    this.sim.holdInLock(id);
    const owner = this.balls.get(id)?.owner;
    this.feed(`${owner ? `${owner.name}'s ball` : 'The ball'} is locked: MULTIBALL!`, 'milestone', owner ?? undefined);
  }

  /** A ball went down the drain (it's already off the table): saved, or paid. */
  private drained(id: number): void {
    const b = this.balls.get(id);
    if (!b) return;
    this.balls.delete(id);
    this.orbitUp.delete(id);
    this.out.send({ t: 'despawn', at: this.sim.time, id, reason: 'lost' });
    this.stateDirty = true;
    const now = this.sim.time;
    if (now < b.launchedAt + RULES.ballSaverStart || now < this.saverUntil) {
      this.launch(b.owner, b);
      this.feed(`${b.owner ? `${b.owner.name}'s ball` : 'The house ball'} is saved!`, 'win', b.owner ?? undefined);
      return;
    }
    this.pay(b);
    // The multiball's last ball but one has drained: the held ball is let go.
    const free = [...this.balls.keys()].filter((k) => k !== this.heldBall).length;
    if (this.heldBall !== null && free <= 1 && this.extraBalls.length === 0) {
      this.sim.release(this.heldBall);
      this.heldBall = null;
    }
    // One ball left: multiball is over, and the quest hears of it going off (it ends the finale, and no mode).
    if (this.multiball && this.heldBall === null && this.extraBalls.length === 0 && this.balls.size <= 1) {
      this.multiball = false;
      this.followQuest(this.quest.event({ kind: 'multiballEnded' }), null);
    }
  }

  /**
   * A drained ball's points make coins: round(ownerShare) of them to its owner, the rest shared equally (floor) by
   * everyone who flipped it, the owner included if they flipped, and what's left over to the owner. Anyone the wallet
   * no longer has is skipped, and a house ball pays nobody.
   */
  private pay(b: BallPlay): void {
    const points = b.points.toLocaleString('en-US');
    if (!b.owner) {
      this.feed(`The house ball: ${points} points.`, 'info');
      return;
    }
    const owner = b.owner;
    const coins = Math.floor(b.points / RULES.pointsPerCoin);
    const flippers = [...b.flippers.values()].filter((u) => this.economy.get(u.id));
    const ownerFlipped = flippers.some((u) => u.id === owner.id);
    const ownerShare = Math.round(coins * RULES.ownerShare);
    const rest = coins - ownerShare;
    const each = flippers.length ? Math.floor(rest / flippers.length) : 0;
    const toOwner = ownerShare + (ownerFlipped ? each : 0) + (rest - each * flippers.length);
    if (this.economy.get(owner.id)) this.credit(owner, toOwner, b.x);
    for (const u of flippers) if (u.id !== owner.id) this.credit(u, each, b.x);
    this.lastResult = { name: owner.name, points: b.points, coins };
    this.feed(`${owner.name}'s ball: ${points} points, ${coins} ${coins === 1 ? 'coin' : 'coins'}.`, coins > 0 ? 'win' : 'info', owner);
    if (b.points > 0) {
      this.scores.push({ name: owner.name, points: b.points });
      this.scores.sort((a, c) => c.points - a.points);
      this.scores.length = Math.min(this.scores.length, HIGH_SCORES);
    }
    if (coins > 0) {
      const milestone = this.economy.addToMeter(this.room.id, coins);
      this.meterDirty = true;
      if (milestone) {
        this.feed(`CITY METER: ${milestone} unlocked!`, 'milestone');
        this.meterDirty = false;
        this.out.send({ t: 'meter', meter: this.economy.meterState(this.room.id), reached: milestone });
      }
    }
  }

  private credit(user: User, amount: number, x: number): void {
    if (amount <= 0) return;
    this.economy.credit(user, amount, true);
    user.career.biggestWin = Math.max(user.career.biggestWin, amount);
    this.economy.touched(user);
    this.out.send({ t: 'score', at: this.sim.time, name: user.name, color: user.color, ...(user.nameFx ? { fx: user.nameFx } : {}), amount, balance: user.balance, x });
    this.boardDirty = true;
  }

  private feed(text: string, tone: FeedTone, user?: User): void {
    const item: FeedItem = { id: this.feedId++, text, tone, color: user?.color, platform: user?.platform };
    if (user?.nameFx) item.fx = user.nameFx;
    this.feedLog.push(item);
    if (this.feedLog.length > FEED_KEPT) this.feedLog.shift();
    this.out.send({ t: 'feed', item });
  }

  // --- The quest ---

  /** Whether a ball is in play: the quest's clock runs only then (questClock), and stands still between balls. */
  private get inPlay(): boolean {
    return this.balls.size > 0;
  }

  /**
   * The quest as the state carries it (Quest.view): a mode's time left as at the table's time now, and whether its
   * clock runs. A stage counts the time down from there while it runs, so the state is sent again only when something
   * else changes (followQuest), never for the clock alone: a ball launched or drained sends it anyway.
   */
  private questState(): PinballState['quest'] {
    const { done, mode, finale } = this.quest.view();
    return {
      done,
      mode: mode && { god: mode.god, left: mode.left, at: this.sim.time, running: this.inPlay, progress: mode.progress, goal: mode.goal },
      finale,
    };
  }

  /**
   * The quest's clock, once a step and after the step's hits, so that a goal hit in the step its time runs out still
   * wins (Quest.event, then Quest.tick). What it says has no ball of its own (a mode run out, a finale's toy back up, a
   * saved finale begun), so any points in it go to nobody, as a house ball's do.
   */
  private questClock(): void {
    this.followQuest(this.quest.tick(DT, this.inPlay), null);
  }

  /** Something the quest hears of, by ball `ball` (on the table, at its hit): what it says is done for that ball. */
  private questEvent(e: QuestEvent, ball: number): void {
    this.followQuest(this.quest.event(e), ball);
  }

  /**
   * Does what the quest says (QuestOut), in order, for the ball whose event it was, or for none (null): its points go
   * to that ball as they are, since double score doubles the table's own parts and not the quest's set prizes, or to
   * nobody; a toy is moved (setToy) or one part raised (raisePart), each waiting for a ball in its way; the finale's
   * multiball starts unless multiball is on already, when it brings no more balls; and each cue goes to the stages.
   * What it says can change what the state shows (its mode and progress, the gods done, the finale), so the state is
   * sent with it. A quest that says nothing has changed nothing the stages need: its clock counts down, and they count
   * it down themselves (questState).
   */
  private followQuest(outs: QuestOut[], ball: number | null): void {
    if (outs.length === 0) return;
    const b = ball === null ? undefined : this.balls.get(ball);
    for (const out of outs) {
      switch (out.kind) {
        case 'points':
          if (b) this.score(b, out.points);
          break;
        case 'toy':
          this.setToy(out.toy, out.up, out.except);
          // The Mummy Wakes or the finale asking for the mummy while chat's summon has it up takes it over: the summon
          // ends unpaid, and the mummy's hits start again from none (setToy keeps them for a mummy up already), so the
          // mode can still be won.
          if (out.toy === 'mummy' && out.up && this.summonUntil !== null) {
            this.summonUntil = null;
            this.mummyHits = 0;
          }
          break;
        case 'raise':
          this.raisePart(out.part);
          break;
        case 'multiball':
          if (!this.multiball) this.startMultiball(null);
          break;
        case 'cue':
          this.questCue(out.cue, ball);
          break;
      }
    }
    this.stateDirty = true;
  }

  /**
   * A quest moment to the stages (PinballCueMsg), at the table's time: a goal and a jackpot where the ball whose event
   * it was is, as a toy hit is. Only an event's outs hold either, and an event's ball is on the table (the physics
   * reports a hit only for a ball it still has); the quest's clock and multiball's end, which have no ball, say
   * neither. Like a hype moment, a cue goes to every client and never in hello: a stage that opens later draws what
   * runs from the state.
   */
  private questCue(cue: QuestCue, ball: number | null): void {
    const at = this.sim.time;
    if (cue.cue === 'goal' || cue.cue === 'jackpot') {
      const p = ball === null ? undefined : this.sim.items.get(ball)?.body.translation();
      if (!p) return;
      this.out.send({ t: 'machine', msg: { kind: 'pinballCue', ...cue, x: p.x, z: p.z, at } satisfies PinballCueMsg });
      return;
    }
    this.out.send({ t: 'machine', msg: { kind: 'pinballCue', ...cue, at } satisfies PinballCueMsg });
  }

  /**
   * A ball passed a switch, either way (the physics reports one a pass), and the ball's velocity says which way: an
   * orbit or a ramp shot for the quest, or nothing. A pass up an orbit lane is kept, and the shot counts when the ball
   * comes down past the other lane's switch within ORBIT_ROUND, round the orbit. The dish's switch counts a ball going
   * up the table only, since every ball that gets into the dish comes back down past it; the gate's counts either way,
   * since none comes back in through the gap, and some the gate turns out are heading down the table as they meet it.
   */
  private switchPassed(id: string, ball: number): void {
    const up = this.sim.items.get(ball)!.body.linvel().z > 0;
    if (id === GATE_SWITCH || (id === DISH_SWITCH && up)) {
      this.questEvent({ kind: 'ramp' }, ball);
      return;
    }
    if (!ORBIT_SWITCHES.some((s) => s === id)) return;
    if (up) {
      this.orbitUp.set(ball, { id, at: this.sim.time });
      return;
    }
    const pass = this.orbitUp.get(ball);
    if (!pass || pass.id === id || this.sim.time - pass.at > ORBIT_ROUND) return;
    this.orbitUp.delete(ball);
    this.questEvent({ kind: 'orbit' }, ball);
  }

  // --- For the tests ---

  /** Test hook: points added to a ball on the table. */
  addPoints(ball: number, points: number): void {
    const b = this.balls.get(ball);
    if (b) this.score(b, points);
  }

  /** Test hook: each of the lock's drop targets hit by this ball, through the hits' own path (so the lock lights). */
  knockAllTargets(ball: number): void {
    for (const t of this.table.targets) if (isLockTarget(t)) this.hit({ kind: 'target', id: t.id, ball });
  }

  /** How many viewers have flipped this ball (each once). */
  flipperCount(ball: number): number {
    return this.balls.get(ball)?.flippers.size ?? 0;
  }
}

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}
