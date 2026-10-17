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
  /** The ids of the hype buttons whose effect waits (the panel marks them Ready). Always [] for now. */
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
