// The quest's screen hits, so far the flash: a moment's colour added over the table's picture. The stage adds it in the
// picture's own shader (pinball.ts: uFlash and uFlashAmount), so it lights the table and not the city that shows
// through the picture's clear parts. Like the light shows (light-show.ts) it is numbers only, so it tests in Node, and
// it keeps no clock of its own: a flash is asked for at a time and looked at with the table's clock, which stops when
// the table does.
//
// A flash covers the whole table, so it is the effect that matters most to the viewers a flashing picture can hurt, and
// it is held to what they see. It adds at most FLASH_CAP of its colour, and the picture never brightens sooner than
// FLASH_GAP after the last time a flash first showed, so never 4 times in a second, whatever the frame rate. That takes
// two gaps. A flash asked for less than FLASH_GAP after the last one began is dropped. RiseLimit's dark-to-lit rule
// alone would not do that: a flash dies away only to about half in a tenth of a second, and asked for again then it
// would brighten from half to full ten times a second without once going dark. But a flash is first drawn up to a
// frame after it began, so two that began FLASH_GAP apart can first show less than that apart (10 frames at 30 fps are
// 0.333 s). So a flash that would first show less than FLASH_GAP after the last first showed is dropped as well. The
// amount drawn still goes through a RiseLimit, as every light on the table does. With the two gaps that is redundant,
// since it is never left a flash to hold, and it stays as the guard the lights share, in case a gap is changed.
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
 * colour, and dies away by a factor of e every 1/7 s; where flashes meet, the brightest shows, in its colour. A flash
 * is dropped if it begins less than FLASH_GAP after the last one began, or would first show less than that after the
 * last first showed. The clock passed to `flash` and `at` never goes back; where the table's clock starts again (the
 * server restarted), the caller calls `clear()`.
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
  /** When the last flash first showed: the look at which it first was the brightest, and so brightened the picture. */
  private lastShown = -Infinity;
  /**
   * Holds the amount drawn to 3 rises a second, as every light on the table is held. The two gaps leave it nothing to
   * hold: a flash first shows FLASH_GAP or more after the last, and RiseLimit holds only what comes sooner than that
   * after a rise. So it is redundant, and stays in the path as the guard the lights share, so that the picture is held
   * to the rule whatever a change to the gaps does.
   */
  private readonly limit = new RiseLimit();
  /** What at() returns: made once here, and filled in again by each call, so that nothing is made per frame. */
  private readonly light = { color: 0, amount: 0 };

  /**
   * Asks for a flash of `color` (0xRRGGBB) at `strength` (0 to 1 of FLASH_CAP; above 1 is 1) that peaks at time `at` on
   * the table's clock. `at` may be ahead of the clock, and the flash then waits for it. Here a flash is let through by
   * when it begins, and at() lets it through again by when it first shows.
   * - A flash of no strength (a thousandth of the cap or less, which would be let go at once), or at a time that isn't
   *   one, is no flash: it does nothing, and is not the last one.
   * - One asked for less than FLASH_GAP after the last flash let through began is dropped, and so is one asked for a
   *   time before that flash's start: flashes come in the order of their times. One FLASH_GAP after it, or more, is let
   *   through.
   * - One asked for the very time of the last flash let through merges with it: the brighter keeps the flash and its
   *   colour, and on a tie the first does. That is only while the last has not been drawn. It follows what the gaps are
   *   for: a picture is never brightened again in the middle of a flash dying away, but only by a new flash, FLASH_GAP
   *   on at the soonest. So one for the same time that comes after the look is dropped, not merged.
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
   * held it. With nothing showing the amount is 0 and the colour 0. A flash first looked at less than FLASH_GAP after
   * the last first showed is dropped: it never shows. The object is the flash's own, and the next call fills it in
   * again (nothing is made per frame), so a caller reads it at once and copies what it keeps. A `t` that isn't a number
   * shows nothing and leaves the flashes as they are.
   */
  at(t: number): { color: number; amount: number } {
    const out = this.light;
    out.color = 0;
    out.amount = 0;
    if (!Number.isFinite(t)) return out;

    // A flash looked at for the first time less than FLASH_GAP after the last first showed is dropped, so that the
    // picture never brightens sooner than that, whatever the frame rate: counted from their starts alone, two flashes
    // can first show a frame closer than FLASH_GAP. Of those looked at for the first time together, the brightest
    // shows.
    const tooSoon = t - this.lastShown < FLASH_GAP;
    // The brightest flash that has begun, the first on a tie, if it is over GONE. Each one looked at is drawn from now.
    let best: Flash | null = null;
    let most = GONE;
    let first = false;
    for (let i = 0; i < this.held.length; i++) {
      const f = this.held[i];
      if (f.at > t) continue;
      const fresh = !f.drawn;
      f.drawn = true;
      if (fresh && tooSoon) continue;
      const level = f.strength * Math.exp(-DECAY * (t - f.at));
      if (level > most) {
        best = f;
        most = level;
        first = fresh;
      }
    }
    // A flash first showing is the picture brightening, and the next may not be sooner than FLASH_GAP after it. A flash
    // that is dropped, or hidden by a brighter one dying away, does not show, and is not counted.
    if (first) this.lastShown = t;
    // The others that have begun are beaten, dropped or gone. Only flashes still to begin stay with the one showing.
    let kept = 0;
    for (let i = 0; i < this.held.length; i++) {
      const f = this.held[i];
      if (f.at > t || f === best) this.held[kept++] = f;
    }
    this.held.length = kept;

    // RiseLimit looks at every call, nothing showing included, as it does for every light: that is how it sees a light
    // go dark. With the gaps above it is never left a flash to hold (see `limit`).
    out.amount = this.limit.level(best === null ? 0 : most, t) * FLASH_CAP;
    if (best !== null) out.color = best.color;
    return out;
  }

  /**
   * Lets every flash go, those still to begin too, and forgets the last start, the last first showing and the last
   * rise, so that a flash on a clock that starts again is not dropped for the old clock's times.
   */
  clear(): void {
    this.held.length = 0;
    this.lastStart = -Infinity;
    this.lastShown = -Infinity;
    this.limit.reset();
    this.light.color = 0;
    this.light.amount = 0;
  }
}
