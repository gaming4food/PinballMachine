// Messages between the server and the browser pages (stage and control panel).
import type { AutoEventsState, MachineAutoEvents } from './auto-events';
import type { StageLayout } from './layouts';
import type { CloudState } from './dashboard';
import type { CareerLeader, CareerView } from './career';
import type { RoomId } from './machine-list';
import type { LicencePlan } from './plans';
import type { PictureQuality } from './picture';
import type { LimitsInput, PriceLimits, Prices, PricesInput } from './prices';

/** `tips`: StreamElements tip pages, which aren't tied to any one platform (see connectors/streamelements.ts). */
export type Platform = 'twitch' | 'youtube' | 'tiktok' | 'kick' | 'tips' | 'sim';

/**
 * Each room is its own machine with its own coins, meter, feed and leaderboard: 'main' is the coin pusher. Every
 * platform's viewers play them all together (the separate Twitch machine and its switch went on 2026-10-04: one
 * machine for every platform, always). The rooms are the machines on the list in shared/machine-list.ts (2026-10-09).
 */
export type { RoomId };

/** The Windows app's downloads (server/content.ts): the songs, backdrop loops and alert voices. */
export interface ContentProgress {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  /** Bytes downloaded so far this round, of `total`. */
  done: number;
  total: number;
  /** The file being downloaded, or what went wrong and when it's tried again. */
  detail: string;
  /** Ask me first: new songs or loops held back until the streamer says Download. */
  offer?: Partial<Record<keyof ContentChoice, ContentOffer>>;
  /** The held lists' fingerprints: a new id means something newer was published (the bar shows again). */
  offerId?: string;
  /** What last arrived, e.g. "20 new songs: A, B, C and 17 more." */
  arrived?: string;
}

/** New songs or loops waiting for Download: how many files, their bytes, and what they are. */
export interface ContentOffer {
  files: number;
  bytes: number;
  summary: string;
}

/**
 * What else the app downloads besides the alert voice (server/content.ts): the installer's two boxes, then the panel's
 * Downloads card. Unticked, it isn't downloaded, and what was is taken off the PC.
 */
export interface ContentChoice {
  /** The house songs (royalty-free music). */
  music: boolean;
  /** The city backdrops (the video loops behind the machines). */
  backdrops: boolean;
}

export interface RoomInfo {
  id: RoomId;
  label: string;
  /** Platforms whose viewers play in this room. */
  platforms: Platform[];
  /** Platforms shown under PLAY FROM on this room's stage. */
  shownPlatforms: Platform[];
  /** Whether the stage shows platform badges (PLAY FROM, the leaderboard, the feed, alert cards). */
  badges: boolean;
  /**
   * A machine this copy hasn't unlocked (the app's license, docs/DOWNLOADABLE_APP.md part 2; nothing sets it yet): the
   * control panel shows it darkened, with an Upgrade link to the website's prices.
   */
  locked?: boolean;
  /**
   * A machine on its way to this copy (docs/SPEEDWAY.md section 9: the Speedway is on the owner's own PC first): nobody
   * plays it, the control panel shows it as Coming soon, and it never runs.
   */
  soon?: boolean;
}

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/**
 * A body made of pieces (the claw machine's chains, docs/CLAW_CHAINS.md): each piece moves in snapshots as a body of
 * its own, piece k as body id + k. Its machine may say more about it (a chain's style, metal and size).
 */
export interface ChainBody {
  /** Each piece's centre and turn, in order; piece 0's is the body's own. */
  pieces: { p: Vec3; q: Quat }[];
}

