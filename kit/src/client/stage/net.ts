// Receives the server's physics snapshots and plays them back smoothly, a fixed delay behind real time,
// interpolating between samples so motion looks fluid at any frame rate.
import { PUSHER_ID, SNAP_HEADER, SNAP_TYPE, type BodyState, type ChainBody, type ClientMsg, type ServerMsg } from '../../shared/protocol';
import { SKINS, skinById, type Skin } from '../../shared/skins';
import type { SnapshotFormat } from '../../kit/pages';
import type { MachineScene } from './machine-scene';
import { chainPieceIds, readSnapshot } from './snapshot';

/** Seconds of buffering: hides network and server-timing jitter. Viewers never notice ~0.1 s. */
const DELAY = 0.12;
const MAX_SAMPLES = 6;

interface Sample {
  t: number;
  p: [number, number, number];
  q: [number, number, number, number];
}

/**
 * ?skins=preview dresses every viewer's regular coin in one of the patterned skins (by owner), to look them over
 * on the stage without buying them; nothing changes for anyone else. ?skins=<id> puts one skin on all of them.
 */
const SKIN_PREVIEW = new URLSearchParams(location.search).get('skins');
const PREVIEW_SKINS = SKINS.filter((s) => s.pattern);
function previewSkin(body: BodyState): Skin | undefined {
  if (!SKIN_PREVIEW || body.owner === undefined || (body.kind !== 'coin' && body.kind !== 'giant')) return undefined;
  if (SKIN_PREVIEW !== 'preview') return skinById.get(SKIN_PREVIEW);
  return PREVIEW_SKINS[body.owner % PREVIEW_SKINS.length];
}

export class Track {
  despawnAt = Infinity;
  despawnReason = '';
  /** What a claw prize was worth as it went down the chute: the coins it breaks into on the stage. */
  despawnCoins = 0;
  /** The owner's animated name, for the tag over the coin (see nameFxClass). */
  fx?: string;
  /** A chain's head (its first piece; docs/CLAW_CHAINS.md): what the chain is, and where all its pieces started. */
  chain?: ChainBody;
  /** Another piece of a chain: its head's id (piece k is id + k). */
  chainOf?: number;
  readonly samples: Sample[] = [];

  constructor(
    readonly id: number,
    /** A coin in the pusher's stage; a prize in the claw machine's. */
    readonly kind: BodyState['kind'],
    readonly color: number,
    readonly spawnAt: number,
    readonly label?: string,
    /** The owner's coin skin; undefined draws the machine's own gold. */
    readonly skin?: Skin,
    /** Part of a gift, donation or sub: drawn with a trail and a heavier landing. */
    readonly gift = false,
    /** The viewer who owns it (their profile picture goes on it); undefined for the machine's own coins. */
    readonly owner?: number,
  ) {}

  push(sample: Sample): void {
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /** Interpolated position and rotation at time t, written into p and q. Returns false when not visible. */
  sampleAt(t: number, p: number[], q: number[]): boolean {
    if (t < this.spawnAt || t >= this.despawnAt) return false;
    const s = this.samples;
    if (!s.length) return false;
    let i = s.length - 1;
    while (i > 0 && s[i].t > t) i--;
    const a = s[i];
    const b = s[i + 1];
    if (!b || a.t > t) {
      p[0] = a.p[0]; p[1] = a.p[1]; p[2] = a.p[2];
      q[0] = a.q[0]; q[1] = a.q[1]; q[2] = a.q[2]; q[3] = a.q[3];
      return true;
    }
    const f = (t - a.t) / (b.t - a.t);
    for (let k = 0; k < 3; k++) p[k] = a.p[k] + (b.p[k] - a.p[k]) * f;
    // Normalized lerp along the shorter arc.
    const sign = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3] < 0 ? -1 : 1;
    let len = 0;
    for (let k = 0; k < 4; k++) {
      q[k] = a.q[k] + (b.q[k] * sign - a.q[k]) * f;
      len += q[k] * q[k];
    }
    len = Math.sqrt(len) || 1;
    for (let k = 0; k < 4; k++) q[k] /= len;
    return true;
  }
}

export interface NetHandlers {
  onHello(msg: Extract<ServerMsg, { t: 'hello' }>): void;
  /** Messages that should play at their simulation time (scores, effects) arrive here once due. */
  onTimed(msg: Extract<ServerMsg, { t: 'score' } | { t: 'fx' }>): void;
  onMessage(msg: ServerMsg): void;
  onConnection(online: boolean): void;
  /** A new item was dropped at simulation time `at` from `p`; `gift` when a gift, donation or sub dropped it. */
  onSpawn?(kind: BodyState['kind'], at: number, p: [number, number, number], gift: boolean): void;
}

