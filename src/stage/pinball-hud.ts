// The pinball's scoreboard over the stage (PinballHud, an OverlayFactory's; pinball.css), as the claw's turn box is:
// the balls on the table with their owners and scores, what's lit (multiball, double score, the ball saver), the next
// 3 in line, the words to type (hidden by the layout's Play commands switch, as the claw's are), and the last ball's
// result. Over the table, big titles: each hype button's (MULTIBALL!, BALL SAVER!, DOUBLE SCORE!, NUDGE!) and each
// bank's when its plaques match (HORUS MATCHED, RA MATCHED, ANKH MATCHED, EYE MATCHED) at its moment's time, MULTIBALL!
// when the lock starts it, BALL SAVED! when the stage sees a ball drain and come straight back (ballSaved, from the
// scene), and a ball's result. Tested in Node: npm run pinball-hud-test.
//
// The Pharaoh's quest is on it too, all from the state and the cues the server sends. While a mode runs a banner gives
// the god's and the mode's names, the goal's progress (Tomb Raid's is its prize, falling with its time) and a bar of
// the time left, counted down as the stage draws; in the finale it gives Pharaoh's Gold and the next jackpot. The four
// gods are lamps, lit as they are crossed off. And each quest moment gets a big title at its time (a mode's start, its
// win with the prize, its loss, a jackpot and the finale), in its god's colour, or gold. A stage opened late draws the
// banner and the lamps from the state it is given and has no title: the cues are never in hello.
import { cssColor } from '@kit/stage';
import {
  type God,
  GOD_COLOR,
  GODS,
  MODE_NAME,
  type PinballCueMsg,
  pinballCueOf,
  pinballHypeOf,
  type PinballHypeMsg,
  type PinballState,
  pinballStateOf,
  QUEST,
  tombPrize,
} from '../shared/pinball';

/** How long a title is up (pinball.css's title animation runs as long), as the claw's hype titles. */
export const TITLE_SECONDS = 2.2;
/**
 * A title more than this late for its turn is let go (a page catching up), as the claw's. Its turn is the start of its
 * slot: its moment, or the end of the title before it if that is later, so a title is not late for having waited
 * behind another.
 */
const STALE_SECONDS = 2;
/**
 * And a title more than this long past its moment is let go, however it waited. One moment can have several titles (a
 * bank matched is HORUS MATCHED and then the mode it starts; the fourth god's win is its prize and then PHARAOH'S
 * GOLD!), and each is shown in its turn: up to three, the third two titles' time after its moment. A fourth, or a
 * title kept waiting by a flurry, is let go, whether it is a hype title or a quest's.
 */
const MAX_WAIT_SECONDS = STALE_SECONDS + 2 * TITLE_SECONDS;
/** The state turning multiball on within this long of a press's moment is that press, already titled. */
const SAME_MULTIBALL = 3;
/**
 * The simulation time drawn going back by more than this is the table's clock starting again (the server restarted:
 * the overlay is made once per page and the page carries on), so everything kept by the old clock is let go.
 */
const CLOCK_BACK = 1;
/** How many of the line the scoreboard names. */
const NEXT_SHOWN = 3;

/** Each hype button's title. */
const HYPE_TITLES: Record<string, string> = {
  multiball: 'MULTIBALL!',
  saver: 'BALL SAVER!',
  double: 'DOUBLE SCORE!',
  nudge: 'NUDGE!',
  'bank-horus': 'HORUS MATCHED',
  'bank-ra': 'RA MATCHED',
  'bank-ankh': 'ANKH MATCHED',
  'bank-eye': 'EYE MATCHED',
};

/**
 * What each god's goal counts on the banner. Tomb Raid's is the prize its winning ball is paid, which falls with its
 * time (QUEST.tombPrize), so it is shown as a prize and not as a count of one.
 */