export interface BodyState {
  id: number;
  /** A coin, or what a machine from machines/ calls its bodies (the claw's prize kinds, the Speedway's 'kart'). */
  kind: string;
  color: number;
  /** The owner's coin skin (see shared/skins.ts); absent means the default gold. */
  skin?: string;
  /** The viewer who owns it; absent for the machine's own coins. Their profile picture goes by this (see 'avatar'). */
  owner?: number;
  /** The owner's animated name (see NAME_EFFECTS in shared/skins.ts), for the name tag over the coin. */
  fx?: string;
  /** A body made of pieces (a claw chain): where each piece is; piece k moves in snapshots as body id + k. */
  chain?: ChainBody;
  p: Vec3;
  q: Quat;
}

export interface BoardRow {
  name: string;
  color: number;
  /** An animated name (see NAME_EFFECTS in shared/skins.ts). */
  fx?: string;
  platform: Platform;
  balance: number;
}

export interface MeterState {
  total: number;
  prevAt: number;
  nextAt: number;
  nextLabel: string;
}

export type FeedTone = 'info' | 'drop' | 'win' | 'gift' | 'milestone';

export interface FeedItem {
  id: number;
  text: string;
  tone: FeedTone;
  color?: number;
  /** The viewer's animated name, when the line is about one viewer (see NAME_EFFECTS in shared/skins.ts). */
  fx?: string;
  platform?: Platform;
  /** Paid support with its own big card on the stage (see 'alert'), so the stage skips the small banner. */
  card?: boolean;
}

/**
 * One line of the control panel's Chat card (server/chatlog.ts): a chat message from any platform, or support
 * (a gift, sub, Super Chat, raid or tip), shown highlighted.
 */
export interface ChatLine {
  /** Counts up from 1 each time the server starts. */
  id: number;
  /** When it came in (ms since 1970). */
  at: number;
  platform: Platform;
  name: string;
  /** What they typed; with support, the message they attached (often none). */
  text: string;
  /** Support: what they did, e.g. "sent $20.00 · Super Chat", "raided with 12 viewers". */
  support?: string;
  /** Written by the channel's owner. */
  streamer?: boolean;
  /** From the Fake audience or the control panel's test buttons. */
  test?: boolean;
}

/**
 * The big card a gift, donation or sub gets on the stage (YouTube Super Chats, Super Stickers and memberships;
 * Twitch bits, subs and gifted subs; Kick subs and gifted subs). Stages show them one at a time, each for
 * ALERT_MIN_SECONDS or until its voice has finished, whichever is longer.
 */
export interface AlertInfo {
  id: number;
  name: string;
  color: number;
  platform: Platform;
  /** Their viewer id, so a profile picture that arrives later (see 'avatar') can still go on the card. */
  owner: number;
  /** Their animated name (see NAME_EFFECTS in shared/skins.ts). */
  fx?: string;
  /** Their profile picture on this server, when it's already here. */
  avatar?: string;
  /** "$20.00", "500 bits", "Tier 1". */
  amount: string;
  /** "Super Chat", "Cheer", "New sub". */
  what: string;
  /** What it drops: "EARTHQUAKE!", "GIANT COIN!". */
  effect: string;
  /** 1 (smallest) to 4, as the 'donation' effect. */
  tier: number;
  /** Their message, filtered (see moderation.cleanMessage); absent when there was none or it was blocked. */
  message?: string;
  /** What the voice reads: their name, what they did and their message. */
  speech: string;
  /** The voice reading `speech`, made on the server (see server/voice.ts); absent when there's no voice to make it. */
  voice?: { url: string; seconds: number };
  /** The streamer turned the voice off: no voice at all, not even the browser's own. */
  silent?: boolean;
}

/** The least time a card stays up; one whose voice takes longer stays until it has finished. */
export const ALERT_MIN_SECONDS = 10;

export interface RoomStatus {
  id: RoomId;
  label: string;
  coins: number;
  queued: number;
  stages: number;
  stepMs: number;
}

export interface ConnectorStatus {
  platform: Platform;
  /** waiting: signed in, but there's nothing to read yet (e.g. YouTube before you go live). */
  state: 'off' | 'connecting' | 'waiting' | 'connected' | 'error';
  detail: string;
}

