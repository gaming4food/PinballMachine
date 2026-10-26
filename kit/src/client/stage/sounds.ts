// The stage's own sound files, picked on the soundboard (npm run soundboard): for each moment the stage makes a sound
// (StageAudio's, in audio.ts), the files it plays and how loud. A moment with no pick, or whose files haven't loaded,
// plays its synth, at its pick's volume if it has one.
import type { Pick } from './samples';

/** Every moment the stage makes a sound: the coin pusher's, the gifts' and the alerts'. */
export type StageMoment =
  | 'clink' | 'tray' | 'trayOwned' | 'winSmall' | 'winMedium' | 'winBig' | 'explosion' | 'fuse'
  | 'impactGold' | 'impactGiant' | 'impactBomb' | 'quake' | 'turbo' | 'fanfare' | 'jingle' | 'donation';

// Made by npm run sounds:apply from the soundboard's picks of 2026-10-17T04:01:10-04:00. Pick again there, not here.
/** The picks, each file served from /media/sfx/. */
export const STAGE_SOUNDS: Partial<Record<StageMoment, Pick>> = {
  clink: { files: [], volume: 1 },
  tray: { files: [], volume: 1 },
  trayOwned: { files: [], volume: 1 },
  winSmall: { files: [], volume: 1 },
  winMedium: { files: ['/media/sfx/winMedium-1.ogg'], volume: 1 },
  winBig: { files: [], volume: 1 },
  explosion: { files: ['/media/sfx/explosion-1.ogg'], volume: 1 },
  fuse: { files: [], volume: 1 },
  impactGold: { files: [], volume: 1 },
  impactGiant: { files: [], volume: 1 },
  impactBomb: { files: [], volume: 1 },
  quake: { files: [], volume: 1 },
  turbo: { files: [], volume: 1 },
  fanfare: { files: ['/media/sfx/fanfare-1.ogg'], volume: 1 },
  jingle: { files: [], volume: 1 },
  donation: { files: [], volume: 1 },
};

/** A win's sound, by its size: under 10 coins small, 10 to 99 medium, 100 and up big. */
export function winMoment(amount: number): 'winSmall' | 'winMedium' | 'winBig' {
  return amount >= 100 ? 'winBig' : amount >= 10 ? 'winMedium' : 'winSmall';
}
