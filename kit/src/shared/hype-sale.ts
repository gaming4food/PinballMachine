// What chat can buy (docs/superpowers/specs/2026-10-12-chat-hype-design.md): every machine's hype buttons that are for
// sale, listed from the machines' entries, and a chat message's hype word. Also what the control panel, the admin page and
// the stage draw from them: the Prices card's groups, the captions under the hype buttons and How to Play's lines. It's
// pure and names no machine: what a machine sells is in its own entry (MachineEntryText.hype). Tested by npm run
// hype-sale-test, and each machine's words by npm run machines-test.
import { isRoomId, MACHINE_LIST, machineEntry, type MachineEntry } from './machine-list';
// Types only: prices.ts reads HYPE_ITEMS from here, so a real import back would be a cycle.
import type { PriceLimits, Prices } from './prices';

/** One hype button that chat can buy, with the machine it belongs to. */
export interface HypeItem {
  /** `<room>.<id>`: what its price is saved under. */
  key: string;
  /** The machine's room id, and the button's id in that machine (what the machine reads in a press). */
  room: string;
  id: string;
  /** What viewers type, without the `!`: the first of `words`, the one shown (captions, How to Play). */
  word: string;
  /** Every word that buys it. */
  words: readonly string[];
  /** The button's name and its symbol, as the panel draws them. */
  label: string;
  icon: string;
  /** What a reply calls it: "an extra finger". */
  what: string;
  /** Its price to start with, in coins. Each streamer can change it, inside the owner's limits. */
  price: number;
  /** The owner's starting limits on the price, in coins. The owner can change them. */
  limits: { min: number; max: number };
  /** Bought with no waits (HypeSale.noWait). Left out for the usual waits. */
  noWait?: true;
}

/**
 * The hype buttons for sale in `entries`, one item each: the entries in their order, then each one's buttons in theirs.
 * A button without a sale is left out, and so is a machine with no hype. The entries are typed MachineEntry, whose `hype`
 * is optional: the machine list's own types may have none (in a machine's repo the list holds just its entry).
 */
export function hypeItems(entries: readonly MachineEntry[]): HypeItem[] {
  const items: HypeItem[] = [];
  for (const entry of entries) {
    for (const button of entry.hype ?? []) {
      const { sale } = button;
      if (!sale) continue;
      items.push({
        key: `${entry.id}.${button.id}`,
        room: entry.id,
        id: button.id,
        word: sale.words[0],
        // Copies, so nothing that changes an item can reach the machine's entry.
        words: [...sale.words],
        label: button.label,
        icon: button.icon,
        what: sale.what,
        price: sale.price,
        limits: { ...sale.limits },
        ...(sale.noWait ? { noWait: true as const } : {}),
      });
    }
  }
  return items;
}

/** Everything for sale, across the machines on the list. */
export const HYPE_ITEMS: readonly HypeItem[] = hypeItems(MACHINE_LIST);

/**
 * The words the city and the coin pusher answer already. Every machine hears every chat line, so a hype word that is one
 * of these would set off both. No machine can sell them: machines-test checks each machine's words against this list.
 * When a command, or another spelling of one, is added to one of these places, add its words here too.
 */
export const TAKEN_WORDS: ReadonlySet<string> = new Set([
  // The coin pusher's own commands (its game, from gaming4food/CoinPusher): !drop and !skin.
  'drop', 'skin', 'skins',
  // Its streamer drops, with every spelling it reads (its game's STREAMER_COMMANDS). A viewer
  // who earned one can type them too.
  'rain', 'coinrain', 'goldrush', 'jackpot', 'barrage', 'bombs', 'bombbarrage',
  // The city's own commands (server/city-services.ts): !coins, !color, !stats, !fireworks and !skip.
  'coins', 'balance', 'bal', 'color', 'colors', 'colour', 'colours', 'stats', 'career', 'me', 'fireworks', 'firework', 'fw', 'skip',
]);

