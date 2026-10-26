// The streamer's prices for the coin shop (skins, a new name color, animated names) and the coin pusher's automatic house
// coin drops (spec 2026-10-18, docs/superpowers/specs/2026-10-18-shop-prices-house-drip-design.md). They are part of a
// channel's prices (shared/prices.ts), but with no limits from the owner: any whole number from 0 to the ceiling.
// The default skin is always free, so it has no price here.
import type { Prices } from './prices';
import { COLOR_PRICE, DEFAULT_SKIN, NAME_EFFECTS, SKINS, type Skin } from './skins';

/** The coin pusher's room id: the machine whose house coins the drip sets. */
export const HOUSE_DRIP_ROOM = 'main';

/** No price goes past this. */
export const CEILING = 100_000;

export interface ShopPrices {
  /** What each skin costs, by `Skin.id` (every skin but the default one). */
  skins: Record<string, number>;
  /** A new name color (!color). */
  color: number;
  /** What each animated name costs, by `NAME_EFFECTS` id. */
  nameFx: Record<string, number>;
}

/** The house coins the coin pusher drops by itself: whether, how often, and how many at a time. */
export interface HouseDrip {
  on: boolean;
  everySec: number;
  coins: number;
}

/** Shop prices as a panel or a file gives them: any left out stay as they are. */
export type ShopPricesInput = { skins?: Record<string, number>; color?: number; nameFx?: Record<string, number> };
export type HouseDripInput = Partial<HouseDrip>;

export const DEFAULT_SHOP_PRICES: ShopPrices = {
  skins: Object.fromEntries(SKINS.filter((skin) => skin.id !== DEFAULT_SKIN).map((skin) => [skin.id, skin.price])),
  color: COLOR_PRICE,
  nameFx: Object.fromEntries(Object.entries(NAME_EFFECTS).map(([id, fx]) => [id, fx.price])),
};
export const DEFAULT_HOUSE_DRIP: HouseDrip = { on: true, everySec: 300, coins: 1 };
export const HOUSE_DRIP_BOUNDS = { everySec: { min: 10, max: 3600 }, coins: { min: 1, max: 20 } };

/** A price or a setting within `min`..`max`, whole: the input when it is a number, else `fallback`. */
function bounded(input: unknown, fallback: number, min: number, max: number): number {
  const n = typeof input === 'number' && Number.isFinite(input) ? Math.round(input) : fallback;
  return Math.max(min, Math.min(max, n));
}
const price = (input: unknown, fallback: number) => bounded(input, fallback, 0, CEILING);

/** One price for each of the catalog's `ids`: the input's, else the fallback's, else the catalog's. Any other key is dropped. */
function cleanEach(input: Record<string, number> | undefined, fallback: Record<string, number>, standard: Record<string, number>) {
  const given = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(Object.keys(standard).map((id) => [id, price(given[id], price(fallback?.[id], standard[id]))]));
}

/** The shop's prices as received from anywhere: whole numbers from 0 to the ceiling; nonsense keeps the fallback's. */
export function cleanShopPrices(input: ShopPricesInput | undefined, fallback: ShopPrices): ShopPrices {
  return {
    skins: cleanEach(input?.skins, fallback.skins, DEFAULT_SHOP_PRICES.skins),
    color: price(input?.color, price(fallback.color, COLOR_PRICE)),
    nameFx: cleanEach(input?.nameFx, fallback.nameFx, DEFAULT_SHOP_PRICES.nameFx),
  };
}

/** The house drip as received from anywhere, each part inside its bounds; `on` only from a true or false. */
export function cleanHouseDrip(input: HouseDripInput | undefined, fallback: HouseDrip): HouseDrip {
  const { everySec, coins } = HOUSE_DRIP_BOUNDS;
  return {
    on: typeof input?.on === 'boolean' ? input.on : typeof fallback.on === 'boolean' ? fallback.on : DEFAULT_HOUSE_DRIP.on,
    everySec: bounded(input?.everySec, bounded(fallback.everySec, DEFAULT_HOUSE_DRIP.everySec, everySec.min, everySec.max), everySec.min, everySec.max),
    coins: bounded(input?.coins, bounded(fallback.coins, DEFAULT_HOUSE_DRIP.coins, coins.min, coins.max), coins.min, coins.max),
  };
}

/** What a skin costs on this channel: nothing for the default one. */
export function skinPrice(prices: Pick<Prices, 'shop'>, skin: Skin): number {
  return skin.id === DEFAULT_SKIN ? 0 : prices.shop.skins[skin.id] ?? skin.price;
}

/** What a name color costs on this channel: a plain color, or the animated name `fx`. */
export function colorPrice(prices: Pick<Prices, 'shop'>, fx?: string): number {
  if (fx === undefined) return prices.shop.color;
  return prices.shop.nameFx[fx] ?? (NAME_EFFECTS as Record<string, { price: number }>)[fx]?.price ?? prices.shop.color;
}

/** One line of the control panel's shop list. */
export interface ShopRow {
  key: string;
  label: string;
  price: number;
  /** What the standard shop charges, to show next to it. */
  standard: number;
  section: 'names' | Skin['shelf'];
}

/** Every shop price the streamer can set: a new color, the animated names, then each skin by shelf. */
export function shopRows(prices: Pick<Prices, 'shop'>): ShopRow[] {
  const { shop } = prices;
  const rows: ShopRow[] = [{ key: 'color', label: 'A new name color', price: shop.color, standard: COLOR_PRICE, section: 'names' }];
  for (const [id, fx] of Object.entries(NAME_EFFECTS)) {
    rows.push({ key: `nameFx.${id}`, label: fx.label, price: shop.nameFx[id] ?? fx.price, standard: fx.price, section: 'names' });
  }
  for (const skin of SKINS) {
    if (skin.id === DEFAULT_SKIN) continue;
    rows.push({ key: `skins.${skin.id}`, label: skin.label, price: shop.skins[skin.id] ?? skin.price, standard: skin.price, section: skin.shelf });
  }
  return rows;
}
