// The pinball's scoreboard over the stage (PinballHud, an OverlayFactory's; pinball.css), as the claw's turn box is:
// the balls on the table with their owners and scores, what's lit (multiball, double score, the ball saver), the next
// 3 in line, the words to type (hidden by the layout's Play commands switch, as the claw's are), and the last ball's
// result. Over the table, big titles: each hype button's (MULTIBALL!, BALL SAVER!, DOUBLE SCORE!, NUDGE!) at its
// moment's time, MULTIBALL! when the lock starts it, BALL SAVED! when the stage sees a ball drain and come straight
// back (ballSaved, from the scene), and a ball's result. Tested in Node: npm run pinball-hud-test.
import { cssColor } from '@kit/stage';
import { pinballHypeOf, type PinballHypeMsg, type PinballState, pinballStateOf } from '../shared/pinball';

/** How long a title is up (pinball.css's title animation runs as long), as the claw's hype titles. */
export const TITLE_SECONDS = 2.2;
/** A moment this long past when its time is drawn is let go (a page catching up), as the claw's. */
const STALE_SECONDS = 2;
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

/** A title waiting for its time (null: the next frame), its look (data-title), and the line over it, if any. */
interface Title {
  at: number | null;
  kind: string;
  words: string;
  by?: { text: string; color?: number };
}

const points = (n: number) => n.toLocaleString('en-US');
const coinsText = (n: number) => `${n} ${n === 1 ? 'COIN' : 'COINS'}`;

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
  private readonly title = document.createElement('div');
  private readonly words = document.createElement('span');
  private readonly by = document.createElement('span');
  private state: PinballState | null = null;
  private simTime = -Infinity;
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
    this.ball.hidden = this.flags.hidden = this.next.hidden = this.result.hidden = true;
    this.root.append(this.ball, this.flags, this.next, this.result, this.type);
    this.title.id = 'pinball-title';
    this.title.hidden = true;
    this.words.className = 'title-words';
    this.by.className = 'title-by';
    this.by.hidden = true;
    this.title.append(this.words, this.by);
    slot.append(this.root, this.title);
    boards.add(this);
  }

  /** The pinball's own messages (hello's `machine`, then each 'machine' message): its state, and its hype moments. */
  message(msg: unknown): void {
    const m = pinballHypeOf(msg);
    if (m) this.moment(m);
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
    if (!was) return;
    // Multiball the lock started: no press's moment came for it.
    if (!was.multiball && state.multiball && this.multiballMoments === 0 && this.lastMultiball <= this.simTime - SAME_MULTIBALL) {
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

  /** Each frame, at the simulation time the stage draws: the titles as their times come, one after another. */
  tick(simTime: number): void {
    if (simTime < this.simTime - CLOCK_BACK) this.clockRestarted(simTime);
    this.simTime = simTime;
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
      if (simTime - at > STALE_SECONDS) continue;
      this.show(next, at);
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

  private show(t: Title, at: number): void {
    this.until = Math.max(at, this.lastUntil) + TITLE_SECONDS;
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
    this.title.dataset.title = t.kind;
    this.title.dataset.run = this.run ? 'a' : 'b';
    this.title.hidden = false;
  }
}
