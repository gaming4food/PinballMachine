// The pinball game on the server (Task 4 of the pinball plan): viewers line their balls up with `ball`, and each
// launches when the table is free; all of chat flips with `left` and `right`, and when chat goes quiet the auto-save
// flips for it (missing now and then). The table's parts score, all 4 drop targets light the lock, a ball in the lit
// lock starts multiball (more balls from the line, then the house's), all 3 top rollovers light the kickback, the ball
// saver gives a quick drain back, a stuck ball gets a nudge, and one no nudge frees goes back to the plunger lane. A
// drained ball pays: its points make coins, 70% to its owner and the rest shared by everyone who flipped it (the owner
// too, if they flipped).
//
// The physics is sim.ts; this is the rules. Every timer here runs on the table's clock (sim.time), never Date.now():
// the city and the stand-in host stop stepping the machine while no stage shows it (runsUnseen: false), and the ball,
// its saver and the auto-save all wait with it. The one wall-clock check is whether the table is running at all, for
// chat's flip words (chatFlip).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { BodyState, FeedItem, FeedTone, Platform, RoomInfo, ServerMsg } from '@kit/shared';
import { type Economy, hypeId, type HypePurchase, log, type Machine, type MachineOutlet, type StreamEvent, type User } from '@kit/server';
import { type HypeBuyer, LIT, parsePinballCommands, type PinballHypeMsg, type PinballMsg, type PinballState, RULES } from '../shared/pinball';
import { TABLE_IN_USE, TABLE, type Table } from '../shared/table';
import { PinballSim, type Hit } from './sim';

/** How many high scores are kept. */
const HIGH_SCORES = 10;
/** How many lines of the feed a stage that connects is sent. */
const FEED_KEPT = 12;
/** The auto-save misses 1 flip in this many. */
const AUTO_MISS = 6;
/** After an auto-save flip, the flipper is left down this long before the next, so it can drop and swing again. */
const AUTO_REST = 0.15;
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
};
/** A press's line for the streamer (its first), and what follows the buyer's name in a bought one (its second). */
const NEWS: Record<string, readonly [string, string]> = {
  multiball: ['Multiball!', '2 more balls are coming.'],
  saver: ['Ball saver!', 'No ball can drain for 15 seconds.'],
  double: ['Double score!', 'Every point counts twice for 30 seconds.'],
  nudge: ['Nudge!', 'The table jolts.'],
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

/** What save() writes. */
interface SavedPinball {
  highScores: { name: string; points: number }[];
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
  /** The drop targets down and the top rollovers lit since the lock or the kickback last lit, by id. */
  private readonly targetsHit = new Set<string>();
  private readonly rolloversLit = new Set<string>();
  /** The centre lane's lamps lit, by rollover id (centre-1 to centre-4). */
  private readonly centreLit = new Set<string>();
  /** Double score and the bought ball saver run until these, on the table's clock (-Infinity: off). */
  private doubleUntil = -Infinity;
  private saverUntil = -Infinity;
  /** When chat's last flip word came, and till when each flipper is held up for chat and for the auto-save. */
  private lastWord = -Infinity;
  private readonly chatUp = { left: -Infinity, right: -Infinity };
  private readonly autoUp = { left: -Infinity, right: -Infinity };
  /** The auto-save's next flip on each side waits till this (its rest after a flip, or after a miss). */
  private readonly autoNext = { left: -Infinity, right: -Infinity };
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
    } catch (err) {
      log.warn('pinball: could not read the saved high scores; starting with none', err);
    }
  }

  save(): void {
    const tmp = `${this.saveFile}.tmp`;
    const saved: SavedPinball = { highScores: this.scores };
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
   * the streamer likes (press). Anything can arrive, so anything else, a hype button this table hasn't got among it, is
   * ignored.
   */
  action(action: unknown): void {
    const hype = hypeId(action);
    if (hype !== null) {
      this.press(hype);
      return;
    }
    const a = action as { kind?: unknown; userId?: unknown } | null;
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
    this.rolloversLit.clear();
    this.centreLit.clear();
    this.sim.resetTargets();
    // Bought hype must not outlive the reset: the saver and double score, and a saver still waiting, whose buyer gets
    // their coins back (refund) when the city says so.
    this.saverUntil = this.doubleUntil = -Infinity;
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
    if (cmd.left) this.chatFlip('left', user);
    if (cmd.right) this.chatFlip('right', user);
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
      default:
        return "that hype isn't for sale";
    }
    this.stateDirty = true;
    return null;
  }

  /** A press that does nothing, and why: the streamer's says so in the feed (`line`); a bought one is told `reason` instead. */
  private refuse(purchase: HypePurchase | undefined, reason: string, line: string): string {
    if (!purchase) this.feed(line, 'info');
    return reason;
  }

  /**
   * A press's line in the feed: the streamer's own, or one that leads with the buyer and what they bought (BOUGHT), in
   * their colour: "Ben bought a nudge! The table jolts." A supporter's line thanks them instead. `news` replaces what follows.
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

  // --- Stepping ---

  step(): void {
    const t0 = performance.now();
    this.lastStepWall = Date.now();
    this.launches();
    this.autoSave();
    this.setFlippers();
    this.sim.step();
    this.watchStuck();
    this.lastStepMs = performance.now() - t0;
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
   * after STUCK_NUDGES nudges is never left there: it's taken off and launched again up the plunger lane (unstick).
   */
  private watchStuck(): void {
    const now = this.sim.time;
    const stuck: number[] = [];
    for (const [id, b] of this.balls) {
      const ball = this.sim.items.get(id);
      if (!ball) continue;
      const p = ball.body.translation();
      b.x = p.x;
      if (id === this.heldBall || this.sim.heldBy(id) === 'saucer' || Math.hypot(p.x - b.anchor.x, p.z - b.anchor.z) > TABLE.ballRadius) {
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
        // Only the drop targets count toward the lock; the flip plaques have their banks.
        const drops = this.table.targets.filter((t) => !t.flip);
        if (!drops.some((t) => t.id === hit.id)) break;
        this.targetsHit.add(hit.id);
        if (drops.every((t) => this.targetsHit.has(t.id))) {
          // The drop targets come back up for the next time round; the lock stays lit till a ball goes in.
          this.targetsHit.clear();
          this.sim.resetDropTargets();
          if (!this.lockLit) {
            this.lockLit = true;
            this.feed('Lock lit!', 'milestone');
          }
        }
        break;
      }
      case 'bank':
        this.bankMatched(b, hit.id, points);
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
    }
    this.stateDirty = true;
  }

  /** A bank's plaques all show their backs: its title to the stages, and a line in the feed with the bonus scored. */
  private bankMatched(b: BallPlay, id: string, paid: number): void {
    const name = id.replace(/^bank-/, '');
    this.moment(id);
    const who = b.owner ? b.owner.name : 'The house ball';
    this.feed(`${who} matched the ${name.charAt(0).toUpperCase()}${name.slice(1)} bank! +${paid.toLocaleString('en-US')}`, 'win', b.owner ?? undefined);
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
    if (this.heldBall === null && this.extraBalls.length === 0 && this.balls.size <= 1) this.multiball = false;
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

  // --- For the tests ---

  /** Test hook: points added to a ball on the table. */
  addPoints(ball: number, points: number): void {
    const b = this.balls.get(ball);
    if (b) this.score(b, points);
  }

  /** Test hook: every drop target hit by this ball, through the hits' own path (so the lock lights). */
  knockAllTargets(ball: number): void {
    for (const t of this.table.targets) if (!t.flip) this.hit({ kind: 'target', id: t.id, ball });
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
