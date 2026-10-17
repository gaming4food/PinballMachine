// What the pinball's server, stage and panel all read (so far, only the state the server sends; the table and the rules
// come in later tasks).

/** The pinball's state as its server sends it, in hello's `machine` and each 'machine' message. */
export interface PinballState {
  phase: 'idle' | 'launching' | 'playing';
  /** The balls on the table: whose each is (null for a house ball), their names and what each has scored. */
  balls: { owner: number | null; name: string | null; score: number }[];
  /** The balls still in the line, in order. */
  line: { userId: number; name: string }[];
  multiball: boolean;
  /** When double score ends, on the table's clock (null when it isn't on). */
  doubleUntil: number | null;
  /** When the ball saver ends, on the table's clock (null when it isn't on). */
  saverUntil: number | null;
  lockLit: boolean;
  lastResult: { name: string; points: number; coins: number } | null;
  /** The ids of the hype buttons whose effect waits (the panel marks them Ready). Empty when none wait. */
  waiting: string[];
}

/** The pinball's own message to the panel and the stage. */
export interface PinballMsg {
  kind: 'pinball';
  state: PinballState;
}

/** The state in a message from the pinball, or null for any other message (or one without a valid state). */
export function pinballStateOf(msg: unknown): PinballState | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as { kind?: unknown; state?: unknown };
  if (m.kind !== 'pinball' || typeof m.state !== 'object' || m.state === null) return null;
  return m.state as PinballState;
}

/** How a hype moment names the viewer who bought it, or whose support set it off. */
export interface HypeBuyer {
  name: string;
  color: number;
}

/**
 * A hype button's moment, the pinball's other message to its stages: its title and flash, as it happens. Never part of
 * hello. `by` names who bought it from chat, or whose support set it off; the streamer's own press has none.
 */
export interface PinballHypeMsg {
  kind: 'pinballHype';
  id: string;
  at: number;
  by?: HypeBuyer;
}

/** A hype moment from a machine's message, or null when it's anything else (a page older than its server ignores it). */
export function pinballHypeOf(msg: unknown): PinballHypeMsg | null {
  const m = msg as Partial<PinballHypeMsg> | null;
  return m?.kind === 'pinballHype' && typeof m.id === 'string' && typeof m.at === 'number' ? (m as PinballHypeMsg) : null;
}

/** The rules of play. Times are in seconds. */
export const RULES = {
  /** A ball that drains within this many seconds of launch is given back (the ball saver). */
  autoSaveAfter: 3,
  /** How long a flip from chat is held, in seconds. */
  flipHold: 0.25,
  /** How long the ball saver stays on after a launch, in seconds. */
  ballSaverStart: 5,
  /** How long the Ball Saver hype button's saver lasts, in seconds. */
  saverHype: 15,
  /** How long the Double Score hype button's double lasts, in seconds. */
  doubleHype: 30,
  /** The most extra balls a player can hold. */
  maxExtraBalls: 2,
  /** Points that make one coin, for a ball's result. */
  pointsPerCoin: 1000,
  /** The share of a result's coins that goes to the machine's owner. */
  ownerShare: 0.7,
  /** A ball that has not moved this many seconds is stuck, and is nudged free. */
  stuckSeconds: 4,
  /** The pause between a ball joining and its launch, in seconds. */
  launchDelay: 2,
} as const;

/** What a chat message asks of the pinball: to join the line, and how many left and right flips. */
export interface PinballCommands {
  join: boolean;
  left: number;
  right: number;
}

/**
 * Reads a chat message as pinball commands. Words are split on whitespace and matched in any case, with or without a
 * leading "!": "ball" joins the line; "left" or "l" is a left flip and "right" or "r" a right flip, each word counting
 * once. Any other word is ignored ("balloon" and "leftover" are nothing).
 */
export function parsePinballCommands(text: string): PinballCommands {
  const out: PinballCommands = { join: false, left: 0, right: 0 };
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const w = raw.replace(/^!/, '');
    if (w === 'ball') out.join = true;
    else if (w === 'left' || w === 'l') out.left++;
    else if (w === 'right' || w === 'r') out.right++;
  }
  return out;
}

/** The snapshot type byte for the pinball. */
export const SNAP_TYPE_PINBALL = 4;
/** The snapshot header's size in bytes: 1 + 8 + 2 + 4 + 4 + 4 + 1 + 4. */
export const SNAP_PINBALL_HEADER = 28;
/*
 * A pinball snapshot is a header, then `count` bodies as the coin pusher's (the balls, each with `owner`). The header:
 * [u8 type][f64 simTime][u16 count][f32 left flipper angle][f32 right flipper angle][u32 lit inserts][u8 targets down][f32 spinner angle]
 */

/** The bits of the header's lit inserts. */
export const LIT = {
  lock: 1 << 0,
  kickback: 1 << 1,
  rollover0: 1 << 2,
  rollover1: 1 << 3,
  rollover2: 1 << 4,
  double: 1 << 5,
  saver: 1 << 6,
} as const;
