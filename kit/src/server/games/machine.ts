// What every machine does for its channel (docs/SPEEDWAY.md, part 1, 2026-10-09): the coin pusher, and each machine
// from machines/ (the claw and the Speedway today; Pinball and Plinko later). The channel (server/channel.ts) talks to
// each one only through this, and uses an optional extra only on the machines that have it, where it once asked "is
// this the coin pusher?". Each machine is made from its definition in server/rooms.ts. Tested by npm run machines-test.
import type { Prices } from '../../shared/prices';
import type { AlertInfo, BoardRow, FeedItem, FeedTone, RoomInfo, ServerMsg, StreamerDrop } from '../../shared/protocol';
import type { Economy, User } from '../economy';
import type { StreamEvent } from '../events';

/** Where a machine sends what its stages (and the control panel) should hear. */
export interface MachineOutlet {
  send(msg: ServerMsg): void;
}

/** Paid support's big card, before the server gives it an id and a voice (server/alerts.ts). The city builds it. */
export type AlertRequest = Omit<AlertInfo, 'id' | 'voice'>;

/** What making a machine takes: its room, the channel's wallet, where it sends things, its save file and the prices. */
export interface MachineDeps {
  room: RoomInfo;
  economy: Economy;
  out: MachineOutlet;
  saveFile: string;
  prices: () => Prices;
}

export type MakeMachine = (deps: MachineDeps) => Machine;

/**
 * A viewer's purchase of a hype button, as the city hands it to Machine.buyHype. Any coins are already taken: `paid` says
 * how many, and a free buy took none.
 */
export interface HypePurchase {
  /** The buyer. */
  readonly user: User;
  /**
   * The coins they paid. 0 for a free buy (the owner on their own channel, or a price of 0), when `refund()` has nothing
   * to give back.
   */
  readonly paid: number;
  /**
   * Gives the coins back, once. It returns true only when coins really went back: on the first call, for a buy that
   * took some, to a viewer the streamer hasn't removed since. Otherwise it does nothing and returns false: a later
   * call, a free buy, or a viewer removed meanwhile. The machine writes the feed line that says the coins came back,
   * and only when this returns true, so the line never tells of coins that didn't move.
   */
  refund(): boolean;
}

export interface Machine {
  readonly room: RoomInfo;
  /** Its physics: the step count, how many things it holds (the status line), and the snapshot its stages are sent. */
  readonly sim: { readonly tick: number; readonly items: { readonly size: number }; snapshot(): Buffer };
  /** Things still to come in (the status line's "waiting"). */
  readonly queued: number;
  /** How long its last physics step took, in milliseconds. */
  readonly stepMs: number;
  /** Where the stages load a viewer's profile picture, when there is one (see AvatarStore). */
  avatarUrl: (userId: number) => string | null;
  load(): void;
  save(): void;
  /** Everything a stage needs about the machine on (re)connecting. */
  hello(): ServerMsg;
  leaders(): ServerMsg;
  leaderboard(): BoardRow[];
  recentFeed(): FeedItem[];
  handle(ev: StreamEvent): void;
  /** One physics step (DT, games/physics.ts). */
  step(): void;
  /** Four times a second: its board, meter and state, when they changed. */
  publish(now: number): void;
  pruneLimits(): void;
  resetMachine(): void;
  resetMeter(): void;
  markBoardDirty(): void;
  avatarReady(userId: number, url: string): void;
  /** A line in this machine's live feed (the city's welcome, and its answers to its own commands). */
  announce(text: string, tone: FeedTone, user?: User): void;

  // Optional extras: the channel uses each one only on the machines that have it. A machine has an extra when it has
  // the member at all: a method, or a field declared with a value (null until the channel hooks it). One it hasn't got,
  // it leaves out entirely, so the channel can check with `in` and call with `?.`.
  /** Whether viewers can buy from the coin shop (the owner's rule on a hosted server; see server/rules.ts). */
  shopOpen?: () => boolean;
  /** The streamer's own drops: from its hype buttons, their chat, or a countdown reaching zero (a coin rain). */
  streamerDrop?(drop: StreamerDrop): boolean;
  /** Once a second while it runs: how busy its thread is (the claw's chains follow it). */
  noteBusy?(pct: number): void;
  /** Its panel card's buttons (a 'machine.action'): anything can arrive, so it checks what it gets. */
  action?(action: unknown): void;
  /** What a panel that connects gets of it, as a 'machine' message (its card's state). */
  panelState?(): unknown;
  /**
   * Chat buys a press of one of its hype buttons (HypeButton.sale), and any coins are already taken (a free buy took
   * none). It does what the panel's press of button `id` does, for that viewer. It returns null when done, or why not:
   * lowercase, with no full stop ("the pit is full"). The city then gives any coins back and writes the reason after the
   * viewer's name. A press that has to wait can still be given up on later: `purchase.refund()` gives the coins back, and
   * says whether it did.
   */
  buyHype?(id: string, purchase: HypePurchase): string | null;
  /**
   * The effect line on this machine's card for paid support ("GIANT COIN!"): what the sub or gift sets off here, `tier` 1
   * to 4 for a gift's size (a sub is tier 2). Null for none. The city builds the card; the machine only names its effect.
   */
  supportEffect?(support: { kind: 'sub' | 'gift'; tier: number }): string | null;
}