/** A StreamElements channel whose tips come in (see connectors/streamelements.ts), as the control panel lists it. */
export interface TipChannelInfo {
  /** Stands for its token, which never leaves the server. */
  id: string;
  /** "CoinOpCity (YouTube)". */
  label: string;
  state: 'connecting' | 'connected' | 'error';
  detail: string;
}

/**
 * What's on the stream (docs/superpowers/specs/2026-10-11-panel-follows-the-stream-design.md): the machines with a
 * stage on screen in OBS, and the layouts those stages show. A stage is on screen when its page is open, its scene is
 * showing, and it isn't the control panel's own preview.
 *
 * A stage whose link names its machine (shared/layouts.ts linkPinsMachine) doesn't follow its layout's machine, so
 * switching the stream can't move it. `pinned` and `pinnedLayouts` say where only such stages are on screen.
 */
export interface OnAir {
  /** The machines on air, in the order they came on: the one that came on last is last. */
  rooms: RoomId[];
  /** The ids of the layouts those stages show, sorted. */
  layouts: string[];
  /** The machines in `rooms` whose every stage on screen has a link that names its machine, in the order of `rooms`. */
  pinned: RoomId[];
  /** The layouts in `layouts` whose every stage on screen has a link that names its machine: a switch leaves them be. */
  pinnedLayouts: string[];
}

export interface ServerStatus {
  uptimeSec: number;
  users: number;
  snapshotKBps: number;
  rooms: RoomStatus[];
  connectors: ConnectorStatus[];
  bot: { enabled: boolean; rate: number };
  /** Which voice reads paid support's alerts out (see server/voice.ts). */
  voice: string;
  /**
   * The layouts (their ids) a stage shows outside the control panel's own preview: OBS has loaded their links (on
   * screen or not). The setup guide ticks each layout off as it appears.
   */
  layoutsOpen: string[];
  /** What's on the stream right now. */
  onAir: OnAir;
}

/** A streamer's plan as their panel shows it, on a hosted server with billing (see server/billing.ts). */
export interface BillingView {
  /** Whether the machine runs. Off, its stages show nothing and chat drops no coins. */
  on: boolean;
  /**
   * none: no free trial started yet (no card added); trialing; active (paid up); grace: a payment failed and Stripe is
   * retrying the card, still running until graceEnds; unpaid: switched off after the grace, until a payment goes
   * through; ended: switched off, the plan cancelled.
   */
  state: 'none' | 'trialing' | 'active' | 'grace' | 'unpaid' | 'ended';
  interval: 'month' | 'year' | null;
  /** What each month or year costs, in cents, for all their machines (before any sales tax). */
  amount: number;
  /** Coin Pushers paid for: one (a separate Twitch machine used to make it two, until 2026-10-04). */
  machines: number;
  /** When things happen (ms since 1970): the trial's end, the next renewal, the grace's end. */
  trialEnd: number | null;
  periodEnd: number | null;
  /** Cancelled, running until periodEnd. */
  cancelAtPeriodEnd: boolean;
  graceEnds: number | null;
  /** A new checkout comes with the free trial: they haven't had it. */
  trialAvailable: boolean;
  /** One Coin Pusher's price, in cents, a month and a year. */
  prices: { month: number; year: number };
}

/**
 * A licence key's referrals, as the checker's /check answers them beside the signed note (it unlocks nothing; the
 * License card shows it). See docs/superpowers/specs/2026-10-17-referrals-design.md.
 */
export interface ReferralView {
  /** The key's referral code, and the link that carries it (coinopcity.com/r/<code>). */
  code: string;
  link: string;
  /** Referred people still in their trial, and those who paid after it (each a free month). */
  pending: number;
  earned: number;
  /** Earned months waiting for a live subscription (or for Stripe to take them). */
  banked: number;
  /** Until when (ms since 1970) the months make All machines free; 0 for never. */
  bundleUntil: number;
}

