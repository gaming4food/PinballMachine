// What the pinball's server, stage and panel all read: the state the server sends and its hype moments, the rules of
// play (RULES), chat's words, and the snapshot's layout. The table itself is table.ts.

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
  /** With no flip word from chat for this many seconds, the auto-save takes the flippers (till chat's next flip). */
  autoSaveAfter: 3,
  /** How long a flip from chat is held, in seconds. */
  flipHold: 0.25,
  /** How long the ball saver stays on after a ball's first launch, in seconds: a ball that drains sooner is given back. */
  ballSaverStart: 5,
  /** How long the Ball Saver hype button's saver lasts, in seconds. */
  saverHype: 15,
  /** How long the Double Score hype button's double lasts, in seconds. */
  doubleHype: 30,
  /** How many more balls multiball brings onto the table (from the line, then the house's). */
  maxExtraBalls: 2,
  /**
   * Points that make one coin, for a ball's result. Tuned with `npm run pinball-play` (300 unattended balls, seed 1,
   * only the auto-save playing). The stand-in table, at 150 points a coin, paid 8.8 coins a ball (average 1,384 points,
   * 14.5 s). The pyramid's balls average 8,087 points (median 7,155, 13.6 s), so 870 points a coin pays the same, 8.8
   * coins a ball (9.2 on seeds 2 and 3), 2026-10-18. (On the first pyramid layout, with the drop targets behind the
   * pyramid and the sun bumper above the right sling, they averaged 8,670 points, and 900 points a coin paid 9.1.)
   */
  pointsPerCoin: 870,
  /** The share of a result's coins that goes to the machine's owner. */
  ownerShare: 0.7,
  /**
   * A ball that has not moved this many seconds is stuck, and the table is nudged; one still stuck after 3 nudges goes
   * back to the plunger lane and is launched again.
   */
  stuckSeconds: 4,
  /** The pause between the line's next ball being up ("Ana is up!") and its launch, in seconds. */
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
/** The snapshot header's size in bytes: 1 + 8 + 2 + 3 * 4 + 4 + 4 + 4 + 2 * 4 + 4. */
export const SNAP_PINBALL_HEADER = 47;
/*
 * A pinball snapshot is a header, then `count` bodies as the coin pusher's (the balls, each with `owner`). The header:
 * [u8 type][f64 simTime][u16 count][f32 x3 flipper angles, degrees, in table order][u32 lit inserts][u32 targets down]
 * [u32 targets turned][f32 main spinner angle, radians][f32 right spinner angle, radians][u32 toys]
 * The toys word, at byte 43, is the toys' bits (TOY below). The rising targets (the pop-ups and the mummy) are not in
 * it: they are in the targets down, a bit each, set while they stand down.
 */

/**
 * The toys' bits, as the physics gives them (PinballSim.toys()) and the header's last word carries them: the tomb open,
 * and the diverter's gate set over (its goal: it swings there, and back, at 400 degrees a second, so a stage can swing
 * it as the physics does).
 */
export const TOY = { tombOpen: 1 << 0, diverterOver: 1 << 1 } as const;

/** The bits of the header's lit inserts. */
export const LIT = {
  lock: 1 << 0,
  kickback: 1 << 1,
  rollover0: 1 << 2,
  rollover1: 1 << 3,
  rollover2: 1 << 4,
  double: 1 << 5,
  saver: 1 << 6,
  centre0: 1 << 7,
  centre1: 1 << 8,
  centre2: 1 << 9,
  centre3: 1 << 10,
} as const;
