// The prices a streamer sets for their own channel (decided 2026-10-02, docs/CONTROL_PANELS.md), each within limits
// the owner sets. Everything else in the economy (coin values, rewards, the house coin, skins) is the owner's and the
// same on every stream.
//
// Besides the city's three prices, the streamer prices every hype button that chat can buy (shared/hype-sale.ts), and has
// one switch for each machine's hype. Hype is saved under its item's key (`<machine id>.<button id>`), and the switch
// under the machine's id. Which items there are comes from the machines' entries, not from here.
import { HYPE_ITEMS, type HypeItem } from './hype-sale';

export interface Prices {
  /** !fireworks */
  fireworks: number;
  /** !sr, a song request */
  songRequest: number;
  /** !skip, skipping the song */
  skip: number;
  /** What chat pays for each hype button on sale, by `HypeItem.key`. */
  hype: Record<string, number>;
  /** The machines whose hype chat can't buy (the streamer's switch, by room id). Every machine is on to start with. */
  hypeOff: string[];
}

/** The city's own three prices. */
export type PriceKey = 'fireworks' | 'songRequest' | 'skip';

export interface Limit {
  min: number;
  max: number;
}

/** The owner's limits on each price, and on each hype button's price (by `HypeItem.key`). */
export type PriceLimits = Record<PriceKey, Limit> & { hype: Record<string, Limit> };

/** Prices as a panel or a file gives them: any left out stay as they are. */
export type PricesInput = Partial<Record<PriceKey, number>> & { hype?: Record<string, number>; hypeOff?: string[] };

/** Limits as a panel or a file gives them: any left out, or any side left out, stay as they are. */
export type LimitsInput = Partial<Record<PriceKey, Partial<Limit>>> & { hype?: Record<string, Partial<Limit>> };

export const DEFAULT_PRICES: Prices = {
  fireworks: 25,
  songRequest: 50,
  skip: 100,
  hype: Object.fromEntries(HYPE_ITEMS.map((item) => [item.key, item.price])),
  hypeOff: [],
};
export const DEFAULT_PRICE_LIMITS: PriceLimits = {
  fireworks: { min: 5, max: 500 },
  songRequest: { min: 10, max: 1000 },
  skip: { min: 10, max: 2000 },
  hype: Object.fromEntries(HYPE_ITEMS.map((item) => [item.key, { ...item.limits }])),
};
export const PRICE_KEYS: readonly PriceKey[] = ['fireworks', 'songRequest', 'skip'];

/** What each price is called in the control panel. */
export const PRICE_LABELS: Record<PriceKey, string> = {
  fireworks: '!fireworks',
  songRequest: 'Song request (!sr)',
  skip: 'Skip the song (!skip)',
};

/** No limit goes past this. */
const CEILING = 100_000;

const whole = (value: unknown, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
};

/** One limit: whole numbers from 0 to the ceiling, the max no lower than the min. A side that isn't a number keeps `before`'s. */
function cleanLimit(input: Partial<Limit> | undefined, before: Limit): Limit {
  const min = Math.max(0, Math.min(CEILING, whole(input?.min, before.min)));
  const max = Math.max(min, Math.min(CEILING, whole(input?.max, before.max)));
  return { min, max };
}

/**
 * Limits as received from anywhere: whole numbers, never below 0, a max at least its min; nonsense keeps `fallback`'s.
 * A hype button has limits for each of `items`: the input's, else the fallback's, else its own. A key that no item has is
 * dropped.
 */
export function cleanLimits(input?: LimitsInput, fallback: PriceLimits = DEFAULT_PRICE_LIMITS, items: readonly HypeItem[] = HYPE_ITEMS): PriceLimits {
  const out = { hype: {} } as PriceLimits;
  for (const key of PRICE_KEYS) out[key] = cleanLimit(input?.[key], fallback[key]);
  for (const item of items) out.hype[item.key] = cleanLimit(input?.hype?.[item.key], fallback.hype[item.key] ?? item.limits);
  return out;
}

/**
 * Prices as received from anywhere, each brought inside its limits; anything that isn't a number keeps `fallback`'s.
 * A hype button has a price for each of `items`: the input's, else the fallback's, else its own. The switch comes from the
 * input when that's a list, else from the fallback, and keeps only machines that have an item, once each, in order. A key
 * that no item has is dropped.
 */
export function cleanPrices(input: PricesInput | undefined, limits: PriceLimits, fallback: Prices = DEFAULT_PRICES, items: readonly HypeItem[] = HYPE_ITEMS): Prices {
  const out = { hype: {} } as Prices;
  for (const key of PRICE_KEYS) out[key] = Math.max(limits[key].min, Math.min(limits[key].max, whole(input?.[key], fallback[key])));
  for (const item of items) {
    const range = limits.hype[item.key] ?? item.limits;
    out.hype[item.key] = Math.max(range.min, Math.min(range.max, whole(input?.hype?.[item.key], whole(fallback.hype[item.key], item.price))));
  }
  const asked = input?.hypeOff;
  const rooms = new Set(items.map((item) => item.room));
  out.hypeOff = [...new Set((Array.isArray(asked) ? asked : fallback.hypeOff).filter((room) => typeof room === 'string' && rooms.has(room)))];
  return out;
}
