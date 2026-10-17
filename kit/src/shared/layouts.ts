// Stage layouts (2026-10-02): how a machine sits on a stream. Coin-Op City is meant to live in a corner of a stream
// to get chat going, not to be the whole stream; the full-screen stage is for "be right back" and "starting soon".
// Streamers make and change layouts in the control panel; each has its own OBS link (/stage/?layout=<id>), and
// changes show in OBS straight away, the machine it shows too (the owner's pick, 2026-10-07). The plain /stage/ link
// uses the "full" layout.
import { DEFAULT_ROOM, isRoomId } from './machine-list';
import type { RoomId } from './protocol';

export type LayoutMode = 'corner' | 'full';
/** How a layout's countdown is set: minutes from when the streamer presses Start, or a go-live time of day. */
export type TimerMode = 'minutes' | 'clock';

export interface StageLayout {
  id: string;
  name: string;
  /** The machine it shows: switching it switches the layout's OBS sources over, without a new link. */
  room: RoomId;
  /**
   * 'corner': just the machine, on a transparent background (OBS shows the stream through it), framed tightly
   * (CORNER_SIZE), for a corner of the screen. 'full': the 1920x1080 stage.
   */
  mode: LayoutMode;
  /** Full screen: the city (or video loop) behind the machine; off shows the stage's plain dark background. */
  background: boolean;
  /** Full screen: the side panels. */
  scores: boolean;
  feed: boolean;
  /** How to play, career leaders and the coin shop, taking turns under the feed. */
  tips: boolean;
  meter: boolean;
  music: boolean;
  /** Full screen: a big line across the top, e.g. BE RIGHT BACK; empty for none. */
  banner: string;
  /**
   * Full screen: a countdown in the banner (STARTING IN 09:59) instead of its text while it runs. At zero the banner
   * says HERE WE GO! and the machine drops a free coin rain for everyone who waited (once, on the server).
   */
  countdown: boolean;
  timerMode: TimerMode;
  /** 'minutes': how long it runs from Start (the control panel can add or take off a minute while it runs). */
  timerMinutes: number;
  /** 'clock': the go-live time, HH:MM in 24 hours, on the streamer's own clock. */
  timerClock: string;
  /** The words before the time, e.g. STARTING IN or BACK IN. */
  timerLabel: string;
  /**
   * Play commands, what viewers type to play (the owner's ask, 2026-10-07, "let users toggle the play commands off"):
   * the corner's tag under the machine (TYPE !drop TO PLAY), and on the claw its turn box's TYPE LEFT · RIGHT · UP ·
   * DOWN (the box keeps the turn's countdown and results). Until then `dropTag`, the corner's tag alone.
   */
  commands: boolean;
  /** Corner: the top 3 players in a strip under the machine. */
  miniBoard: boolean;
  /** Both: names over new coins and "+N name" win popups; the big card for paid support. */
  names: boolean;
  alerts: boolean;
}

/** The corner layout's size in OBS, before the streamer shrinks it there: the machine (1040x1080) and its strip. */
export const CORNER_SIZE = { width: 1040, height: 1200, machineHeight: 1080 } as const;
/** Where the corner layout's frame sits in the 1920x1080 stage: the machine picture and a little room each side. */
export const CORNER_LEFT = (1920 - CORNER_SIZE.width) / 2;

/** No countdown, as most layouts start (BRB can turn its own on: BACK IN 05:00). */
const NO_TIMER = { countdown: false, timerMode: 'minutes', timerMinutes: 5, timerClock: '20:00', timerLabel: 'STARTING IN' } as const;

