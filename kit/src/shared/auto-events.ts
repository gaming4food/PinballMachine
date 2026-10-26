// Auto events (issue #6): a machine's hype buttons going off by themselves while it's on stream, so a streamer who's
// busy playing still gets the big moments. Two kinds, set for each machine in the control panel's Auto events card:
// - random: one of the buttons the streamer ticked, about every N minutes (anywhere from half to one and a half
//   times that, so chat can't set a watch by it);
// - timed: a button every N minutes exactly (up to AUTO_MAX_TIMERS of them).
// Each goes off as if its button were pressed in the panel, so it's free and pays whoever dropped last, like any
// streamer drop. The server runs them (src/server/auto-events.ts), so they keep going with the panel closed. This
// file is what both sides agree on: the settings, how they're cleaned, and the random gap.
// Tested by npm run auto-events-test.

/** The shortest and longest gap a streamer can set, in minutes. */
export const AUTO_MIN_MINUTES = 1;
export const AUTO_MAX_MINUTES = 240;
/** Timed events per machine. */
export const AUTO_MAX_TIMERS = 8;
/** What a new random event or timer starts at. */
export const AUTO_DEFAULT_MINUTES = 10;

export interface AutoTimer {
  /** The hype button's id (HypeButton.id in the machine's entry). */
  hype: string;
  everyMin: number;
  on: boolean;
}

export interface MachineAutoEvents {
  random: { on: boolean; everyMin: number; hype: string[] };
  timers: AutoTimer[];
}

/** Each machine's auto events, by room id. A machine missing has none. */
export type AutoEvents = Record<string, MachineAutoEvents>;

/** When each will next go off (ms since 1970), or null when it won't: off, or its machine isn't on stream. */
export interface AutoNext {
  random: { at: number; hype: string } | null;
  timers: (number | null)[];
}

export interface AutoEventsState {
  events: AutoEvents;
  next: Record<string, AutoNext>;
}

export const noAutoEvents = (): MachineAutoEvents => ({ random: { on: false, everyMin: AUTO_DEFAULT_MINUTES, hype: [] }, timers: [] });

/** A gap in whole minutes, within the limits; the default when it isn't a number. */
export function cleanMinutes(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return AUTO_DEFAULT_MINUTES;
  return Math.min(AUTO_MAX_MINUTES, Math.max(AUTO_MIN_MINUTES, n));
}

/**
 * One machine's auto events as they may be saved: only its own buttons (`hypeIds`), each ticked once, gaps within the
 * limits, at most AUTO_MAX_TIMERS timers. Anything else, from an old file or a panel, is dropped.
 */
export function cleanMachineAutoEvents(input: unknown, hypeIds: readonly string[]): MachineAutoEvents {
  const known = new Set(hypeIds);
  const raw = (input && typeof input === 'object' ? input : {}) as { random?: unknown; timers?: unknown };
  const random = (raw.random && typeof raw.random === 'object' ? raw.random : {}) as { on?: unknown; everyMin?: unknown; hype?: unknown };
  const picked = Array.isArray(random.hype) ? random.hype.filter((id): id is string => typeof id === 'string' && known.has(id)) : [];
  const timers = Array.isArray(raw.timers) ? raw.timers : [];
  return {
    random: { on: random.on === true, everyMin: cleanMinutes(random.everyMin ?? AUTO_DEFAULT_MINUTES), hype: [...new Set(picked)] },
    timers: timers
      .map((t) => (t && typeof t === 'object' ? (t as { hype?: unknown; everyMin?: unknown; on?: unknown }) : {}))
      .filter((t): t is { hype: string; everyMin?: unknown; on?: unknown } => typeof t.hype === 'string' && known.has(t.hype))
      .slice(0, AUTO_MAX_TIMERS)
      .map((t) => ({ hype: t.hype, everyMin: cleanMinutes(t.everyMin ?? AUTO_DEFAULT_MINUTES), on: t.on !== false })),
  };
}

/** Every machine's, as saved: only machines with hype buttons, and none left with nothing set. */
export function cleanAutoEvents(input: unknown, hypeIdsOf: (room: string) => readonly string[]): AutoEvents {
  const out: AutoEvents = {};
  if (!input || typeof input !== 'object') return out;
  for (const [room, events] of Object.entries(input as Record<string, unknown>)) {
    const ids = hypeIdsOf(room);
    if (!ids.length) continue;
    const clean = cleanMachineAutoEvents(events, ids);
    if (isEmpty(clean)) continue;
    out[room] = clean;
  }
  return out;
}

/** Nothing that would ever go off, and nothing to remember. */
export function isEmpty(events: MachineAutoEvents): boolean {
  return !events.random.on && !events.random.hype.length && events.random.everyMin === AUTO_DEFAULT_MINUTES && !events.timers.length;
}

/** Whether a machine's random events can go off: switched on, with at least one button ticked. */
export const randomArmed = (events: MachineAutoEvents): boolean => events.random.on && events.random.hype.length > 0;

/** The gap before the next random event: half to one and a half times the streamer's, `roll` being 0 to 1. */
export const randomGapMs = (everyMin: number, roll: number): number => Math.round(everyMin * 60_000 * (0.5 + Math.min(1, Math.max(0, roll))));

/** One of the ticked buttons, `roll` being 0 to 1. */
export const randomPick = (hype: readonly string[], roll: number): string => hype[Math.min(hype.length - 1, Math.floor(Math.max(0, roll) * hype.length))];
