// The pinball's own sound files, to be picked on coin-op-city's soundboard (npm run soundboard there), as the claw's
// are: for each moment the pinball makes a sound (PinballVoice's, in pinball-sounds.ts), the files it plays and how
// loud. None is picked yet, so every moment plays its synth. A moment with no pick, or whose files haven't loaded,
// plays its synth, at its pick's volume if it has one.

/** Every moment the pinball makes a sound. */
export type PinballMoment = 'flip' | 'bumper' | 'sling' | 'target' | 'rise' | 'door' | 'gate' | 'drain' | 'launch' | 'multiball' | 'saved';

/**
 * Each moment's files and how loud they play: 1 plays a file as it is, and the synth at its usual level. Several files
 * take turns; none keeps the synth, at this volume.
 */
export type PinballPicks = Partial<Record<PinballMoment, { files: readonly string[]; volume: number }>>;

/** The picks. Each file would be in src/assets/sounds/, imported so Vite serves it. None yet: each plays its synth. */
export const PINBALL_SOUNDS: PinballPicks = {
  flip: { files: [], volume: 1 },
  bumper: { files: [], volume: 1 },
  sling: { files: [], volume: 1 },
  target: { files: [], volume: 1 },
  rise: { files: [], volume: 1 },
  door: { files: [], volume: 1 },
  gate: { files: [], volume: 1 },
  drain: { files: [], volume: 1 },
  launch: { files: [], volume: 1 },
  multiball: { files: [], volume: 1 },
  saved: { files: [], volume: 1 },
};