export const DEFAULT_LAYOUTS: StageLayout[] = [
  {
    id: 'corner', name: 'Corner overlay', room: DEFAULT_ROOM, mode: 'corner', background: false,
    scores: false, feed: false, tips: false, meter: false, music: false, banner: '', ...NO_TIMER,
    commands: true, miniBoard: true, names: true, alerts: true,
  },
  {
    id: 'soon', name: 'Starting soon', room: DEFAULT_ROOM, mode: 'full', background: true,
    scores: true, feed: true, tips: true, meter: true, music: true, banner: 'STARTING SOON',
    countdown: true, timerMode: 'minutes', timerMinutes: 10, timerClock: '20:00', timerLabel: 'STARTING IN',
    commands: true, miniBoard: false, names: true, alerts: true,
  },
  {
    id: 'brb', name: 'Be right back', room: DEFAULT_ROOM, mode: 'full', background: true,
    scores: true, feed: true, tips: true, meter: true, music: true, banner: 'BE RIGHT BACK', ...NO_TIMER, timerLabel: 'BACK IN',
    commands: true, miniBoard: false, names: true, alerts: true,
  },
  {
    id: 'full', name: 'Full screen', room: DEFAULT_ROOM, mode: 'full', background: true,
    scores: true, feed: true, tips: true, meter: true, music: true, banner: '', ...NO_TIMER,
    commands: true, miniBoard: false, names: true, alerts: true,
  },
];

/** The plain full-screen layout: what /stage/ shows, and what anything unknown falls back to. */
export const FULL_LAYOUT = DEFAULT_LAYOUTS.find((l) => l.id === 'full')!;

/**
 * The claw machine's own layout (2026-10-04 to 2026-10-07), from before every layout picked its machine. OBS sources
 * may still have its link (/stage/?layout=claw): it shows Full screen on the claw, and a saved copy is dropped.
 */
export const OLD_CLAW_LAYOUT = 'claw';

/**
 * A layout's id as the layouts keep it (cleanLayout) and as the hub hears a stage's (hub.ts): lower case, only a-z, 0-9
 * and -, at most 24 characters. Empty when nothing's left.
 */
export const cleanLayoutId = (text: string): string => text.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);

/**
 * The layout a stage link (?layout=) shows: its own, its id cleaned as the hub cleans it (?layout=Corner is corner), or
 * Full screen for the plain /stage/, the old claw link and an id with nothing left in it.
 */
export const linkLayout = (layoutParam: string | null): string =>
  layoutParam === null || layoutParam === OLD_CLAW_LAYOUT ? FULL_LAYOUT.id : cleanLayoutId(layoutParam) || FULL_LAYOUT.id;

/**
 * The layout a stage on `layoutId` (linkLayout's) shows, from a list of layouts: its own, or Full screen when the list
 * has none of that id (a link to a layout since deleted, still in an OBS source). Such a stage follows Full screen, its
 * machine too, on every new list, and switching the stream moves it with Full screen (channel.ts's stream.switch). Any
 * list with no Full screen in it gives the standard one (the server's list always has its own).
 */
export const shownLayout = (list: readonly StageLayout[], layoutId: string): StageLayout =>
  list.find((l) => l.id === layoutId) ?? list.find((l) => l.id === FULL_LAYOUT.id) ?? FULL_LAYOUT;

/**
 * The machine a stage link shows: the one its ?room= names (the control panel's preview names its own), the claw for
 * the old claw link, otherwise its layout's. A name that isn't a machine (2026-10-09: ?room=pinball, before it exists)
 * shows the coin pusher, as such a link always has.
 */
export const linkRoom = (roomParam: string | null, layoutParam: string | null, layout: StageLayout): RoomId => {
  const named = roomParam ?? (layoutParam === OLD_CLAW_LAYOUT ? 'claw' : layout.room);
  return isRoomId(named) ? named : DEFAULT_ROOM;
};

/**
 * Whether a stage link names its machine, so the stage never follows its layout's machine (linkRoom): a link with
 * ?room= (whatever it names), or the old claw link. Switching the stream can't move such a stage, so it tells the server
 * (hub.ts), and the panel says why.
 */
export const linkPinsMachine = (roomParam: string | null, layoutParam: string | null): boolean =>
  roomParam !== null || layoutParam === OLD_CLAW_LAYOUT;