const GOAL_LABEL: Record<God, string> = { ra: 'SHOTS', horus: 'FALCONS', ankh: 'MUMMY', eye: 'PRIZE' };
/** The title for each god's mode lost. Its start and its win say the mode's name (MODE_NAME). */
const LOST_TITLES: Record<God, string> = {
  ra: 'THE SUN SETS',
  horus: 'THE FALCON FLIES',
  ankh: 'THE MUMMY SLEEPS',
  eye: 'THE TOMB SEALS',
};
/** The gold of the jackpot's and the finale's titles and of the finale's banner: Ra's, as the table's gate lamp is. */
const GOLD = GOD_COLOR.ra;
/** The bar of a mode's time is drawn in steps of a tenth of a percent: finer than a pixel of it. */
const BAR_STEPS = 1000;

/** The mode of the quest that runs, as the state carries it. */
type QuestMode = NonNullable<PinballState['quest']['mode']>;

/**
 * A title waiting for its time (null: the next frame), its look (data-title), and the line over it, if any. It has the
 * colour of its kind (pinball.css) unless it has a `color` of its own, as a quest title has its god's.
 */
interface Title {
  at: number | null;
  kind: string;
  words: string;
  by?: { text: string; color?: number };
  color?: number;
}

const points = (n: number) => n.toLocaleString('en-US');
const coinsText = (n: number) => `${n} ${n === 1 ? 'COIN' : 'COINS'}`;

/**
 * The seconds a mode has left at the simulation time the stage draws: counted down from the table's time the state was
 * made at while its clock runs (a ball is in play), held while it doesn't. The stage draws a little behind the server,
 * so a time before the state's comes out as more than the mode ever had, and one past its end as less than none: both
 * are held to the mode's own limits.
 */
function timeLeft(mode: QuestMode, simTime: number): number {
  const left = mode.running ? mode.left - (simTime - mode.at) : mode.left;
  return Math.min(QUEST.modeSeconds, Math.max(0, left));
}

/** A quest cue's title, at its time; null for the cues with none: a goal hit, a toy's hit and the finale's end. */
function questTitle(c: PinballCueMsg): Title | null {
  const title = (kind: string, words: string, color: number): Title => ({ at: c.at, kind, words, color });
  switch (c.cue) {
    case 'modeStart':
      return title('mode-start', `${MODE_NAME[c.god]}!`, GOD_COLOR[c.god]);
    case 'modeWon':
      return title('mode-won', `${MODE_NAME[c.god]}! +${points(c.prize)}`, GOD_COLOR[c.god]);
    case 'modeLost':
      return title('mode-lost', LOST_TITLES[c.god], GOD_COLOR[c.god]);
    case 'jackpot':
      return title('jackpot', `JACKPOT ${points(c.value)}!`, GOLD);
    case 'finale':
      return title('finale', "PHARAOH'S GOLD!", GOLD);
    case 'goal':
    case 'toyHit':
    case 'finaleEnd':
    // The summoned mummy put down gets its title with the events' scoreboard; till then it has none.
    case 'summonDown':
      return null;
  }
}

/** The scoreboards on this page, for ballSaved: the scene and the overlay are made apart, from the machine's pages. */
const boards = new Set<PinballHud>();

/**
 * The scene saw a ball drain and come straight back (the ball saver, or the first seconds of a ball): BALL SAVED! on
 * every scoreboard on the page, at simulation time `at`. The game says so only in the feed, which the overlay isn't
 * sent, so the scene, which sees the despawn and the spawn, tells it.
 */
export function ballSaved(at: number): void {
  for (const board of boards) board.saved(at);
}

