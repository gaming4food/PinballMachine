// The show book of the quest's flash: what each moment on the table plays. A bank matched, multiball, the ball saver,
// double score, a nudge, a payout and the toys' hits (a pop-up knocked down, the mummy's hits, the tomb's catch) each
// get a light show over the table's lamps, a screen flash, sparks and a shake, in the values below (starting points:
// the owner's look may tune them). Like the light shows (light-show.ts) it is numbers only, so it tests in Node (npm
// run pinball-shows-test), and it plays through ShowSinks, which the stage points at its light-show player, its sparks,
// its screen flash and the view's quake.
//
// It keeps no clock of its own. A moment is queued for its time, and frame(t), the time the stage draws (which stops
// when the table does), plays what has come due, in the order of the moments' times: the screen flash drops a flash
// asked for a time earlier than the last one it let through. A moment drawn more than STALE_SECONDS after its time (a
// page catching up, a stage opened late) is let go, not played late, as the titles and the sounds let go of theirs.
// Where the table's clock starts again (the server restarted and the page carried on) every moment queued is let go and
// what plays is cleared, since a show or a flash held for a time on the old clock would otherwise wait for it on the
// new one.
//
// Nothing may flash more than 3 times a second, for the viewers a flashing picture can hurt. Each show keeps to that
// alone (light-show.ts: FLASH_GAP), and the book keeps each moment to it as a whole. Multiball is the one moment of two
// shows, so it needs care: see MULTIBALL_PAUSE.
import type { PinballCueMsg, PinballHypeMsg } from '../shared/pinball';
import { TABLE, type Table } from '../shared/table';
import { burst, chase, strobe, sweep, type Show } from './light-show';
// Only the type: the parts load three.js and the pictures, which the book has no use for.
import type { PinballLamps } from './pinball-parts';

/**
 * Each god's colour in the quest: its bank's burst and flash when it is matched, and the burst at its toy (Horus's
 * pop-ups, Ankh's mummy, the Eye's tomb), as the lamps at the toys wear it (pinball-parts.ts).
 */
export const GOD_COLOR = { ra: 0xffc23a, horus: 0x4a7dff, ankh: 0x39ff6a, eye: 0xff3344 } as const;

/**
 * What the book plays through: the stage's own pieces, or a recording of them in a test. `play` and `flash` are given
 * the time of the moment, up to STALE_SECONDS behind the clock the stage draws, so a show plays from where it would be
 * by now (multiball's strobe is given a time ahead of the clock, and waits for it). The rest happen as the moment is
 * drawn.
 */
export interface ShowSinks {
  /** Plays a light show as if it began at time `at` (a LightShowPlayer's play). */
  play(show: Show, at: number): void;
  /** Throws `count` sparks from (x, y, z) in `color` (Sparks.burst). */
  sparks(x: number, y: number, z: number, color: number, count: number): void;
  /**
   * Flashes the table's picture in `color` at `strength` (0 to 1 of the flash's cap), peaking at time `at`
   * (ScreenFlash.flash).
   */
  flash(color: number, strength: number, at: number): void;
  /** Shakes the view for `seconds`. */
  shake(seconds: number): void;
  /** Lets go of the shows playing and the flashes held, when the old clock goes. */
  clear(): void;
}

/** A moment drawn this long past its time is let go, not played late (pinball-hud.ts's STALE_SECONDS). */
const STALE_SECONDS = 2;
/**
 * The drawn time going back by more than this is the table's clock starting again (the server restarted: the stage is
 * made once per page and the page carries on), as for the titles and the sounds.
 */
const CLOCK_BACK = 1;
/** The most a DrawnClock steps at once, in seconds: a long gap (a hidden page) is one small step, not a leap. */
const MAX_STEP = 0.1;

const WHITE = 0xffffff;
/** The ball saver's green, and the gold of double score and of the coins (the payout's burst, the mummy's sparks). */
const SAVER_GREEN = 0x39ff6a;
const DOUBLE_GOLD = 0xffc23a;
const COIN_GOLD = 0xffd23f;
/** The multiball chase's pink, and the colours of the sparks at a pop-up's hit and at the tomb's catch. */
const MULTIBALL_PINK = 0xff2bd6;
const POPUP_SPARKS = 0xbcd4ff;
const TOMB_SPARKS = 0xff8a3a;

/**
 * Multiball's strobe begins this long after its chase ends. A ring lamp rises as the chase's head passes it, once a
 * lap, so the lamps at the end of the ring rise just before the chase is over, and each of the strobe's three flashes
 * (0.4 s apart) is another rise: with the strobe straight after the chase, the last lamp of the ring rises 4 times in
 * 0.83 s. With the pause, the last rise of the chase and the third flash are at least 1.2 s apart, so no lamp rises 4
 * times in any second.
 */
const MULTIBALL_PAUSE = 0.4;

