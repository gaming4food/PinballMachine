// Fake chat for testing without any platform accounts: a bot audience plus manual test events
// from the control panel. Simulated viewers get ids starting with "sim:" so they can be purged later.
// The bots race too (docs/SPEEDWAY.md section 9): now and then one types join, and drives for the next four minutes,
// mostly gas with some steering, the odd back or use item. Their driving comes out of the same lines a second, so the
// rate holds; every machine hears their words, as it hears real chat.
import type { Platform, SimEvent } from '../../shared/protocol';
import { TEST_VIEWER_ID } from '../economy';
import type { EventBus } from '../events';
import { MACHINE_LIST, type MachineEntry } from '../../shared/machine-list';

const FIRST = ['Pixel', 'Neon', 'Token', 'Arcade', 'Glitch', 'Synth', 'Joystick', 'Quarter', 'HiScore', 'Bit', 'Retro', 'Laser', 'Tilt', 'Pinball', 'Chiptune', 'Turbo', 'Mega', 'PowerUp', 'Bonus', 'Cabinet'];
const LAST = ['Pete', 'Nova', 'Tina', 'Andy', 'Gabe', 'Sally', 'Jay', 'Queen', 'Hal', 'Bandit', 'Raven', 'Kai', 'Liz', 'Tony', 'Pam', 'Cody', 'Grace', 'Marco', 'Pia', 'Bea'];
const LINES = ['lets goooo', 'first time here', 'this is so satisfying', 'push push push', 'come on fall!!', 'W stream', 'which coin is mine', 'gg', 'hi chat', 'LETS GO', 'one more coin', 'so close', 'lol', 'neon vibes', 'love this'];
// Bots from every platform play the same machines, as real viewers do.
const PLATFORMS: Platform[] = ['twitch', 'youtube', 'youtube', 'kick'];
/** How long a bot that joined keeps driving, in seconds of the simulator's own clock: its race, or the next one. */
const RACING_SECONDS = 240;
/** While bots race, the share of the lines a second that are one of them driving; the rest are the usual chat. */
const DRIVING_SHARE = 0.75;

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A machine's lines for the fake audience (its entry's bots): what a bot types to take part, then while playing. */
export interface BotLines {
  join: string;
  play: readonly string[];
}

/**
 * Every machine's bot lines, from the machine list. Each is read as a MachineEntry: the list's own type has only what
 * its machines have, so in a machine repo whose machine has no bots, `m.bots` wouldn't typecheck.
 */
export const defaultBotLines = (): BotLines[] => MACHINE_LIST.flatMap((m: MachineEntry) => (m.bots ? [{ join: m.bots.join, play: [...m.bots.play] }] : []));

interface FakeViewer {
  platform: Platform;
  userId: string;
  name: string;
}

export class ChatSimulator {
  enabled = false;
  /** Bot messages per second. */
  rate = 3;
  private acc = 0;
  private readonly viewers: FakeViewer[] = [];
  /** The simulator's own clock (each tick's dt, added up), and the bots racing until when on it. */
  private clock = 0;
  private readonly racing = new Map<FakeViewer, { until: number; play: readonly string[] }>();

  constructor(
    private readonly bus: EventBus,
    /** The machines' own lines (their entries' bots), for the bots that take part in one. */
    private readonly botLines: BotLines[] = defaultBotLines(),
  ) {
    for (let i = 0; i < 60; i++) {
      const suffix = Math.random() < 0.3 ? String(Math.floor(Math.random() * 99)) : '';
      this.viewers.push({ platform: pick(PLATFORMS), userId: `sim:bot-${i}`, name: `${pick(FIRST)}${pick(LAST)}${suffix}` });
    }
  }