export class PinballHud {
  private readonly root = document.createElement('div');
  private readonly ball = document.createElement('div');
  private readonly flags = document.createElement('div');
  private readonly next = document.createElement('div');
  private readonly type = document.createElement('div');
  private readonly result = document.createElement('div');
  /** The quest's god lamps, in the quest's order (GODS), and the banner of the mode that runs or the finale. */
  private readonly gods = document.createElement('div');
  private readonly lamps: [God, HTMLElement][] = [];
  private readonly banner = document.createElement('div');
  private readonly bannerNames = document.createElement('span');
  private readonly bannerGoal = document.createElement('span');
  private readonly bar = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly words = document.createElement('span');
  private readonly by = document.createElement('span');
  private state: PinballState | null = null;
  private simTime = -Infinity;
  /**
   * What the banner's bar (in thousandths of the mode's time) and the Eye's prize show now, or -1 where nothing is
   * drawn yet: drawTime writes each only when it changes, and showQuest sets them back when it dresses the banner.
   */
  private barShown = -1;
  private prizeShown = -1;
  private readonly waiting: Title[] = [];
  /** When the title up now goes (simulation time), or null with none up; and when the last one went. */
  private until: number | null = null;
  private lastUntil = -Infinity;
  private run = false;
  /** Press moments of multiball heard and not yet titled, and when the last multiball title was. */
  private multiballMoments = 0;
  private lastMultiball = -Infinity;

  /** The scoreboard goes in `slot` (the stage's #machine-overlay), and the big title over the table. */
  constructor(slot: HTMLElement) {
    this.root.id = 'pinball-hud';
    this.root.dataset.phase = 'idle';
    this.ball.className = 'pinball-ball';
    this.flags.className = 'pinball-flags';
    this.next.className = 'pinball-next';
    // What to type: the layout's Play commands switch hides .cmd (pinball.css).
    this.type.className = 'pinball-type cmd';
    this.type.innerHTML = 'TYPE <b>BALL</b> · <b>LEFT</b> · <b>RIGHT</b>';
    this.result.className = 'pinball-result';
    // The quest's parts are made here once, and only written to after (the banner's bar and prize every frame).
    this.gods.className = 'pinball-gods';
    for (const god of GODS) {
      const lamp = document.createElement('span');
      lamp.className = 'lamp';
      lamp.dataset.god = god;
      lamp.dataset.lit = 'off';
      lamp.style.setProperty('--c', cssColor(GOD_COLOR[god]));
      this.lamps.push([god, lamp]);
    }
    this.gods.append(...this.lamps.map(([, lamp]) => lamp));
    this.banner.className = 'pinball-banner';
    this.bannerNames.className = 'names';
    this.bannerGoal.className = 'goal';
    this.bar.className = 'bar';
    this.fill.className = 'fill';
    this.bar.append(this.fill);
    this.banner.append(this.bannerNames, this.bannerGoal, this.bar);
    this.ball.hidden = this.flags.hidden = this.next.hidden = this.result.hidden = this.gods.hidden = this.banner.hidden = true;
    this.root.append(this.gods, this.banner, this.ball, this.flags, this.next, this.result, this.type);
    this.title.id = 'pinball-title';
    this.title.hidden = true;
    this.words.className = 'title-words';
    this.by.className = 'title-by';
    this.by.hidden = true;
    this.title.append(this.words, this.by);
    slot.append(this.root, this.title);
    boards.add(this);
  }

  /**
   * The pinball's own messages (hello's `machine`, then each 'machine' message): its state, its hype moments and its
   * cues. Only the quest's cues get a title here: the toys' hits are the sounds' and the shows'.
   */
  message(msg: unknown): void {
    const m = pinballHypeOf(msg);
    if (m) this.moment(m);
    const c = pinballCueOf(msg);
    const title = c && questTitle(c);
    if (title) this.queue(title);
    const state = pinballStateOf(msg);
    if (state) this.set(state);
  }

  /** BALL SAVED! (ballSaved). */
  saved(at: number): void {
    this.queue({ at, kind: 'saved', words: 'BALL SAVED!' });
  }

  private moment(m: PinballHypeMsg): void {
    const words = HYPE_TITLES[m.id];
    if (!words) return;
    if (m.id === 'multiball') this.multiballMoments++;
    this.queue({ at: m.at, kind: m.id, words, ...(m.by?.name ? { by: { text: m.by.name, color: m.by.color } } : {}) });
  }