type TimedMsg = Extract<ServerMsg, { t: 'score' } | { t: 'fx' }>;

/** A streamer's stage is at /s/<stage key>/stage/: the key says whose machine it shows (see server/channels.ts). */
export const channelPrefix = /^\/s\/[\w-]+(?=\/)/.exec(location.pathname)?.[0] ?? '';

export class StageNet {
  readonly tracks = new Map<number, Track>();
  /**
   * Body 0 (PUSHER_ID): the coin pusher's pusher, or a machine's own body 0 (the claw's hub). Each hello makes it
   * afresh at the hello's pusherZ, so body 0 needs no spawn: snapshots move it here, never in tracks, and a scene
   * reads it here.
   */
  pusher = new Track(PUSHER_ID, 'coin', 0, -Infinity);
  private offset = Number.NaN;
  private lastSnapT = -Infinity;
  private timed: TimedMsg[] = [];
  private ws: WebSocket | null = null;
  private visible = true;
  /** Each snapshot type read, and how many bytes its header takes: where its bodies start. */
  private readonly types: ReadonlyMap<number, number>;

  constructor(
    private readonly handlers: NetHandlers,
    private readonly room: string,
    /** The layout this page shows, so the server knows where a countdown's coin rain is seen. */
    private readonly layout = 'full',
    /** The control panel's own preview: the setup guide doesn't count it as one of the streamer's OBS sources. */
    private readonly panel = false,
    /**
     * The other machines' snapshots, besides the coin pusher's: each one's type and header bytes, from its pages
     * (snapshotOf; the claw's header carries its fingers and trolley).
     */
    snapshots: readonly SnapshotFormat[] = [],
    /** The page's machine's scene: handed the header of each snapshot of its type (MachineScene.snapshotHeader). */
    private readonly scene?: Pick<MachineScene, 'snapshotHeader'>,
    /** That machine's snapshot type: the coin pusher's, unless its pages give one of its own. */
    private readonly sceneType = SNAP_TYPE,
    /**
     * The page's link names its machine (linkPinsMachine in shared/layouts.ts), so it doesn't follow its layout's: the
     * server knows a switch of the stream can't move it.
     */
    private readonly pinned = false,
  ) {
    this.types = new Map([[SNAP_TYPE, SNAP_HEADER], ...snapshots.map((s): [number, number] => [s.type, s.headerBytes])]);
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const flags = `${this.panel ? '&panel' : ''}${this.pinned ? '&pinned' : ''}`;
    const ws = new WebSocket(`${proto}://${location.host}${channelPrefix}/ws?role=stage&room=${encodeURIComponent(this.room)}&layout=${encodeURIComponent(this.layout)}${flags}`);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      if (!this.visible) this.tellVisible();
      this.tellObs();
      this.handlers.onConnection(true);
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) this.onSnapshot(ev.data);
      else this.onJson(JSON.parse(ev.data as string) as ServerMsg);
    };
    ws.onclose = () => {
      this.handlers.onConnection(false);
      setTimeout(() => this.connect(), 1000);
    };
  }

  /**
   * Off screen (an OBS scene that isn't showing, a preview scrolled away), the server sends this page nothing; back on
   * screen, it sends everything afresh (a new hello).
   */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.tellVisible();
  }

  /** Whether OBS streams, as obs-state.ts hears it: null until it's said (outside OBS, never). */
  private obsStreaming: boolean | null = null;

  /** Tells the server whether OBS streams: YouTube's live stream is looked for only then (connectors/youtube.ts). */
  setObsStreaming(streaming: boolean): void {
    if (streaming === this.obsStreaming) return;
    this.obsStreaming = streaming;
    this.tellObs();
  }

  private tellObs(): void {
    if (this.obsStreaming === null || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'stage.obs', streaming: this.obsStreaming } satisfies ClientMsg));
  }

  private tellVisible(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'stage.visible', visible: this.visible } satisfies ClientMsg));
  }

  /** Simulation time to draw right now. */
  renderTime(nowSec: number): number {
    return Number.isNaN(this.offset) ? -Infinity : nowSec + this.offset - DELAY;
  }

  /** Hands over timed messages that are due at render time t. */
  releaseTimed(t: number): void {
    while (this.timed.length && this.timed[0].at <= t) this.handlers.onTimed(this.timed.shift()!);
  }

  /** While not drawing (a paused preview): let due effects go without playing them. */
  dropTimed(t: number): void {
    while (this.timed.length && this.timed[0].at <= t) this.timed.shift();
  }

  private noteServerTime(simT: number): void {
    const target = simT - performance.now() / 1000;
    // Jump forward immediately (a packet arrived faster than before); drift back slowly (late packets are jitter).
    if (Number.isNaN(this.offset) || target > this.offset) this.offset = target;
    else this.offset += (target - this.offset) * 0.01;
  }

  /** sampleT is when the body had this state; spawnAt is when it becomes visible (-Infinity: already there). */
  private addTrack(body: BodyState, sampleT: number, spawnAt: number, label?: string, gift = false): void {
    const track = new Track(body.id, body.kind, body.color, spawnAt, label, previewSkin(body) ?? (body.skin ? skinById.get(body.skin) : undefined), gift, body.owner);
    track.fx = body.fx;
    track.push({ t: sampleT, p: body.p, q: body.q });
    this.tracks.set(body.id, track);
    // A chain: the head carries what it is; each further piece moves as a body of its own, id + k.
    if (!body.chain) return;
    track.chain = body.chain;
    const ids = chainPieceIds(body);
    body.chain.pieces.forEach((piece, k) => {
      if (k === 0) return;
      const t = new Track(ids[k], body.kind, body.color, spawnAt);
      t.chainOf = body.id;
      t.push({ t: sampleT, p: piece.p, q: piece.q });
      this.tracks.set(ids[k], t);
    });
  }

  private onJson(msg: ServerMsg): void {
    switch (msg.t) {
      case 'hello': {
        this.tracks.clear();
        this.timed = [];
        this.offset = Number.NaN;
        this.noteServerTime(msg.simTime);
        this.lastSnapT = msg.simTime;
        this.pusher = new Track(PUSHER_ID, 'coin', 0, -Infinity);
        this.pusher.push({ t: msg.simTime, p: [0, 0.4, msg.pusherZ], q: [0, 0, 0, 1] });
        for (const body of msg.bodies) this.addTrack(body, msg.simTime, -Infinity);
        this.handlers.onHello(msg);
        return;
      }
      case 'spawn':
        this.addTrack(msg.body, msg.at, msg.at, msg.label, Boolean(msg.gift));
        this.handlers.onSpawn?.(msg.body.kind, msg.at, msg.body.p, Boolean(msg.gift));
        return;
      case 'despawn': {
        const track = this.tracks.get(msg.id);
        if (track) {
          track.despawnAt = msg.at;
          track.despawnReason = msg.reason;
          track.despawnCoins = msg.coins ?? 0;
          // A chain's other pieces go with it.
          for (const id of chainPieceIds(track).slice(1)) {
            const piece = this.tracks.get(id);
            if (!piece) continue;
            piece.despawnAt = msg.at;
            piece.despawnReason = msg.reason;
          }
        }
        return;
      }
      case 'score':
      case 'fx':
        this.timed.push(msg);
        this.timed.sort((a, b) => a.at - b.at);
        return;
      default:
        this.handlers.onMessage(msg);
    }
  }

  private onSnapshot(buf: ArrayBuffer): void {
    // The coin pusher's, or another machine's read past its own header (types); a type nobody named is left alone.
    const snap = readSnapshot(buf, this.types);
    if (!snap) return;
    const t = snap.simTime;
    const prevT = this.lastSnapT;
    // The machine's own part first (the claw's fingers and trolley), then its bodies. Another machine's header (sent to
    // a page on its way to that machine) isn't the scene's to read.
    if (snap.type === this.sceneType) this.scene?.snapshotHeader?.(snap.header, t);
    for (const body of snap.bodies) {
      const track = body.id === PUSHER_ID ? this.pusher : this.tracks.get(body.id);
      if (!track) continue;
      const last = track.samples[track.samples.length - 1];
      // A body that was resting (absent from recent snapshots) starts moving now, not back when it came to rest.
      if (last && last.t < prevT) track.push({ t: prevT, p: last.p, q: last.q });
      track.push({ t, p: body.p, q: body.q });
    }
    this.lastSnapT = t;
    this.noteServerTime(t);
  }

  /** Drops tracks whose despawn time has passed; returns them so the scene can play exit effects. */
  collectDespawned(t: number): Track[] {
    const gone: Track[] = [];
    for (const track of this.tracks.values()) {
      if (track.despawnAt <= t) {
        gone.push(track);
        this.tracks.delete(track.id);
      }
    }
    return gone;
  }
}
