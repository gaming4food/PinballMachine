// What the pinball's server, stage and panel all read: the state the server sends (the quest's in it), its hype
// moments and its cues (the toys' hits and the quest's moments), the rules of play (RULES), the quest's gods and
// numbers (QUEST), chat's words, and the snapshot's layout. The table itself is table.ts.

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
  /**
   * The Pharaoh's quest (server/quest.ts): the gods crossed off, in the quest's order; the god's mode that runs, if one
   * does, with its seconds of play `left` at the table's time `at`, whether its clock is `running` (while a ball is in
   * play: a stage counts `left` down from `at` while it is, and holds it while not), and `progress` of its `goal` hits;
   * and the finale, while it runs, with what its next jackpot pays. A finale a restart saved is null until a ball is in
   * play and it begins again.
   */
  quest: {
    done: God[];
    mode: { god: God; left: number; at: number; running: boolean; progress: number; goal: number } | null;
    finale: { jackpot: number } | null;
  };
}

/** The pinball's own message to the panel and the stage. */
export interface PinballMsg {
  kind: 'pinball';
  state: PinballState;
}

/**
 * The state in a message from the pinball, or null for any other message (or one without a valid state). A state whose
 * quest is missing or isn't an object is given the empty quest, so that every reader of the state can take its quest as
 * there.
 */
export function pinballStateOf(msg: unknown): PinballState | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as { kind?: unknown; state?: unknown };
  if (m.kind !== 'pinball' || typeof m.state !== 'object' || m.state === null) return null;
  const state = m.state as PinballState;
  // The server and the stage ship together, but a page can meet an older server for a moment (a stage rebuilt while the
  // server it talks to still runs the last version), and the states of one from before the quest have none. They get
  // the empty quest on a shallow copy, so the message is left as it came and the usual path makes nothing.
  const quest: unknown = state.quest;
  if (typeof quest === 'object' && quest !== null) return state;
  return { ...state, quest: { done: [], mode: null, finale: null } };
}

/** How a hype moment names the viewer who bought it, or whose support set it off. */
export interface HypeBuyer {
  name: string;
  color: number;
}

/**
 * A hype button's moment, the pinball's second message to its stages: its title and flash, as it happens. Never part of
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

/**
 * A moment on the table: the pinball's third message to its stages, sent as it happens (never in hello), at `at` on the
 * table's clock. Its `cue` says which, each kind with what it needs:
 * - `toyHit`: a toy hit. A fast ball can touch a toy and be away again between two snapshots, so the server says each
 *   hit instead of leaving the stage to guess it from where it draws the balls.
 * - The quest's moments (server/quest.ts): a god's mode started (`modeStart`), each goal hit of it (`goal`), the mode
 *   won with the `prize` it paid (`modeWon`) or lost (`modeLost`); a jackpot with the `value` it paid (`jackpot`); and
 *   the finale begun (`finale`) and over (`finaleEnd`). A goal and a jackpot are at the ball's place, as a toy hit is.
 */
export type PinballCueMsg = {
  kind: 'pinballCue';
  /** When it happened, on the table's clock. */
  at: number;
} & (
  | {
      cue: 'toyHit';
      /** The id of the rising target hit (a pop-up or the mummy), or of the tomb. */
      part: string;
      /**
       * Whether the hit put the part down: true for a pop-up's hit and for the mummy's third hit since it rose (the
       * game's MUMMY_HITS). False for the mummy's other hits, including one after the third in the same step, and for
       * the tomb's.
       */
      down: boolean;
      /** Where the ball was at the hit, in the table's x and z (for the tomb's, where the tomb holds it). */
      x: number;
      z: number;
    }
  | { cue: 'modeStart'; god: God }
  | { cue: 'goal'; god: God; x: number; z: number }
  | { cue: 'modeWon'; god: God; prize: number }
  | { cue: 'modeLost'; god: God }
  | { cue: 'jackpot'; value: number; x: number; z: number }
  | { cue: 'finale' }
  | { cue: 'finaleEnd' }
);

/** A toy hit's cue: what the stage's sounds and its toys' shows play. */
export type PinballToyHit = Extract<PinballCueMsg, { cue: 'toyHit' }>;

/** Whether each of these fields of `m` is a finite number. */
const finite = (m: Record<string, unknown>, ...keys: string[]) => keys.every((key) => Number.isFinite(m[key]));
/**
 * What each kind of cue must have besides its kind and time (pinballCueOf). Keyed by every kind, so a kind the cue
 * gains is a type error here until it is checked.
 */
const CUE_FIELDS: Record<PinballCueMsg['cue'], (m: Record<string, unknown>) => boolean> = {
  toyHit: (m) => typeof m.part === 'string' && typeof m.down === 'boolean' && finite(m, 'x', 'z'),
  modeStart: (m) => isGod(m.god),
  goal: (m) => isGod(m.god) && finite(m, 'x', 'z'),
  modeWon: (m) => isGod(m.god) && finite(m, 'prize'),
  modeLost: (m) => isGod(m.god),
  jackpot: (m) => finite(m, 'value', 'x', 'z'),
  finale: () => true,
  finaleEnd: () => true,
};