/** What every stage should be playing: the server picks the songs, stages follow. */
export interface MusicState {
  /** Changes whenever a new song starts, including after a skip. */
  id: number;
  title: string;
  /** Empty when no songs are imported: stages play generated synthwave instead. */
  url: string;
  /** Server clock (ms since 1970) when this song started, so a stage that joins late starts mid-song. Moved
   * later by however long it was paused, so (now - startedAt) is always how far into the song it is. */
  startedAt: number;
  /** Paused from the control panel since this server time (ms); null while playing. */
  pausedAt: number | null;
  seconds: number;
  upNext: string;
  /** 0 to 1. */
  musicVolume: number;
  /** Game sounds (coins, wins, explosions), 0 to 1. */
  sfxVolume: number;
  /**
   * The control panel's "Mute music on my end": while a music source (stage/music.html, in OBS with Audio Monitoring
   * off) is open too, the stages leave the house music out and that source plays it, so viewers hear it and the
   * streamer, who listens to the stage through OBS, doesn't. Without one open, the stages keep playing it.
   */
  mutedHere: boolean;
  /** A music source is open (see mutedHere). Checked once a second, so the stages and it always switch together. */
  musicSourceOpen: boolean;
  /** What !skip costs viewers (the streamer's price), shown in How to play. */
  skipCost: number;
  /** The streamer's own music folder (server/my-music.ts); missing on a hosted server, which can't reach one. */
  mine?: MyMusicState;
}

/** The house-music part of MusicState, which the DJ owns. */
export type HouseMusic = Omit<MusicState, 'skipCost' | 'musicSourceOpen' | 'mine'>;

/**
 * Where the music comes from (issue #5): the house songs, the streamer's own folder, both shuffled together, or an
 * internet radio station's stream.
 */
export const MUSIC_SOURCES = ['house', 'mine', 'both', 'radio'] as const;
export type MusicSource = (typeof MUSIC_SOURCES)[number];

export interface MyMusicState {
  source: MusicSource;
  /** The folder's full path on this PC; empty until one is chosen. */
  folder: string;
  /** Songs found in it. */
  count: number;
  scanning: boolean;
  /** Why it has no songs (a folder that isn't there, or no playable files); empty otherwise. */
  error: string;
  /** The internet radio station: the link the streamer gave, its name, and whether it works. */
  radio: { url: string; name: string; checking: boolean; error: string };
}

/** One backdrop video loop (made in the Studio or with `npm run backdrops`), shown behind the machine. */
export interface BackdropInfo {
  id: string;
  title: string;
  /** Where the stage loads the loop, e.g. /media/backdrops/neon-city-123.mp4. */
  url: string;
  thumb: string;
  seconds: number;
  prompt?: string;
  seed?: number;
  /** How it was made, when known (so the Studio can reuse the settings or make a longer version). */
  settings?: WanSettings;
  createdAt?: string;
}

/** Everything that shapes a clip Wan 2.2 (5B) makes in ComfyUI; see shared/wan.ts for ranges and defaults. */
export interface WanSettings {
  prompt: string;
  /** The user's own things to avoid; Wan's standard quality list is always added before them. */
  avoid: string;
  /** An uploaded start image to animate (image-to-video), or '' to start from the prompt alone. */
  image: string;
  width: number;
  height: number;
  /** Frames per segment at 24 fps: 73 (3 s), 97 (4 s) or 121 (5 s). */
  frames: number;
  /** Segments per clip: each one after the first continues from the previous one's last frame. */
  segments: number;
  steps: number;
  /** How strictly Wan follows the prompt (classifier-free guidance). */
  cfg: number;
  /** Wan's noise schedule shift; 8 is recommended for this model. */
  shift: number;
  /** Full-precision model (needs a 24 GB card); otherwise held in 8-bit to fit a 12 GB one. */
  fp16: boolean;
  /** Seconds at the loop's seam where the clip's end fades into its start. */
  blend: number;
}