/** The middle of some places on the table: the mean of their x and of their z. */
function middleOf(places: readonly { x: number; z: number }[]): { x: number; z: number } {
  const mean = (axis: 'x' | 'z') => places.reduce((sum, p) => sum + p[axis], 0) / places.length;
  return { x: mean('x'), z: mean('z') };
}

/** A moment waiting for its time, and what it does then. */
interface Moment {
  at: number;
  play(): void;
}

/**
 * The show book. Each moment is handed over as it happens (a hype moment, a toy-hit cue, multiball, a payout) and waits
 * for its time; frame(t) plays it then. A moment the book has no row for is dropped on the spot.
 */
export class PinballShows {
  /** The moments waiting for their time, in the order of their times (and of their arrival, for the same time). */
  private readonly waiting: Moment[] = [];
  /** The time last drawn: -Infinity before the first frame, and after a reset. */
  private t = -Infinity;

  constructor(
    private readonly table: Table,
    private readonly lamps: PinballLamps,
    private readonly sinks: ShowSinks,
  ) {}

  /**
   * A hype moment, queued for its time: a bank matched (`bank-<god>`, of a bank the table has), the ball saver, double
   * score and the nudge. Multiball has no row here, whoever pressed it: the sound cues decide it once, for a press and
   * for the lock alike, and the stage sends their one decision to multiball(), so the press's moment played here too
   * would show it twice. An id with no row does nothing.
   */
  hype(m: PinballHypeMsg): void {
    this.queue(m.at, this.hypePlay(m));
  }

  /**
   * A toy-hit cue, queued for its time: a pop-up knocked down, the mummy's hits (its third, which puts it down, is a
   * row of its own) and the tomb's catch. A part the table hasn't got, or has but has no row for, does nothing.
   */
  cue(m: PinballCueMsg): void {
    this.queue(m.at, this.cuePlay(m));
  }

  /** Multiball, a press's or the lock's, from time `at`. */
  multiball(at: number): void {
    this.queue(at, () => {
      const lap = chase(this.lamps.ring, { color: MULTIBALL_PINK, laps: 2, lapSeconds: 0.9 });
      const flashes = strobe(this.lamps.all, { color: WHITE, times: 3, rate: 2.5 });
      this.sinks.play(lap, at);
      this.sinks.play(flashes, at + lap.seconds + MULTIBALL_PAUSE);
      this.sinks.flash(WHITE, 0.8, at);
    });
  }

  /**
   * A payout at time `at`: a burst of light from (x, z), where the coins burst, wider for more coins. The coins
   * themselves are the stage's own burst (coin-burst.ts), so there are no sparks.
   */
  payout(x: number, z: number, coins: number, at: number): void {
    this.queue(at, () => this.lightBurst(x, z, Math.min(9, 2 + coins / 3), 0.8, COIN_GOLD, at));
  }

  /**
   * Each frame, at the time the stage draws: the moments that have come due play, in the order of their times, and
   * those drawn more than STALE_SECONDS late are let go. The caller looks at the player and the flash after this, so a
   * moment due this frame shows in it. Where the time has gone back by more than CLOCK_BACK, the table's clock has
   * started again: every moment queued goes and the sinks are cleared, once. A time that isn't a number is no frame.
   */
  frame(t: number): void {
    if (!Number.isFinite(t)) return;
    if (t < this.t - CLOCK_BACK) {
      this.waiting.length = 0;
      this.sinks.clear();
    }
    this.t = t;
    while (this.waiting.length > 0 && this.waiting[0].at <= t) {
      const moment = this.waiting.shift()!;
      if (t - moment.at <= STALE_SECONDS) moment.play();
    }
  }

  /**
   * A fresh hello: the new server's clock may have started again from 0, so the old clock's moments and the time kept
   * go, and so does whatever plays (as where the drawn time goes back).
   */
  reset(): void {
    this.waiting.length = 0;
    this.t = -Infinity;
    this.sinks.clear();
  }

  /** Queues what a moment does at time `at`, if it does anything. A time that isn't a number is no moment. */
  private queue(at: number, play: (() => void) | null): void {
    if (play === null || !Number.isFinite(at)) return;
    this.waiting.push({ at, play });
    // Stable, so moments for the same time (the cues of one step) keep the order they came in.
    this.waiting.sort((a, b) => a.at - b.at);
  }

  /** A burst of light over all the lamps, out from (x, z), begun at time `at`. */
  private lightBurst(x: number, z: number, reach: number, seconds: number, color: number, at: number): void {
    this.sinks.play(burst(this.lamps.all, { x, z, reach, color, seconds }), at);
  }