/**
 * A cue from a machine's message, or null when it's anything else, a cue of a kind this page doesn't know (a page older
 * than its server ignores it), or one without its kind's own fields: a god that is one of GODS, numbers that are
 * finite, a part that is a string and `down` a yes or a no.
 */
export function pinballCueOf(msg: unknown): PinballCueMsg | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.kind !== 'pinballCue' || !Number.isFinite(m.at) || typeof m.cue !== 'string') return null;
  // Its own properties only: a cue named like one of Object's (toString) is no kind of cue.
  if (!Object.hasOwn(CUE_FIELDS, m.cue)) return null;
  return CUE_FIELDS[m.cue as PinballCueMsg['cue']](m) ? (m as unknown as PinballCueMsg) : null;
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

/** The quest's four gods. Each has a bank of plaques on the table, a mode, and a toy that mode is played on. */
export type God = 'ra' | 'horus' | 'ankh' | 'eye';

/** The gods in the quest's order: the order they are crossed off in, and the order a match looks for the next god. */
export const GODS: readonly God[] = ['ra', 'horus', 'ankh', 'eye'];

/** Whether `x` is one of the gods, for what comes in from outside (a save file, the dev host's action): by value. */
export function isGod(x: unknown): x is God {
  return GODS.some((god) => god === x);
}

/**
 * Each god's colour in the quest: its bank's burst and flash when it is matched, and the burst at its toy (Horus's
 * pop-ups, Ankh's mummy, the Eye's tomb), as the lamps at the toys wear it (pinball-parts.ts).
 */
export const GOD_COLOR: Record<God, number> = { ra: 0xffc23a, horus: 0x4a7dff, ankh: 0x39ff6a, eye: 0xff3344 };

/** The name of each god's mode, as the scoreboard titles it. */
export const MODE_NAME: Record<God, string> = {
  ra: 'SUN CHASE',
  horus: 'FALCON STRIKE',
  ankh: 'THE MUMMY WAKES',
  eye: 'TOMB RAID',
};

/**
 * The quest's numbers, in seconds and points; the rules are server/quest.ts. They are starting points, tuned with
 * `npm run pinball-play` and the owner, so the tests read them from here instead of repeating them.
 */
export const QUEST = {
  /** How long a mode runs, in seconds of play: its clock runs only while a ball is in play. */
  modeSeconds: 30,
  /**
   * What each goal hit scores, the one that finishes the mode too. In the finale it is what a pop-up knocked down and
   * each hit on the mummy score, as in their modes.
   */
  goalPoints: 2500,
  /** What a finished mode pays the ball that finishes it. Tomb Raid pays its countdown instead (tombPrize). */
  prize: 25000,
  /** Tomb Raid's prize counts down over its mode: `from` with all its time left, `to` with none. */
  tombPrize: { from: 50000, to: 10000 },
  /**
   * How many goal hits finish each god's mode: Ra's orbit and ramp shots, Horus's different pop-ups, Ankh's mummy hits
   * and the Eye's tomb catches. Horus's can't be more than the table's three pop-ups, nor Ankh's more than the mummy's
   * hits before it goes down (the game's MUMMY_HITS, 3): the mode could never be finished.
   */
  goals: { ra: 3, horus: 3, ankh: 3, eye: 1 },
  /** The finale's jackpots: the first ball the tomb catches pays `first`, and each after it `step` more than before. */
  jackpot: { first: 50000, step: 25000 },
  /** In the finale, a pop-up or the mummy that goes down comes back up this many seconds of play later. */
  finaleRaise: 3,
};

/**
 * Tomb Raid's prize with `left` seconds of its mode to go: QUEST.tombPrize.from with all the time left, falling evenly
 * to QUEST.tombPrize.to with none, to the nearest 1,000. It depends on the time left alone, so the scoreboard can count
 * it down and show what the winning ball would be paid.
 */
export function tombPrize(left: number): number {
  const { from, to } = QUEST.tombPrize;
  const timeLeft = Math.min(1, Math.max(0, left / QUEST.modeSeconds));
  return Math.round((to + (from - to) * timeLeft) / 1000) * 1000;
}

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
 * and the diverter's gate set over (its goal: it swings there, and back, at DIVERTER_SPEED, so a stage can swing it as
 * the physics does).
 */
export const TOY = { tombOpen: 1 << 0, diverterOver: 1 << 1 } as const;

/**
 * How fast the diverter's gate swings, degrees per second: slowly, as a gate does, where a flipper swings at the
 * physics' FLIPPER_SPEED (server/sim.ts). A ball it meets on its way is pushed aside at the gate's own speed, never
 * batted. The physics swings the gate at it, and the stage its drawn gate (stage/pinball-parts.ts).
 */
export const DIVERTER_SPEED = 400;

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