export type StudioJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface StudioJob {
  id: string;
  name: string;
  settings: WanSettings;
  seed: number;
  status: StudioJobStatus;
  /** While running: what it's doing right now. */
  phase?: 'starting' | 'generating' | 'decoding' | 'saving';
  /** 0 to 1 across every segment's steps. */
  progress: number;
  /** While generating: the step within the current segment (1-based), and which segment. */
  step?: number;
  segment?: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Server clock (ms) when it's expected to finish, while running. */
  etaAt?: number;
  error?: string;
  /** The backdrop loop it made. */
  backdropId?: string;
}

export interface StudioState {
  comfy: {
    state: 'offline' | 'starting' | 'ready' | 'busy';
    detail: string;
    url: string;
    /** The Start button works: ComfyUI's launcher was found on this PC. */
    canStart: boolean;
  };
  jobs: StudioJob[];
  /** Measured seconds per step for a 720p, 5-second segment on this PC (null until measured). */
  secPerStep: { fp8: number | null; fp16: number | null };
}

/** What plays behind both machines: the chosen video loops taking turns (all of them when none is chosen). */
export interface BackdropState {
  /** The loop on screen now; null only when there are no loops at all (the backdrop stays dark). */
  current: BackdropInfo | null;
  /** Every loop there is, and the ones picked to take turns. */
  all: BackdropInfo[];
  chosen: string[];
  /** Minutes each loop stays up before the next one takes over. */
  minutes: number;
}

/** `donation`: a gift, donation or sub just came in; its drops follow `duration` seconds later (see game.ts). */
export type FxKind = 'explosion' | 'quake' | 'turbo' | 'donation';

export type DespawnReason = 'front' | 'side' | 'lost' | 'bomb' | 'cleared';

/**
 * `at` fields are simulation time in seconds, so the stage can play them in sync with the physics.
 * `room` is set on copies sent to the control panel, which watches every room.
 */