  private queue(title: Title): void {
    this.waiting.push(title);
    this.waiting.sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity));
  }

  private set(state: PinballState): void {
    const was = this.state;
    this.state = state;
    this.root.dataset.phase = state.phase;
    this.showBalls(state);
    this.showFlags(state);
    this.showNext(state);
    this.showResult(state);
    this.showQuest(state);
    if (!was) return;
    // Multiball the lock started: no press's moment came for it. The finale's is the finale's: its title says it
    // (PHARAOH'S GOLD!, from its cue), whether the fourth god's win began the finale or the next ball after a restart.
    const finaleBegan = state.quest.finale !== null && was.quest.finale === null;
    if (!was.multiball && state.multiball && !finaleBegan && this.multiballMoments === 0 && this.lastMultiball <= this.simTime - SAME_MULTIBALL) {
      this.lastMultiball = this.simTime;
      this.queue({ at: null, kind: 'multiball', words: 'MULTIBALL!' });
    }
    const r = state.lastResult;
    const before = was.lastResult;
    if (r && (!before || before.name !== r.name || before.points !== r.points || before.coins !== r.coins)) {
      this.queue({ at: null, kind: 'result', words: `${points(r.points)} POINTS`, by: { text: `${r.name} · ${coinsText(r.coins)}` } });
    }
  }

  /** A line of text pieces, each a span with its own class: names go in as text, never markup. */
  private static line(...pieces: [string, string][]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pinball-row';
    row.append(
      ...pieces.map(([cls, text]) => {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        return span;
      }),
    );
    return row;
  }

  private showBalls(s: PinballState): void {
    const rows = s.balls.map((b) => PinballHud.line(['who', b.name ?? 'HOUSE BALL'], ['score', points(b.score)]));
    if (!rows.length && s.phase === 'launching') rows.push(PinballHud.line(['who', 'NEXT BALL COMING…']));
    this.ball.replaceChildren(...rows);
    this.ball.hidden = rows.length === 0;
  }

  private showFlags(s: PinballState): void {
    const on = [s.multiball && 'MULTIBALL', s.doubleUntil !== null && '2× SCORE', s.saverUntil !== null && 'BALL SAVER', s.lockLit && 'LOCK LIT'].filter(Boolean) as string[];
    this.flags.textContent = on.join(' · ');
    this.flags.hidden = on.length === 0;
  }

  private showNext(s: PinballState): void {
    const shown = s.line.slice(0, NEXT_SHOWN);
    const more = s.line.length - shown.length;
    const pieces: [string, string][] = [['label', 'NEXT'], ...shown.map((u): [string, string] => ['name', u.name])];
    if (more > 0) pieces.push(['more', `+${more}`]);
    this.next.replaceChildren(PinballHud.line(...pieces));
    this.next.hidden = shown.length === 0;
  }

  private showResult(s: PinballState): void {
    const r = s.lastResult;
    this.result.hidden = !r;
    this.result.replaceChildren(...(r ? [PinballHud.line(['label', 'LAST BALL'], ['name', r.name], ['score', `${points(r.points)} POINTS`], ['coins', coinsText(r.coins)])] : []));
  }

  /**
   * The quest, from the state: the gods' lamps (shown while a god is crossed off, a mode runs or the finale does), and
   * the banner of the mode that runs, or of the finale. A finale a restart saved, still waiting for a ball, has gods
   * crossed off and no banner. What the banner shows of the time is drawn for the time the stage draws (drawTime).
   */
  private showQuest(s: PinballState): void {
    const { done, mode, finale } = s.quest;
    this.gods.hidden = done.length === 0 && !mode && !finale;
    for (const [god, lamp] of this.lamps) lamp.dataset.lit = done.includes(god) ? 'on' : 'off';
    this.banner.hidden = !mode && !finale;
    this.bar.hidden = this.bannerGoal.hidden = !mode;
    if (mode) {
      this.banner.style.setProperty('--c', cssColor(GOD_COLOR[mode.god]));
      this.bannerNames.textContent = `${mode.god.toUpperCase()} · ${MODE_NAME[mode.god]}`;
      // The Eye's goal is its prize, which the time sets (drawTime), so it is written there.
      if (mode.god !== 'eye') this.bannerGoal.textContent = `${GOAL_LABEL[mode.god]} ${mode.progress}/${mode.goal}`;
      this.barShown = this.prizeShown = -1;
      this.drawTime(this.simTime);
    } else if (finale) {
      this.banner.style.setProperty('--c', cssColor(GOLD));
      this.bannerNames.textContent = `PHARAOH'S GOLD · JACKPOT ${points(finale.jackpot)}`;
    }
  }

  /**
   * The banner's bar of the mode's time, and the Eye's prize, which falls with it, at the simulation time the stage
   * draws. Done every frame, so it makes nothing and writes to an element only when what it shows has changed: the bar
   * in steps of BAR_STEPS, and the prize when it falls.
   */
  private drawTime(simTime: number): void {
    const mode = this.state?.quest.mode;
    if (!mode) return;
    const left = timeLeft(mode, simTime);
    const step = Math.round((left / QUEST.modeSeconds) * BAR_STEPS);
    if (step !== this.barShown) {
      this.barShown = step;
      this.fill.style.width = `${(step * 100) / BAR_STEPS}%`;
    }
    if (mode.god !== 'eye') return;
    const prize = tombPrize(left);
    if (prize !== this.prizeShown) {
      this.prizeShown = prize;
      this.bannerGoal.textContent = `${GOAL_LABEL.eye} ${points(prize)}`;
    }
  }

  /**
   * Each frame, at the simulation time the stage draws: the banner's time counted down, and the titles as their times
   * come, one after another.
   */
  tick(simTime: number): void {
    if (simTime < this.simTime - CLOCK_BACK) this.clockRestarted(simTime);
    this.simTime = simTime;
    this.drawTime(simTime);
    if (this.until !== null && simTime >= this.until) {
      this.lastUntil = this.until;
      this.until = null;
      this.title.hidden = true;
    }
    if (this.until !== null) return;
    while (this.waiting.length) {
      const next = this.waiting[0];
      const at = next.at ?? simTime;
      if (at > simTime) return;
      this.waiting.shift();
      if (next.kind === 'multiball' && next.at !== null) {
        this.multiballMoments = Math.max(0, this.multiballMoments - 1);
        this.lastMultiball = next.at;
      }
      // Its slot starts at its moment, or when the title before it ended if that was later.
      const start = Math.max(at, this.lastUntil);
      if (simTime - start > STALE_SECONDS || simTime - at > MAX_WAIT_SECONDS) continue;
      this.show(next, start);
      return;
    }
  }

  /**
   * The table's clock started again: the title up now goes, and so do the times kept by the old clock (when the last
   * title went, the last multiball's) and its titles still waiting. Titles already on the new clock (at most a second
   * ahead, as a moment just sent is) and those for the next frame stay.
   */
  private clockRestarted(simTime: number): void {
    this.until = null;
    this.lastUntil = -Infinity;
    this.lastMultiball = -Infinity;
    this.title.hidden = true;
    const kept = this.waiting.filter((t) => t.at === null || t.at <= simTime + CLOCK_BACK);
    this.waiting.splice(0, this.waiting.length, ...kept);
    this.multiballMoments = kept.filter((t) => t.kind === 'multiball' && t.at !== null).length;
  }

  /** Shows a title in its slot, which starts at `start` (see tick) and runs for TITLE_SECONDS. */
  private show(t: Title, start: number): void {
    this.until = start + TITLE_SECONDS;
    this.run = !this.run;
    this.words.textContent = t.words;
    if (t.by) {
      this.by.textContent = t.by.text;
      this.by.style.color = t.by.color === undefined ? '' : cssColor(t.by.color);
      this.by.hidden = false;
    } else {
      this.by.textContent = '';
      this.by.style.color = '';
      this.by.hidden = true;
    }
    // A title with no colour of its own takes its kind's (pinball.css), so the last one's must not stay.
    if (t.color === undefined) this.title.style.removeProperty('--c');
    else this.title.style.setProperty('--c', cssColor(t.color));
    this.title.dataset.title = t.kind;
    this.title.dataset.run = this.run ? 'a' : 'b';
    this.title.hidden = false;
  }
}