  /** What a hype moment does when its time comes, or null if the book has no row for its id. */
  private hypePlay({ id, at }: PinballHypeMsg): (() => void) | null {
    const { sinks, lamps } = this;
    if (id === 'saver') {
      // Every lamp, up the whole length of the table.
      return () => sinks.play(sweep(lamps.all, { from: 0, to: TABLE.length, color: SAVER_GREEN, seconds: 1 }), at);
    }
    if (id === 'double') {
      return () => {
        sinks.play(strobe(lamps.ladders, { color: DOUBLE_GOLD, times: 4, rate: 2.5 }), at);
        sinks.flash(DOUBLE_GOLD, 0.4, at);
      };
    }
    if (id === 'nudge') return () => sinks.shake(0.3);

    // A bank matched: the bank's god gives the colour, and the table's bank its plaques.
    const god = id.startsWith('bank-') ? id.slice('bank-'.length) : '';
    const bank = this.table.banks.find((b) => b.id === id);
    // Own properties only: an id like bank-constructor names no god.
    if (!bank || !Object.hasOwn(GOD_COLOR, god)) return null;
    const color = GOD_COLOR[god as keyof typeof GOD_COLOR];
    const plaques = bank.targets.flatMap((target) => this.table.targets.filter((t) => t.id === target));
    if (plaques.length === 0) return null;
    const middle = middleOf(plaques);
    return () => {
      this.lightBurst(middle.x, middle.z, 10, 1.1, color, at);
      sinks.flash(color, 0.5, at);
      for (const p of plaques) sinks.sparks(p.x, 0.4, p.z, color, 10);
    };
  }

  /** What a toy-hit cue does when its time comes, or null if the book has no row for its part. */
  private cuePlay({ part: id, down, x, z, at }: PinballCueMsg): (() => void) | null {
    const { sinks } = this;
    const part = this.table.targets.find((t) => t.id === id);
    if (part?.rise === 'drop') {
      // A pop-up's hit always puts it down (the cue's `down` is true for it), so its one row needs no look at `down`.
      return () => {
        this.lightBurst(part.x, part.z, 3, 0.6, GOD_COLOR.horus, at);
        sinks.sparks(x, 0.35, z, POPUP_SPARKS, 14);
      };
    }
    if (part?.rise === 'hold') {
      // The mummy stays up for its hits, and its third puts it down: that one has a row of its own, in place of the
      // others, with the biggest burst, a white flash and a shake.
      if (!down) {
        return () => {
          this.lightBurst(part.x, part.z, 2.5, 0.5, GOD_COLOR.ankh, at);
          sinks.sparks(x, 0.5, z, COIN_GOLD, 10);
        };
      }
      return () => {
        this.lightBurst(part.x, part.z, 10, 1.2, GOD_COLOR.ankh, at);
        sinks.flash(WHITE, 0.6, at);
        sinks.shake(0.6);
        sinks.sparks(x, 0.5, z, COIN_GOLD, 30);
      };
    }
    const tomb = this.table.tomb;
    if (tomb && id === tomb.id) {
      // The burst is from the doorway, and the sparks at the ball, which the tomb holds a little in front of it (the
      // cue's place for the tomb is that held spot).
      return () => {
        this.lightBurst(tomb.x, tomb.z, 4, 0.7, GOD_COLOR.eye, at);
        sinks.sparks(x, 0.35, z, TOMB_SPARKS, 16);
      };
    }
    return null;
  }
}

/**
 * The table's clock as drawn, for the effects (the shows, the flash, the sparks, the beam and the coins): the latest
 * drawn time seen, which never goes back, and the step from one look to the next, between 0 and 0.1. The screen flash's
 * 3 a second holds only on a clock that never goes back, and the drawn time does slip back a little after the table
 * pauses (the kit's render clock eases its offset down), so the effects run on `now`, not on the drawn time itself.
 */
export class DrawnClock {
  /** The latest drawn time seen, or null before the first look. */
  private latest: number | null = null;

  /**
   * The latest drawn time seen, 0 before any. It goes back only where the table's clock starts again (the drawn time
   * back by more than a second): it then starts fresh at the new time.
   */
  get now(): number {
    return this.latest ?? 0;
  }

  /**
   * Looks at the drawn time `time` and returns how far the clock has moved on since the last look, in seconds: the
   * rise in `now`, at most 0.1 (a long gap, as when the page was hidden or the table paused, steps no more than that,
   * though `now` goes the whole way). 0 for the first look, while the time stands still, and when it has gone back: a
   * step back of a second or less holds `now` where it was, and a jump back of more starts it fresh at `time`. A time
   * that isn't a number is no look.
   */
  step(time: number): number {
    if (!Number.isFinite(time)) return 0;
    const was = this.latest;
    if (was === null || time < was - CLOCK_BACK) {
      this.latest = time;
      return 0;
    }
    if (time <= was) return 0;
    this.latest = time;
    return Math.min(MAX_STEP, time - was);
  }

  /** Forgets the time seen: the next look is a first look, wherever it is (a fresh hello). */
  reset(): void {
    this.latest = null;
  }
}
