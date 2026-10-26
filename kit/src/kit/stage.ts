// The kit's stage door (docs/MACHINE_REPOS.md section 2): what a machine's stage side may use of Coin-Op City's stage.
export type { MachineScene, SceneClass, ScoreMsg } from '../client/stage/machine-scene';
export type { StageNet, Track } from '../client/stage/net';
export { City } from '../client/stage/city';
export { FrameSizeBloomPass, SupersampleOutputPass } from '../client/stage/supersample';
export type { Look } from '../client/stage/looks';
export type { StageSounds, StageSynth } from '../client/stage/audio';
export { FULL_QUALITY, HEIGHT, LIGHT_QUALITY, type RenderQuality, WIDTH } from '../client/stage/frame';
export { neonEnvironment } from '../client/stage/environment';
export { INVERSE_ACES_GLSL, pictureUniforms } from '../client/stage/photo';
export { cssColor, nameFxClass } from '../client/common';
export { definePages, type MachineOverlay, type MachinePages, type OverlayFactory, type SnapshotFormat } from './pages';
