// A machine's hype buttons as data, and the action a press sends it (docs/MACHINE_REPOS.md section 2). No DOM in here:
// a machine's game imports it from @kit/server to read a press, and its entry (MachineEntryText.hype) lists them.

/**
 * A hype button put up for sale: chat buys a press of it with coins (src/server/chat-hype.ts), and the machine is
 * handed the purchase (Machine.buyHype). The streamer's own press stays free.
 */
export interface HypeSale {
  /** What viewers type, without the `!`: lowercase letters only. The first is the one shown (captions, How to Play). */
  words: readonly string[];
  /** How replies and How to Play name it: "an extra finger". */
  what: string;
  /** Its price to start with, in coins. Each streamer can change it, inside the owner's limits. */
  price: number;
  /** The owner's starting limits on the price, in coins. The owner can change them. */
  limits: { min: number; max: number };
}

/**
 * One of a machine's hype buttons in the control panel. It's pressed from the panel for free, and bought from chat when
 * it has a sale (src/server/chat-hype.ts).
 */
export interface HypeButton {
  /** What the machine reads in a press (hypeId): short, and the same from one release to the next. */
  id: string;
  /** The button's name. */
  label: string;
  /** One symbol, drawn before the name. */
  icon: string;
  /** What a press does, in a line: the button's tooltip. */
  hint: string;
  /** Puts it up for sale in chat. Without one, only the panel presses it. */
  sale?: HypeSale;
}

/** What a press sends the machine, as a 'machine.action'. */
export interface HypeAction {
  kind: 'hype';
  id: string;
}

export const hypeAction = (id: string): HypeAction => ({ kind: 'hype', id });

/**
 * The id of a hype action, or null for anything else. A machine's action() gets whatever a socket sends, so it reads a
 * press with this and ignores an id it doesn't know.
 */
export function hypeId(action: unknown): string | null {
  if (typeof action !== 'object' || action === null) return null;
  const { kind, id } = action as { kind?: unknown; id?: unknown };
  return kind === 'hype' && typeof id === 'string' && id !== '' ? id : null;
}