  tick(dt: number): void {
    if (!this.enabled || this.rate <= 0) return;
    this.clock += dt;
    for (const [v, { until }] of this.racing) if (this.clock >= until) this.racing.delete(v);
    this.acc += this.rate * dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (this.racing.size && Math.random() < DRIVING_SHARE) {
        const [v, { play }] = pick([...this.racing]);
        this.bus.emit({ kind: 'chat', ...v, text: pick(play) });
      } else this.botEvent();
    }
  }

  private botEvent(): void {
    const v = pick(this.viewers);
    const r = Math.random();
    if (r < 0.05) return this.bus.emit({ kind: 'chat', ...v, text: `!drop ${3 + Math.floor(Math.random() * 12)}` });
    if (r < 0.09) return this.bus.emit({ kind: 'chat', ...v, text: pick(['left', 'right', 'center']) });
    if (r < 0.093) return this.bus.emit({ kind: 'follow', ...v });
    if (r < 0.095) {
      const cents = pick([10, 50, 100, 500]);
      return this.bus.emit({ kind: 'gift', ...v, usdCents: cents, label: `a $${(cents / 100).toFixed(2)} gift` });
    }
    if (r < 0.125 && this.botLines.length) {
      const lines = pick(this.botLines);
      this.racing.set(v, { until: this.clock + RACING_SECONDS, play: lines.play });
      return this.bus.emit({ kind: 'chat', ...v, text: lines.join });
    }
    this.bus.emit({ kind: 'chat', ...v, text: pick(LINES) });
  }

  /** `streamer`: sent as the channel's owner, to try the streamer's own commands (!rain and the like). */
  sendChat(name: string, platform: Platform, text: string, streamer = false): void {
    this.bus.emit({ kind: 'chat', ...this.manualViewer(name, platform), text, streamer });
  }

  /** `message`: what a test gift or sub says, as a viewer's attached message would (filtered like the real ones). */
  sendEvent(name: string, platform: Platform, event: SimEvent, amount = 0, message = ''): void {
    const v = this.manualViewer(name, platform);
    switch (event) {
      case 'follow':
        return this.bus.emit({ kind: 'follow', ...v });
      case 'sub':
        return this.bus.emit({ kind: 'sub', ...v, months: 1, amount: 'New sub', what: 'Test sub', says: 'just subscribed', message });
      case 'gift': {
        const cents = amount > 0 ? amount : 100;
        const dollars = `$${(cents / 100).toFixed(2)}`;
        // A test StreamElements tip reads like a real one.
        if (platform === 'tips') return this.bus.emit({ kind: 'gift', ...v, usdCents: cents, label: `a ${dollars} tip`, amount: dollars, what: 'Test tip', says: `tipped ${dollars}`, message });
        return this.bus.emit({ kind: 'gift', ...v, usdCents: cents, label: `a ${dollars} gift`, amount: dollars, what: 'Test gift', says: `sent ${dollars}`, message });
      }
      case 'raid':
        return this.bus.emit({ kind: 'raid', ...v, viewers: amount > 0 ? amount : 25 });
      case 'like':
        return this.bus.emit({ kind: 'like', ...v, count: amount > 0 ? amount : 50 });
    }
  }

  /**
   * The Test card's first button: the test viewer, who never reaches a leaderboard (see Economy's TEST_VIEWER_ID), types
   * its machine's own line (testChat in shared/machine-list.ts: a coin on the coin pusher, a drop on the claw).
   */
  testChat(platform: Platform, text: string): void {
    this.bus.emit({ kind: 'chat', ...this.testViewer(platform), text, streamer: false });
  }

  /** A $5 alert from the test viewer: the card, the voice and its coins, as a real one. */
  testAlert(platform: Platform): void {
    this.bus.emit({ kind: 'gift', ...this.testViewer(platform), usdCents: 500, label: 'a $5.00 test gift', amount: '$5.00', what: 'Test gift', says: 'sent $5.00', message: 'This is a test alert. Looking good!' });
  }

  private testViewer(platform: Platform): FakeViewer {
    return { platform, userId: TEST_VIEWER_ID, name: 'TestViewer' };
  }

  private manualViewer(name: string, platform: Platform): FakeViewer {
    const clean = name.trim().slice(0, 25) || 'TestViewer';
    return { platform, userId: `sim:manual-${clean.toLowerCase()}`, name: clean };
  }
}
