// The quest's screen hits, so far the flash: a moment's colour added over the table's picture. The stage adds it in the
// picture's own shader (pinball.ts: uFlash and uFlashAmount), so it lights the table and not the city that shows
// through the picture's clear parts. Like the light shows (light-show.ts) it is numbers only, so it tests in Node, and
// it keeps no clock of its own: a flash is asked for at a time and looked at with the table's clock, which stops when
// the table does.
//
// A flash covers the whole table, so it is the effect that matters most to the viewers a flashing picture can hurt, and
// three things hold it. It adds at most FLASH_CAP of its colour. A flash asked for less than FLASH_GAP after the last
// one began is dropped, so flashes begin at least FLASH_GAP apart, never 4 in a second. RiseLimit's dark-to-lit rule
// alone would not do that: a flash dies away only to about half in a tenth of a second, and asked for again then it
// would brighten from half to full ten times a second without once going dark. And the amount drawn goes through a
// RiseLimit, as every light's does. The gap counts from when a flash began, and RiseLimit from when it was first drawn,
// which can be later, so each holds what the other can't see.
import { FLASH_GAP, RiseLimit } from './light-show';

/** The most a flash adds to the picture, as a share of its colour: the cap on the brightest change on the screen. */
export const FLASH_CAP = 0.3;
/** A flash dies away by a factor of e every 1/7 s: this many e-foldings a second. */
const DECAY = 7;
/**
 * A flash of this share of the cap or less is let go, and shows as nothing. That is 0.0003 of its colour at the most,
 * under a tenth of a step of the 8 bits a stream carries, so it can't be seen; and an amount of 0 is nothing showing.
 */
const GONE = 0.001;

/** A flash held: its colour (0xRRGGBB), strength (0 to 1 of the cap), start, and whether a look has drawn it yet. */
interface Flash {
  color: number;
  strength: number;
  at: number;
  drawn: boolean;
}

/**
 * The flashes asked for, as the one light that is added over the table's picture. A flash peaks at its start, in its
 * colour, and dies away by a factor of e every 1/7 s; where flashes meet, the brightest shows, in its colour. The clock
 * passed to `flash` and `at` never goes back; where the table's clock starts again (the server restarted), the caller
 * calls `clear()`.
 */
export class ScreenFlash {
  /**
   * The flashes held, in the order they were let through: those still to begin, and the one showing, which is the
   * brightest that has begun. Every flash dies away at the same rate, so one that is brighter than another now is
   * brighter for as long as both last, and every other flash that has begun is beaten for good and is let go.
   */
  private readonly held: Flash[] = [];
  /** When the last flash let through began. */
  private lastStart = -Infinity;
  /** Holds the amount drawn to 3 rises a second, as every light on the table is held. */
  private readonly limit = new RiseLimit();
  /** What at() returns: made once here, and filled in again by each call, so that nothing is made per frame. */
  private readonly light = { color: 0, amount: 0 };

  /**
   * Asks for a flash of `color` (0xRRGGBB) at `strength` (0 to 1 of FLASH_CAP; above 1 is 1) that peaks at time `at` on
   * the table's clock. `at` may be ahead of the clock, and the flash then waits for it.
   * - A flash of no strength (a thousandth of the cap or less, which would be let go at once), or at a time that isn't
   *   one, is no flash: it does nothing, and is not the last one.
   * - One asked for less than FLASH_GAP after the last flash let through began is dropped, and so is one asked for a
   *   time before that flash's start: flashes come in the order of their times. One FLASH_GAP after it, or more, is let
   *   through.
   * - One asked for the very time of the last flash let through merges with it: the brighter keeps the flash and its
   *   colour, and on a tie the first does. That is only while the last has not been drawn. A picture that has begun to
   *   die away is never made brighter again but by a new flash, so one that comes after the look is dropped.
   */
  flash(color: number, strength: number, at: number): void {
    if (!(strength > GONE) || !Number.isFinite(at)) return;
    const s = Math.min(strength, 1);
    if (at === this.lastStart) {
      const last = this.held[this.held.length - 1];
      if (last !== undefined && last.at === at && !last.drawn && s > last.strength) {
        last.color = color;
        last.strength = s;
      }
      return;
    }
    if (at - this.lastStart < FLASH_GAP) return;
    this.held.push({ color, strength: s, at, drawn: false });
    this.lastStart = at;
  }

  /**
   * The flash at time `t`: the colour to add to the picture and how much of it (0 to FLASH_CAP), after RiseLimit has
   * held it. With nothing showing the amount is 0 and the colour 0. The object is the flash's own, and the next call
   * fills it in again (nothing is made per frame), so a caller reads it at once and copies what it keeps. A `t` that
   * isn't a number shows nothing and leaves the flashes as they are.
   */
  at(t: number): { color: number; amount: number } {
    const out = this.light;
    out.color = 0;
    out.amount = 0;
    if (!Number.isFinite(t)) return out;

    // The brightest flash that has begun, the first on a tie, if it is over GONE. Each one looked at is drawn from now.
    let best: Flash | null = null;
    let most = GONE;
    for (let i = 0; i < this.held.length; i++) {
      const f = this.held[i];
      if (f.at > t) continue;
      f.drawn = true;
      const level = f.strength * Math.exp(-DECAY * (t - f.at));
      if (level > most) {
        best = f;
        most = level;
      }
    }
    // The others that have begun are beaten or gone. Only the flashes still to begin stay with the one showing.
    let kept = 0;
    for (let i = 0; i < this.held.length; i++) {
      const f = this.held[i];
      if (f.at > t || f === best) this.held[kept++] = f;
    }
    this.held.length = kept;

    // RiseLimit looks at every call, nothing showing included: that is how it sees a light go dark.
    out.amount = this.limit.level(best === null ? 0 : most, t) * FLASH_CAP;
    if (best !== null) out.color = best.color;
    return out;
  }

  /**
   * Lets every flash go, those still to begin too, and forgets the last start and the last rise, so that a flash on a
   * clock that starts again is neither dropped nor held for the old clock's times.
   */
  clear(): void {
    this.held.length = 0;
    this.lastStart = -Infinity;
    this.limit.reset();
    this.light.color = 0;
    this.light.amount = 0;
  }
}
