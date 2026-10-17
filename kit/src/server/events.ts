// Every platform connector turns its chat, gifts and follows into these events, so games never see
// platform-specific details.
import type { Platform } from '../shared/protocol';
import { log } from './log';

interface Base {
  platform: Platform;
  /** The platform's stable user id (not the display name, which can change). */
  userId: string;
  name: string;
  /** Where the platform keeps their profile picture, when the event says. */
  avatar?: string;
}

/**
 * How the big card on the stage, and its voice, describe a gift, donation or sub (see CoinPusherGame.alert).
 * Connectors fill in what their platform says; anything left out falls back to the event's label.
 */
interface Support {
  /** The big line on the card, e.g. "$20.00", "500 bits", "5 subs". */
  amount?: string;
  /** The small line under it, e.g. "Super Chat", "Cheer", "Gifted subs". */
  what?: string;
  /** What the voice says they did, after their name, e.g. "sent $20.00", "cheered 500 bits". */
  says?: string;
  /** The message they attached, raw from the platform: it is filtered before it is shown or read out. */
  message?: string;
}

export type StreamEvent =
  /** `streamer`: sent by the channel's owner, who can set off the streamer drops (see CoinPusherGame.streamerDrop). */
  | (Base & { kind: 'chat'; text: string; streamer?: boolean })
  | (Base & { kind: 'follow' })
  | (Base & { kind: 'sub'; months?: number } & Support)
  | (Base & { kind: 'gift'; usdCents: number; label: string } & Support)
  | (Base & { kind: 'raid'; viewers: number })
  | (Base & { kind: 'like'; count: number })
  /** Only tells where a viewer's profile picture is, for platforms that look it up separately (Twitch, Kick). */
  | (Base & { kind: 'profile'; avatar: string });

type Handler = (ev: StreamEvent) => void;

export class EventBus {
  private handlers: Handler[] = [];

  on(handler: Handler): void {
    this.handlers.push(handler);
  }

  emit(ev: StreamEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(ev);
      } catch (err) {
        log.error('event handler failed', ev.kind, err);
      }
    }
  }
}
