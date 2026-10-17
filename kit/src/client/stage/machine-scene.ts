// What the stage page (main.ts) asks of a machine's scene (docs/SPEEDWAY.md, part 2, 2026-10-09): the coin pusher's
// (scene.ts) and each machine's from machines/ (its pages' Scene, docs/MACHINE_REPOS.md) keep it, and main.ts makes
// the one its machine names from SCENES. A scene that has no use for a call (the claw has no coins to land) does
// nothing with it.
import type { ServerMsg, Vec3 } from '../../shared/protocol';
import type { StageSounds } from './audio';
import type { RenderQuality } from './frame';
import type { Look } from './looks';
import type { StageNet, Track } from './net';

/** A viewer just won `amount` coins (the "+N name (balance)" popup), at its simulation time. */
export type ScoreMsg = Extract<ServerMsg, { t: 'score' }>;

export interface MachineScene {
  /** The top of the high scores, for the city's sign. */
  setLeader(name: string | null, coins: number): void;
  /** A fresh hello: anything drawn from the last connection goes. */
  reset(): void;
  setAvatar(owner: number, url: string): void;
  popScore(text: string, color: number, x: number, fx?: string): void;
  donation(p: Vec3, tier: number, windup: number): void;
  explosion(p: Vec3): void;
  quake(seconds: number): void;
  /** A turbo: the banner the stage shows for it, if any (the coin pusher's TURBO PUSHER!). */
  turbo(seconds: number): string | void;
  setBackdrop(url: string | null): void;
  celebrate(shells: number): void;
  /** The display fonts have loaded: signs drawn with them can be painted. */
  paintSigns(): void;
  /** Things gone while the page wasn't drawing. */
  forget(tracks: Track[]): void;
  impact(kind: string, p: Vec3): void;
  /** A machine from machines/: its own message (hello's `machine`, then each 'machine' message). */
  machineMessage?(msg: unknown): void;
  /**
   * A machine that sends more than bodies (the claw: its fingers and trolley): the header of each snapshot of its own
   * type, from the first byte (the type) to where the bodies start (its snapshot's headerBytes), and its simulation
   * time, before the bodies are read.
   */
  snapshotHeader?(view: DataView, simTime: number): void;
  /**
   * Someone won coins: true when the machine makes its own sound for it (the claw: one jingle for each prize, however
   * many share it), so the stage leaves out its coin chime.
   */
  score?(msg: ScoreMsg): boolean;
  /**
   * Something just dropped in (a 'spawn'), landing at simulation time `at`; `now` is the render time. A machine with
   * landing sounds (the coin pusher's clinks) schedules them and plays them in update().
   */
  spawned?(kind: string, at: number, p: Vec3, gift: boolean, now: number): void;
  /** The page isn't drawing at render time t: anything due by then is let go, not played late. */
  paused?(t: number): void;
  /** Each frame: draw the machine at simulation time t. */
  update(net: StageNet, t: number, dt: number): void;
}

export type SceneClass = new (
  canvas: HTMLCanvasElement,
  labels: HTMLElement,
  look: Look,
  sounds: StageSounds,
  withCity: boolean,
  cityOnly: boolean,
  quality: RenderQuality,
  transparent: boolean,
) => MachineScene;
