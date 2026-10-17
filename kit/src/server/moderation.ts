// The stream runs unattended, so anything viewers control that appears on screen is filtered here.
// Chat message text is never shown on stream; only display names are, and the messages viewers attach to gifts,
// donations and subs (see cleanMessage), which are filtered more strictly still.
import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from 'obscenity';

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
const LINK_LIKE = /(https?:|www\.|\.(com|net|org|gg|tv|io|xyz|ru|co|me|ly)\b)/i;
const MAX_NAME = 18;

export function isClean(text: string): boolean {
  return !matcher.hasMatch(text) && !LINK_LIKE.test(text);
}

function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000).toString().padStart(4, '0');
}

/** A display name that is safe to put on stream; falls back to "player1234" when the real one isn't. */
export function cleanDisplayName(raw: string, seed: string): string {
  const name = raw
    .normalize('NFKC')
    .replace(/[\p{C}<>]/gu, '')
    .replace(/^@+/, '')
    .trim()
    .slice(0, MAX_NAME);
  return name && isClean(name) ? name : `player${shortHash(seed)}`;
}

/** Longest attached message the alert card shows and the voice reads; longer ones are cut at a word with "…". */
export const MAX_MESSAGE = 140;

/**
 * A gift's or sub's attached message, made safe to show and read out on an unattended stream, or '' to leave it
 * off. Any bad word or link blocks the whole message (rather than starring words out, which the voice would read
 * around). Invisible characters go, runs of the same character are cut to three ("noooooo" is "nooo"), and long
 * messages are cut short.
 */
export function cleanMessage(raw: string | undefined): string {
  if (!raw) return '';
  let text = raw
    .normalize('NFKC')
    .replace(/[\p{C}<>]/gu, ' ')
    .replace(/(.)\1{3,}/gu, '$1$1$1')
    .replace(/\s+/g, ' ')
    .trim();
  // Nothing worth reading: only symbols, emoji or punctuation. Words spelled out letter by letter ("f u c k",
  // "s.h.i.t") are checked joined up too.
  const joined = text.replace(/(?<![\p{L}\p{N}])\p{L}(?:[\s.*_-]+\p{L}(?![\p{L}\p{N}])){2,}/gu, (run) => run.replace(/[\s.*_-]+/g, ''));
  if (!/[\p{L}\p{N}]/u.test(text) || !isClean(text) || !isClean(joined)) return '';
  if (text.length > MAX_MESSAGE) {
    const cut = text.slice(0, MAX_MESSAGE);
    const space = cut.lastIndexOf(' ');
    text = `${(space > MAX_MESSAGE * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
  }
  return text;
}

/** Remembers when each key last acted, to enforce per-user cooldowns. */
export class RateLimiter {
  private last = new Map<string, number>();

  allow(key: string, cooldownMs: number, now = Date.now()): boolean {
    if (!this.ready(key, cooldownMs, now)) return false;
    this.last.set(key, now);
    return true;
  }

  /** Whether `allow` would pass, without counting it as a use. */
  ready(key: string, cooldownMs: number, now = Date.now()): boolean {
    const prev = this.last.get(key);
    return prev === undefined || now - prev >= cooldownMs;
  }

  /** Milliseconds until `allow` would pass for this key (0 if it would now). */
  remaining(key: string, cooldownMs: number, now = Date.now()): number {
    const prev = this.last.get(key);
    return prev === undefined ? 0 : Math.max(0, prev + cooldownMs - now);
  }

  /** Forget keys idle for longer than maxAgeMs, so the map doesn't grow forever on a 24/7 stream. */
  prune(maxAgeMs: number, now = Date.now()): void {
    for (const [key, at] of this.last) if (now - at > maxAgeMs) this.last.delete(key);
  }
}