export type ServerMsg =
  | {
      t: 'hello';
      room: RoomInfo;
      simTime: number;
      /** Where body 0 starts along z: the coin pusher's pusher (other machines send 0). See StageNet.pusher's note. */
      pusherZ: number;
      bodies: BodyState[];
      board: BoardRow[];
      meter: MeterState;
      feed: FeedItem[];
      /** Profile pictures of the viewers with coins in the machine, by owner id (see 'avatar'). */
      avatars: Record<number, string>;
      /** A machine's own state, as its 'machine' messages carry it (docs/MACHINE_REPOS.md). */
      machine?: unknown;
    }
  /** A machine's own message (docs/MACHINE_REPOS.md), to its stages and to the panels. */
  | { t: 'machine'; msg: unknown; room?: RoomId }
  /** A viewer's profile picture is ready (or changed): shown on all their coins, loaded from `url` on this server. */
  | { t: 'avatar'; owner: number; url: string }
  | { t: 'spawn'; at: number; body: BodyState; label?: string; gift?: boolean }
  /** `coins`: what a claw prize going down the chute ('front') was worth, for the stage to break it into that many coins. */
  | { t: 'despawn'; at: number; id: number; reason: DespawnReason; coins?: number }
  /** A "+N name (balance)" popup: what a viewer just won, and their balance with it. */
  | { t: 'score'; at: number; name: string; color: number; fx?: string; amount: number; balance: number; x: number }
  | { t: 'fx'; at: number; kind: FxKind; p?: Vec3; duration?: number; /** donation: 1 (smallest) to 4. */ tier?: number }
  | { t: 'feed'; item: FeedItem; room?: RoomId }
  /** For the Chat card: new lines, or with `history` all the recent ones, replacing what it shows. */
  | { t: 'chat'; lines: ChatLine[]; history?: boolean }
  /** A gift, donation or sub's big card (see AlertInfo). */
  | { t: 'alert'; alert: AlertInfo }
  | { t: 'board'; rows: BoardRow[]; room?: RoomId }
  | { t: 'meter'; meter: MeterState; reached?: string; room?: RoomId }
  | { t: 'rooms'; rooms: RoomInfo[] }
  /** The app's licence, for the panel's License card (server/licence-client.ts). */
  | { t: 'licence'; state: LicenceState }
  /** An address for the streamer's own browser: Stripe's checkout or billing page. */
  | { t: 'open'; url: string }
  | { t: 'status'; status: ServerStatus }
  | { t: 'music'; state: MusicState }
  /** The stage's career leaders page: the top viewer in each category (see shared/career.ts). */
  | { t: 'leaders'; leaders: CareerLeader[] }
  /** The control panel's Viewer dashboard card: whether this PC is sending viewers to the dashboard. */
  | { t: 'cloud'; state: CloudState }
  /** The stage layouts (see shared/layouts.ts): each stage applies its own, the control panel edits them. */
  | { t: 'layouts'; layouts: StageLayout[] }
  /**
   * When each layout's countdown reaches zero (ms since 1970, on the server's clock; null: not running), and the
   * server's clock now, so a page whose clock is off still shows the right time left.
   */
  | { t: 'countdowns'; ends: Record<string, number | null>; now: number }
  /**
   * The streamer's prices and the owner's limits on them (see shared/prices.ts), the city's three and each machine's
   * hype, and whether the coin shop is open (the owner's rule on a hosted server, see server/rules.ts; open when missing).
   */
  | { t: 'prices'; prices: Prices; limits: PriceLimits; shop?: boolean }
  /** The alert voice picked (a VOICE_CHOICES id, or 'off'; see shared/voices.ts), and the voices on offer (all when missing). */
  | { t: 'voice'; voice: string; offered?: string[] }
  /** Each machine's auto events and when the next ones go off (shared/auto-events.ts). */
  | { t: 'autoEvents'; state: AutoEventsState }
  /** The channel's picture setting, for its panel and its stages (a stage at another one starts again at it). */
  | { t: 'picture'; quality: PictureQuality }
  /** The control panel's viewer lookup: viewers whose name matches what was typed. */
  | { t: 'career.result'; query: string; viewers: CareerView[] }
  /** A viewer's record was removed: every open panel drops their card. */
  | { t: 'viewer.removed'; id: number }
  | { t: 'backdrop'; state: BackdropState }
  | { t: 'studio'; state: StudioState }
  | { t: 'signin.code'; platform: 'twitch' | 'youtube'; userCode: string; verificationUri: string; expiresAt: number }
  | { t: 'notice'; tone: 'info' | 'error'; text: string }
  /**
   * The Windows app's downloads (server/content.ts): how they're going, what's picked, and what the songs and the loops
   * weigh in the download list (bytes; 0 until it has been read).
   */
  | { t: 'content'; progress: ContentProgress; choice: ContentChoice; sizes: Record<keyof ContentChoice, number>; ask: boolean }
  /** The StreamElements channels whose tips come in. */
  | { t: 'tips'; channels: TipChannelInfo[] }
  /**
   * Whose control panel this is (sent first): the channel's name, and where its stages are, e.g. /stage/ on the
   * owner's PC or /s/<secret key>/stage/ for a hosted streamer (see server/channels.ts).
   */
  | {
      t: 'channel';
      name: string;
      stageBase: string;
      /** A hosted server: Twitch and YouTube connect with one button through Coin-Op City's apps (no developer apps). */
      webConnect?: boolean;
      /** The Windows app: Twitch and YouTube connect with one button and a code, through Coin-Op City's own apps. */
      appConnect?: boolean;
      /** A streamer who hasn't closed the setup guide yet: their panel opens it by itself (see control/guide.ts). */
      guide?: boolean;
    }
  /** The streamer's plan, for their panel's Account card (hosted servers with billing). */
  | { t: 'billing'; billing: BillingView }
  /** Whether the channel's machine runs (sent to stages first): switched off, a stage shows nothing at all. */
  /** Whether the machine runs; `byOwner` when Coin-Op City switched it off (the admin page), which its panel says. */
  | { t: 'power'; on: boolean; byOwner?: boolean };

