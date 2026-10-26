// The kit's shared door (docs/MACHINE_REPOS.md section 2): what a machine may use of Coin-Op City's shared code, on the
// server and in the pages alike. A machine imports the platform only through src/kit (as @kit/...), so its repo can
// carry a copy of the kit (npm run kit:export) and work on its own. Tested by npm run kit-boundary-test.
export type { BodyState, ChainBody, FeedItem, FeedTone, Platform, Quat, RoomInfo, ServerMsg, StreamerDrop, Vec3 } from '../shared/protocol';
export { PUSHER_ID, SNAP_HEADER, SNAP_STRIDE, SNAP_TYPE, STREAMER_DROPS } from '../shared/protocol';
// The coin skins and name colours viewers buy (the city's catalogue, and what each owns is in their wallet).
export { COLOR_PRICE, COLORS, DEFAULT_SKIN, NAME_EFFECTS, patternNumber, SKINS, skinById, type Skin } from '../shared/skins';
// The channel's prices (what hype costs) and its coin shop's: a machine's stage pages are drawn with them (MachinePages.stage.tips).
export { DEFAULT_PRICES, type Prices } from '../shared/prices';
export { colorPrice, DEFAULT_HOUSE_DRIP, DEFAULT_SHOP_PRICES, HOUSE_DRIP_BOUNDS, skinPrice, type HouseDrip, type ShopPrices } from '../shared/shop-prices';
export { MACHINE_API, type MachineEntryText } from './manifest';

/**
 * A body's kind, as a scene's impact hears it. The coin pusher's coins named these before it moved out (its own
 * ItemKind is in its repo); every machine's are its own words now.
 */
export type ItemKind = string;
