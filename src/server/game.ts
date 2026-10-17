// The pinball game on the server. A stub: it keeps the Machine interface (kit/src/server/games/machine.ts) with empty
// bodies, so the manifest, the stand-in host and the contract test have something to make. The table, the physics and
// the rules come in later tasks.
import type { FeedItem, FeedTone, RoomInfo, ServerMsg } from '@kit/shared';
import type { Economy, Machine, MachineOutlet, StreamEvent, User } from '@kit/server';
import type { PinballMsg } from '../shared/pinball';

export class PinballGame implements Machine {
  readonly sim = { tick: 0, items: new Map<number, unknown>(), snapshot: () => Buffer.alloc(0) };
  readonly queued = 0;
  readonly stepMs = 0;
  avatarUrl: (userId: number) => string | null = () => null;

  constructor(
    readonly room: RoomInfo,
    private readonly economy: Economy,
    _out: MachineOutlet,
    _saveFile: string,
  ) {}

  load(): void {}
  save(): void {}

  hello(): ServerMsg {
    return {
      t: 'hello',
      room: this.room,
      simTime: 0,
      pusherZ: 0,
      bodies: [],
      avatars: {},
      board: this.leaderboard(),
      meter: this.economy.meterState(this.room.id),
      feed: this.recentFeed(),
      machine: this.panelState(),
    };
  }

  /** The pinball as its stage and its card get it: hello's and each 'machine' message's. */
  panelState(): PinballMsg {
    return {
      kind: 'pinball',
      state: { phase: 'idle', balls: [], line: [], multiball: false, doubleUntil: null, saverUntil: null, lockLit: false, lastResult: null, waiting: [] },
    };
  }

  leaders(): ServerMsg {
    return { t: 'leaders', leaders: [] };
  }
  leaderboard(): ReturnType<Economy['leaderboard']> {
    return [];
  }
  recentFeed(): FeedItem[] {
    return [];
  }
  handle(_ev: StreamEvent): void {}
  step(): void {}
  publish(_now: number): void {}
  pruneLimits(): void {}
  resetMachine(): void {}
  resetMeter(): void {}
  markBoardDirty(): void {}
  avatarReady(_userId: number, _url: string): void {}
  announce(_text: string, _tone: FeedTone, _user?: User): void {}
}