/**
 * Where a stage reloads when the server sent it another machine than the one it drew (`shown`): the server shows a
 * locked or coming-soon machine's link the default machine, and a buyer of only the claw their layouts' coin pusher's
 * place (rooms.ts Machines.stageRoom). The same link with ?room= set to what was sent; null when they match, or when
 * the server named no machine of the list (never followed, so the page can't be sent round in circles).
 */
export const servedRoomHref = (href: string, served: string, shown: RoomId): string | null => {
  if (served === shown || !isRoomId(served)) return null;
  const url = new URL(href);
  url.searchParams.set('room', served);
  return url.href;
};

/**
 * The layouts with the stream switched to `room`: each one on screen (`onScreen`, their ids from the server) shows that
 * machine, as the Layouts card's Machine row sets it, and the rest stay as they are. A new list; the one given isn't
 * changed. A stage whose link names its machine stays on it, as linkRoom has it, so the server leaves out a layout only
 * such stages show (OnAir.pinnedLayouts).
 */
export const switchLayouts = (list: readonly StageLayout[], onScreen: readonly string[], room: RoomId): StageLayout[] =>
  list.map((layout) => (onScreen.includes(layout.id) ? { ...layout, room } : layout));

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A layout as received from anywhere, brought into shape (unknown fields dropped, text trimmed). */
export function cleanLayout(input: Partial<StageLayout>, fallback: StageLayout = FULL_LAYOUT): StageLayout {
  const flag = (k: keyof StageLayout) => (typeof input[k] === 'boolean' ? (input[k] as boolean) : (fallback[k] as boolean));
  const text = (value: unknown, max: number) => String(value).replace(/[<>]/g, '').trim().slice(0, max);
  const minutes = Math.round(Number(input.timerMinutes));
  // Saved before 2026-10-07: the corner's tag switch, which never showed in a full-screen layout.
  const oldTag = (input as { dropTag?: unknown }).dropTag;
  return {
    id: cleanLayoutId(String(input.id ?? fallback.id)) || fallback.id,
    name: String(input.name ?? fallback.name).trim().slice(0, 40) || fallback.name,
    room: isRoomId(input.room) ? input.room : fallback.room,
    mode: input.mode === 'corner' ? 'corner' : input.mode === 'full' ? 'full' : fallback.mode,
    background: flag('background'),
    scores: flag('scores'),
    feed: flag('feed'),
    tips: flag('tips'),
    meter: flag('meter'),
    music: flag('music'),
    banner: text(input.banner ?? fallback.banner, 32),
    countdown: flag('countdown'),
    timerMode: input.timerMode === 'clock' || input.timerMode === 'minutes' ? input.timerMode : fallback.timerMode,
    timerMinutes: Number.isFinite(minutes) ? Math.max(1, Math.min(600, minutes)) : fallback.timerMinutes,
    timerClock: CLOCK_TIME.test(String(input.timerClock)) ? String(input.timerClock) : fallback.timerClock,
    timerLabel: text(input.timerLabel ?? fallback.timerLabel, 20).toUpperCase(),
    commands: typeof input.commands === 'boolean' ? input.commands : input.mode === 'corner' && typeof oldTag === 'boolean' ? oldTag : fallback.commands,
    miniBoard: flag('miniBoard'),
    names: flag('names'),
    alerts: flag('alerts'),
  };
}

/** How long a finished countdown keeps showing HERE WE GO! before going back to the banner's own text. */
export const COUNTDOWN_AFTER_MS = 60 * 60_000;
export const COUNTDOWN_DONE_TEXT = 'HERE WE GO!';

/**
 * When a go-live time (HH:MM) next comes round on this computer's clock: today's, until an hour after it (so
 * HERE WE GO! shows for a while), then tomorrow's.
 */
export function clockEndsAt(clock: string, now: number): number {
  const [h, m] = clock.split(':').map(Number);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (at.getTime() + COUNTDOWN_AFTER_MS <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** Time left as the banner shows it: 09:59 under an hour, 1:04:30 over; rounded up, so it reads 00:00 only at zero. */
export function countdownClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
