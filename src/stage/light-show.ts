// The light shows of the quest's flash, as numbers only (no three.js, so they test in Node: npm run light-show-test):
// the four shapes a show takes over the table's lamps (a sweep up the table, a burst out from a spot, a chase round a
// ring of lamps and a strobe), the player that mixes the shows running into one light for each lamp, and RiseLimit,
// which keeps any one light from flashing more than 3 times a second. A show is asked what it lights `tau` seconds
// after it began and keeps no clock of its own, so the stage can run it on the table's clock, which stops when the
// table does.
//
// The 3 a second is for the viewers a flashing picture can hurt, so nothing may break it, however a light is asked for.
// A light is lit above LIT_ABOVE of its peak and dark below DARK_BELOW of it; in between it is as it was. It rises when
// it goes from dark to lit, which is how a viewer sees a flash, so a light that only dips and comes back isn't
// flashing. Rises FLASH_GAP apart are never 4 in a second (4 take 3 gaps, 1.02 s). Each shape keeps to that alone: a
// sweep or a burst passes a lamp once, a chase lights it once a lap and a strobe once a flash, and a lap or a flash
// takes at least FLASH_GAP. RiseLimit holds what the shapes can't promise: shows played over each other, and the game's
// own light.

/**
 * A light rises at most once in this long, so never more than 3 times a second. A chase's lap and a strobe's flash take
 * at least this long, and RiseLimit holds a light to it.
 */
export const FLASH_GAP = 0.34;
/** A light is lit above this share of its peak... */
export const LIT_ABOVE = 0.5;
/** ...and dark below this one. A rise is going above LIT_ABOVE after being below DARK_BELOW. */
export const DARK_BELOW = 0.15;

/** A lamp as a show sees it: where it is on the table (x across, z up it) and its own colour (0xRRGGBB). */
export interface ShowLamp {
  x: number;
  z: number;
  color: number;
}
/** What a show lights a lamp with: how brightly (above 0, up to 1 of the lamp's peak) and in what colour. */
export interface LampLight {
  level: number;
  color: number;
}
/**
 * A show lasts `seconds`. `light` is what it lights a lamp with `tau` seconds after it began, or null for no light: on
 * any lamp that isn't one of its own, before it begins, from `seconds` on, and where its shape leaves a lamp dark. The
 * light it returns is the show's own, filled in again by its next call (nothing is made per frame), so a caller reads
 * it at once and copies what it keeps.
 */
export interface Show {
  seconds: number;
  light(lamp: ShowLamp, tau: number): LampLight | null;
}

/** How far a sweep's line lights a lamp to either side of it, and a burst's ring (so they are 3 and 1.2 across). */
const SWEEP_HALF = 1.5;
const RING_HALF = 0.6;
/** How many lamps behind its head a chase's light fades over. */
const TAIL = 5;

/**
 * A show over its own lamps (anything with a `has` for them: a set, or a map from lamp to place), lighting each in
 * `color` at `level(lamp, tau)` from its start to `seconds`, and not at all where that comes to nothing. A lamp is its
 * own by being that very object, so the lamps a show is made over must be the ones the player is made over.
 */
function showOf(
  own: { has(lamp: ShowLamp): boolean },
  seconds: number,
  color: number,
  level: (lamp: ShowLamp, tau: number) => number,
): Show {
  /** The show's one light, filled in by each call. */
  const lit: LampLight = { level: 0, color };
  return {
    seconds,
    light(lamp, tau) {
      if (tau < 0 || tau >= seconds || !own.has(lamp)) return null;
      lit.level = level(lamp, tau);
      return lit.level > 0 ? lit : null;
    },
  };
}

/**
 * A line moving up the table from z `from` to z `to` over `seconds`, lighting each lamp as it passes: at 1 - |z - line|
 * / 1.5, so a lamp lights as the line comes within 1.5 of it, is brightest as it passes and goes out 1.5 beyond.
 */
export function sweep(
  lamps: readonly ShowLamp[],
  o: { from: number; to: number; color: number; seconds: number },
): Show {
  return showOf(new Set(lamps), o.seconds, o.color, (lamp, tau) => {
    const line = o.from + ((o.to - o.from) * tau) / o.seconds;
    return 1 - Math.abs(lamp.z - line) / SWEEP_HALF;
  });
}

/**
 * A ring 1.2 wide, growing from (x, z) out to `reach` over `seconds`: a lamp is lit at 1 - |d - r| / 0.6, d being its
 * distance from the middle and r the ring's. The ring's width alone would let lamps up to 0.6 past `reach` catch its
 * edge at the end, so a lamp farther than `reach` from the middle is never lit: the burst is no bigger than it was
 * asked to be.
 */
export function burst(
  lamps: readonly ShowLamp[],
  o: { x: number; z: number; reach: number; color: number; seconds: number },
): Show {
  return showOf(new Set(lamps), o.seconds, o.color, (lamp, tau) => {
    const d = Math.hypot(lamp.x - o.x, lamp.z - o.z);
    if (d > o.reach) return 0;
    const r = (o.reach * tau) / o.seconds;
    return 1 - Math.abs(d - r) / RING_HALF;
  });
}