const HYPE_WORD = /^!([a-z]+)\b/i;

/**
 * A chat line's hype word: its first word, when that's a `!` and then letters, ending there. Shouting and punctuation
 * after it are fine ("!SHAKE!!!"). Lowercase, without the `!`. Any other line gives null, so "shake", "please !shake" and
 * "!shake2" buy nothing.
 */
export function hypeWord(text: string): string | null {
  return HYPE_WORD.exec(text.trim())?.[1].toLowerCase() ?? null;
}

/** The item a word buys, or undefined. The word is as hypeWord gives it: lowercase. */
export function itemForWord(word: string, items: readonly HypeItem[] = HYPE_ITEMS): HypeItem | undefined {
  return items.find((item) => item.words.includes(word));
}

/** A machine's name, from its entry. A room the list doesn't know is named by its id. */
export function machineLabel(room: string): string {
  return isRoomId(room) ? machineEntry(room).label : room;
}

/** One button on the Prices card: its word and name, its price now, and the owner's limits on it, all in coins. */
export interface HypeRow {
  key: string;
  word: string;
  label: string;
  price: number;
  min: number;
  max: number;
}

/** One machine's hype on the Prices card: its heading, whether chat can buy from it (the streamer's switch), and its rows. */
export interface HypeGroup {
  room: string;
  title: string;
  on: boolean;
  rows: HypeRow[];
}

/**
 * The Prices card's hype: a group for each machine with something for sale, in the order the items come, and a row in it
 * for each of that machine's buttons. A row's price and limits are the prices' and the limits', else the item's own. A
 * price of 0 is a price, not a missing one. Every machine's group is there, whichever machine is on stream and whether or
 * not its switch is on, so prices can be set before going live. Given `rooms` (the panel's: the machines made on its
 * copy, rooms.ts machinesMade), only those machines' groups are, still in the items' order.
 */
export function hypeGroups(prices: Prices, limits: PriceLimits, items: readonly HypeItem[] = HYPE_ITEMS, rooms?: readonly string[]): HypeGroup[] {
  const groups = new Map<string, HypeGroup>();
  for (const item of items) {
    if (rooms && !rooms.includes(item.room)) continue;
    let group = groups.get(item.room);
    if (!group) {
      group = { room: item.room, title: `${machineLabel(item.room)} hype`, on: !prices.hypeOff.includes(item.room), rows: [] };
      groups.set(item.room, group);
    }
    const range = limits.hype[item.key] ?? item.limits;
    group.rows.push({ key: item.key, word: item.word, label: item.label, price: prices.hype[item.key] ?? item.price, min: range.min, max: range.max });
  }
  return [...groups.values()];
}

/**
 * The small print under a hype button on the control panel: the word chat types and the price it pays, "!word · 30 coins",
 * with the price in en-US digits. While the machine's switch is off it says chat can't buy. The streamer's own press is
 * free either way.
 */
export function hypeCaption(item: HypeItem, prices: Prices): string {
  if (prices.hypeOff.includes(item.room)) return "chat can't buy";
  return `!${item.word} · ${(prices.hype[item.key] ?? item.price).toLocaleString('en-US')} coins`;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * How to Play's hype lines for a machine, as HTML: "<b>!finger</b> buys an extra finger (50 coins)", one for each of its
 * items in order, with the price now (the prices', else the item's own, in en-US digits). None while the machine's switch
 * is off, and none for a machine that sells nothing. The stage puts each line in the page as HTML, so what a sale buys is
 * escaped. A word is letters only (machines-test), and a price is a number.
 */
export function hypeLines(room: string, prices: Prices, items: readonly HypeItem[] = HYPE_ITEMS): string[] {
  if (prices.hypeOff.includes(room)) return [];
  return items
    .filter((item) => item.room === room)
    .map((item) => `<b>!${item.word}</b> buys ${escapeHtml(item.what)} (${(prices.hype[item.key] ?? item.price).toLocaleString('en-US')} coins)`);
}
