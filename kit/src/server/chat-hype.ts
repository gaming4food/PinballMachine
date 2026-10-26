// Chat buys a machine's hype (docs/superpowers/specs/2026-10-12-chat-hype-design.md). A viewer types a word a machine sells
// as the first word of a chat line. If that machine is on stream and its switch is on, the city checks the two waits and
// the viewer's coins, takes the price, and asks the machine to press the button (Machine.buyHype). The machine can say no,
// and then the coins go straight back. Replies go in the selling machine's feed. One for each channel. It names no
// machine: what is for sale comes from the machines' entries (shared/hype-sale.ts). Tested by npm run chat-hype-test.
import { hypeWord, itemForWord, type HypeItem } from '../shared/hype-sale';
import type { Platform } from '../shared/protocol';
import type { Economy, User } from './economy';
import type { HypePurchase, Machine } from './games/machine';
import { RateLimiter } from './moderation';

/** One bought hype on a machine, then the next: 20 seconds. */
export const HYPE_MACHINE_WAIT_MS = 20_000;
/** One bought hype for a viewer, on any machine, then the next: a minute. */
export const HYPE_VIEWER_WAIT_MS = 60_000;
/** A reply to a viewer, at most this often for each kind of reply, so chat can't flood a machine's feed. */
export const HYPE_REPLY_EVERY_MS = 30_000;

export interface ChatHypeDeps {
  economy: Economy;
  /** Everything for sale (shared/hype-sale.ts). */
  items: readonly HypeItem[];
  /** What an item costs right now, in coins. A price of 0 is free. */
  price(item: HypeItem): number;
  /** Whether chat can buy from this machine: the streamer's switch. */
  saleOn(room: string): boolean;
  /** The machines on stream that a viewer on this platform plays, by room id. */
  onStream(platform: Platform): readonly string[];
  /** The machine in this room, if it's made on this channel. */
  machine(room: string): Machine | undefined;
  /**
   * A sale went through (a free one too, when no coins moved), or coins went back to a viewer: every machine's high-score
   * board needs sending again.
   */
  boardChanged(): void;
}

export class ChatHype {
  /** The machines' waits, the viewers' waits, and when each viewer was last answered. */
  private readonly limiter = new RateLimiter();

  constructor(private readonly deps: ChatHypeDeps) {}

  /**
   * A chat line from a viewer the machines have already met. True when its first word is for sale on a machine on stream
   * with its switch on, whatever happened next: a wait, too few coins, a no from the machine, or a sale. Any other line
   * is false, and nothing happens: no reply, and no charge. A machine that falls over gives the coins back, and its error
   * goes on to the caller.
   */
  handle(user: User, text: string): boolean {
    const { economy } = this.deps;
    const word = hypeWord(text);
    const item = word === null ? undefined : itemForWord(word, this.deps.items);
    if (!item || !this.deps.onStream(user.platform).includes(item.room) || !this.deps.saleOn(item.room)) return false;
    const machine = this.deps.machine(item.room);
    if (!machine?.buyHype) return false;
    const now = Date.now();

    // The waits: the machine's, since the last hype bought on it, and the viewer's, since their last on any machine. The
    // longer one is the one told. An item with no waits (noWait) has none, and starts none (below).
    const wait = item.noWait
      ? 0
      : Math.max(
          this.limiter.remaining(`hype:${item.room}`, HYPE_MACHINE_WAIT_MS, now),
          this.limiter.remaining(`hype-viewer:${user.id}`, HYPE_VIEWER_WAIT_MS, now),
        );
    if (wait > 0) {
      this.reply(machine, user, 'wait', `${user.name}: the next hype can be bought in ${Math.ceil(wait / 1000)} s`, now);
      return true;
    }

    // The coins. A price of 0 is free: nothing is taken, and the hype still happens. A viewer who buys free (the owner's
    // own account on their channel) passes canAfford and spend without paying. If spend says no, the hype doesn't go on.
    // What was paid is what the balance really lost, just before spend and just after it: 0 for a free buy. So a refund
    // can never give back coins that were not taken.
    const price = this.deps.price(item);
    let paid = 0;
    if (price > 0) {
      const before = user.balance;
      if (!(economy.canAfford(user, price, 'hype') && economy.spend(user, price, 'hype'))) {
        this.reply(machine, user, 'coins', `${user.name} needs ${price} coins for ${item.what}`, now);
        return true;
      }
      paid = before - user.balance;
    }

    // Any coins are taken, so a refund always follows a charge. It happens once, whoever asks: the machine, if the hype
    // can't go ahead after all, or the city, if the machine says no. It says whether coins went back, so a machine's
    // line never tells of coins that didn't move. The city's own calls below don't need the answer.
    let refunded = false;
    const purchase: HypePurchase = {
      user,
      paid,
      refund: () => {
        if (refunded) return false;
        refunded = true;
        // Nothing for a free buy. Nothing for a viewer the streamer has removed since, either: their record stays gone,
        // and nobody else is paid instead.
        if (paid <= 0 || economy.get(user.id) !== user) return false;
        // What came back is what the balance really gained, as `paid` is what it really lost. The boards hear of it
        // only when coins went back.
        const before = user.balance;
        economy.refund(user, paid, 'hype');
        if (user.balance <= before) return false;
        this.deps.boardChanged();
        return true;
      },
    };

    let reason: string | null;
    try {
      reason = machine.buyHype(item.id, purchase);
    } catch (err) {
      // A machine that falls over must not keep the coins. The problem isn't hidden: the event bus logs it.
      purchase.refund();
      throw err;
    }
    if (reason !== null) {
      // No wait starts for a hype that didn't happen.
      purchase.refund();
      this.reply(machine, user, 'refused', `${user.name}: ${reason}`, now);
      return true;
    }
    if (!item.noWait) {
      this.limiter.allow(`hype:${item.room}`, HYPE_MACHINE_WAIT_MS, now);
      this.limiter.allow(`hype-viewer:${user.id}`, HYPE_VIEWER_WAIT_MS, now);
    }
    this.deps.boardChanged();
    return true;
  }

  /** Forgets whatever has been idle for longer than the longest wait, so the lists don't grow forever on a 24/7 stream. */
  prune(): void {
    this.limiter.prune(HYPE_VIEWER_WAIT_MS);
  }

  /** A line in the machine's feed answering one viewer, at most every 30 seconds for each kind of line. */
  private reply(machine: Machine, user: User, kind: 'wait' | 'coins' | 'refused', text: string, now: number): void {
    if (this.limiter.allow(`hype-${kind}:${user.id}`, HYPE_REPLY_EVERY_MS, now)) machine.announce(text, 'info', user);
  }
}