/**
 * A head running round `ring` in its order, `laps` times. A lamp is lit as the head passes it and fades over the 5
 * lamps behind it, lap after lap. A lap takes `lapSeconds`, but at least FLASH_GAP: each lamp rises once a lap, and
 * it is the laps that must not come more than 3 a second.
 */
export function chase(ring: readonly ShowLamp[], o: { color: number; laps: number; lapSeconds: number }): Show {
  const lap = Math.max(o.lapSeconds, FLASH_GAP);
  const place = new Map<ShowLamp, number>(ring.map((lamp, i): [ShowLamp, number] => [lamp, i]));
  return showOf(place, o.laps * lap, o.color, (lamp, tau) => {
    // How many lamps the head has run since the start, and the place of this lamp (showOf asks only about the ring's).
    // A lamp the head hasn't reached yet isn't lit, though the tail of a lap before the first would light it.
    const head = (tau / lap) * ring.length;
    const at = place.get(lamp)!;
    if (head < at) return 0;
    return 1 - ((head - at) % ring.length) / TAIL;
  });
}

/**
 * All the lamps together, on for the first half of each period and dark for the second, `times` times. The flashes
 * come `rate` a second, but never faster than 1 / FLASH_GAP: each one is a rise of every lamp at once.
 */
export function strobe(lamps: readonly ShowLamp[], o: { color: number; times: number; rate: number }): Show {
  const period = Math.max(1 / o.rate, FLASH_GAP);
  return showOf(new Set(lamps), o.times * period, o.color, (_lamp, tau) => (tau % period < period / 2 ? 1 : 0));
}

/**
 * Holds one light (a glow, the screen flash) to flashing no more than 3 times a second. It passes `raw`, the light
 * asked for (0 to 1 of its peak), through, except that a light that has gone dark since it last rose is held at
 * min(raw, DARK_BELOW) until FLASH_GAP after that rise. So it rises at most once in FLASH_GAP however fast it is asked
 * to, a light that stays lit is never held, and holding keeps a dark light dark, never darkens a lit one. A light is
 * dark before its first look, so its first rise goes through at once. `t` is seconds on a clock that doesn't go back;
 * where the clock starts again, `reset()` forgets the last rise.
 */
export class RiseLimit {
  /** Whether the light has been dark since it last rose (it is, until it has risen), and when it last rose. */
  private dark = true;
  private risenAt = -Infinity;

  level(raw: number, t: number): number {
    if (raw < DARK_BELOW) this.dark = true;
    if (this.dark && t - this.risenAt < FLASH_GAP) return Math.min(raw, DARK_BELOW);
    if (this.dark && raw > LIT_ABOVE) {
      this.dark = false;
      this.risenAt = t;
    }
    return raw;
  }

  /** Forgets the last rise, so the light is as it was at its first look. */
  reset(): void {
    this.dark = true;
    this.risenAt = -Infinity;
  }
}

/**
 * The shows playing over the table's lamps, mixed into one light for each. A lamp takes the brightest light any running
 * show gives it, in that light's colour (on a tie, the show played first keeps it), and is null where none lights it,
 * which leaves it to the game. A show begun in the past plays from where it would be by now, one begun in the future
 * waits for its time, and one that is over is let go.
 */
export class LightShowPlayer {
  /** The shows held, in the order they were played, each with the time it began. */
  private readonly playing: { show: Show; at: number }[] = [];
  /** What lights() returns and the light it gives each lamp: made once here, and filled in again by each call. */
  private readonly out: (LampLight | null)[];
  private readonly mix: LampLight[];

  constructor(private readonly lamps: readonly ShowLamp[]) {
    this.out = lamps.map(() => null);
    this.mix = lamps.map(() => ({ level: 0, color: 0 }));
  }

  /** Plays `show` as if it began at time `at`, on the clock that lights() is asked with. */
  play(show: Show, at: number): void {
    this.playing.push({ show, at });
  }

  /**
   * Each lamp's light at time `t`, in the order of the constructor's lamps (null: no show lights it), after letting
   * go of the shows that are over. The array is the player's own, and so is each light in it: the next call fills
   * them in again (nothing is made per frame), so a caller reads them at once and copies what it keeps.
   */
  lights(t: number): (LampLight | null)[] {
    let kept = 0;
    for (let k = 0; k < this.playing.length; k++) {
      const p = this.playing[k];
      if (t - p.at < p.show.seconds) this.playing[kept++] = p;
    }
    this.playing.length = kept;

    for (let i = 0; i < this.lamps.length; i++) {
      let level = 0;
      let color = 0;
      for (let k = 0; k < kept; k++) {
        const p = this.playing[k];
        const tau = t - p.at;
        if (tau < 0) continue;
        const light = p.show.light(this.lamps[i], tau);
        // The numbers are taken at once: a show's light is filled in again by its next call, and the same show may
        // be playing twice.
        if (light !== null && light.level > level) {
          level = light.level;
          color = light.color;
        }
      }
      if (level > 0) {
        const mixed = this.mix[i];
        mixed.level = level;
        mixed.color = color;
        this.out[i] = mixed;
      } else {
        this.out[i] = null;
      }
    }
    return this.out;
  }

  /** Lets every show go, those that haven't begun too. */
  clear(): void {
    this.playing.length = 0;
  }

  /** How many shows it holds: those playing, and those waiting for their time. */
  get running(): number {
    return this.playing.length;
  }
}