export type SimEvent = 'follow' | 'sub' | 'gift' | 'raid' | 'like';

/** The streamer's own drops, from the control panel or their chat (a machine's Machine.streamerDrop: the coin pusher's). */
export const STREAMER_DROPS = ['rain', 'jackpot', 'barrage', 'goldrush'] as const;
export type StreamerDrop = (typeof STREAMER_DROPS)[number];

export type ClientMsg =
  | { t: 'career.lookup'; query: string }
  /** Deletes one viewer's record and picture for good (the Viewer lookup card; a viewer's request, the privacy policy). */
  | { t: 'viewer.remove'; id: number }
  | { t: 'cloud.set'; url: string; token: string }
  | { t: 'cloud.clear' }
  | { t: 'layouts.save'; layouts: Partial<StageLayout>[] }
  /**
   * Puts the stream on another machine: every layout on screen (OnAir.layouts) shows it, as the Layouts card's Machine
   * row does for one layout, and OBS's stages reload onto it. A stage whose link names its machine stays on that one,
   * so a layout only such stages show (OnAir.pinnedLayouts) is left as it is. When nothing moves because of them, the
   * panels get a notice saying why.
   */
  | { t: 'stream.switch'; room: RoomId }
  /** A minutes countdown: start it (from its layout's minutes, or these), nudge it by minutes, or clear it. */
  | { t: 'countdown.start'; id: string; minutes?: number }
  | { t: 'countdown.nudge'; id: string; minutes: number }
  | { t: 'countdown.reset'; id: string }
  /** Any prices left out stay as they are. The switch (`hypeOff`) is the whole list of machines switched off. */
  | { t: 'prices.set'; prices: PricesInput }
  /** One machine's auto events, from its Auto events card (shared/auto-events.ts). */
  | { t: 'autoEvents.set'; room: string; events: MachineAutoEvents }
  /** The owner's limits on the streamer's prices, the city's and each hype button's. Any left out stay as they are. */
  | { t: 'prices.limits'; limits: LimitsInput }
  | { t: 'voice.set'; voice: string }
  | { t: 'picture.set'; quality: PictureQuality }
  /** The subscriber's test buttons: a coin, or a $5 alert, from a test viewer who never reaches the leaderboard. */
  | { t: 'test.coin'; room: RoomId }
  | { t: 'test.alert'; room: RoomId }
  /** Only with COINOP_TEST_CRASH=1 (npm run hosting-test): the channel's machines thread crashes, as a bug would. */
  | { t: 'test.crash' }
  | { t: 'sim.chat'; name: string; platform: Platform; text: string; streamer?: boolean }
  | { t: 'sim.event'; name: string; platform: Platform; event: SimEvent; amount?: number; message?: string }
  | { t: 'sim.bot'; enabled: boolean; rate: number }
  /** Only for recording the website's clips (COINOP_CAPTURE=1): runs the game slower than real time. */
  | { t: 'capture.speed'; speed: number }
  /** A machine's card's buttons (docs/MACHINE_REPOS.md): the machine checks what it gets. */
  | { t: 'machine.action'; room: RoomId; action: unknown }
  | { t: 'admin.clearMachine'; room: RoomId }
  /** The app's License card: a key typed, Check now, Release this PC, Manage plan, and buying one more plan. */
  | { t: 'licence.key'; key: string }
  | { t: 'licence.check' }
  | { t: 'licence.release' }
  | { t: 'licence.portal' }
  | { t: 'licence.buy'; plan: LicencePlan }
  | { t: 'admin.resetBalances' }
  | { t: 'admin.resetMeter'; room: RoomId }
  | { t: 'admin.purgeTestUsers' }
  | { t: 'music.skip' }
  | { t: 'music.pause'; paused: boolean }
  | { t: 'music.volume'; music?: number; sfx?: number }
  | { t: 'music.muteHere'; muted: boolean }
  /** The Music player's source and folder (issue #5): a new folder is scanned. */
  | { t: 'music.source'; source: MusicSource; folder?: string }
  /** Reads the music folder again (songs added or removed). */
  | { t: 'music.rescan' }
  /** The internet radio station's link, and a name to show (issue #5); an empty link forgets it. */
  | { t: 'music.radio'; url: string; name?: string }
  | { t: 'backdrop.choose'; id: string; chosen: boolean }
  | { t: 'backdrop.show'; id: string }
  | { t: 'backdrop.minutes'; minutes: number }
  | { t: 'backdrop.delete'; id: string }
  | { t: 'studio.queue'; name: string; settings: WanSettings; seed: number | null; takes: number }
  | { t: 'studio.cancel'; id: string }
  | { t: 'studio.remove'; id: string }
  | { t: 'studio.clearFinished' }
  | { t: 'studio.startComfy' }
  | { t: 'studio.free' }
  | { t: 'studio.connection'; url: string }
  | { t: 'kick.connect'; channel: string }
  | { t: 'kick.disconnect' }
  /** Adds a StreamElements channel by its JWT token, or removes one by its id. */
  | { t: 'tips.add'; token: string }
  | { t: 'tips.remove'; id: string }
  | { t: 'twitch.connect'; clientId: string }
  | { t: 'twitch.signOut' }
  | { t: 'youtube.connect'; clientId: string; clientSecret: string }
  | { t: 'youtube.signOut' }
  /** The setup guide was closed or finished: it no longer opens by itself (the Setup guide button still opens it). */
  | { t: 'guide.seen' }
  /** Back from Stripe's checkout or billing page: ask Stripe how the plan stands now. */
  | { t: 'billing.sync' }
  /** The app's Downloads card: whether the songs and the loops come to this PC (unticked ones are taken off it). */
  | { t: 'downloads.choose'; choice: ContentChoice }
  /** Ask me first's Download: the new songs and loops held back come now. */
  | { t: 'downloads.accept' }
  /** New songs and backdrops: Ask me first (true) or Download automatically. */
  | { t: 'downloads.ask'; ask: boolean }
  /**
   * The one thing a stage sends: whether it's on screen. OBS stops drawing a source in a scene that isn't showing, and
   * the server sends a hidden stage nothing until it's back, then everything afresh (see Hub).
   */
  | { t: 'stage.visible'; visible: boolean }
  /** A stage in OBS: whether OBS is streaming (obsStreamingStarted/Stopped), so YouTube's stream is looked for only then. */
  | { t: 'stage.obs'; streaming: boolean };

// Binary snapshot of moving bodies, sent ~30 times a second:
// [u8 type][f64 simTime][u16 count] then count x [u32 id][f32 px py pz][f32 qx qy qz qw], little-endian. Another
// machine's type may carry numbers of its own between the count and the bodies, for its scene (snapshotHeader).
export const SNAP_TYPE = 1;
export const SNAP_HEADER = 11;
export const SNAP_STRIDE = 32;
/** Body id used for the pusher in snapshots; items start at 1. */
export const PUSHER_ID = 0;

/** The app's licence as the panel shows it: the key (null: none typed yet), what the last good note covers until when (ms; '*' every machine), and the last check's trouble. */
export interface LicenceState {
  key: string | null;
  machines: Record<string, number>;
  error?: 'unknown-key' | 'too-many-pcs' | 'offline' | 'no-key' | 'bad-note';
  /** When the last good note was given (ms): an offline app runs on it for 7 days. */
  issuedAt?: number;
  /** The key's referral link and counts, from the last good check (kept in memory only: it unlocks nothing). */
  referral?: ReferralView;
}
