// The stage's picture setting (2026-10-04, the owner's pick): how much work drawing the machine takes on the
// streamer's computer. Full is the stage as designed, drawn at three times the frame's size each way and shrunk (see
// the stage's scene.ts); a streamer whose computer struggles picks a lighter one in the control panel, and every
// stage of theirs switches straight away. Measured on an RTX 3060 against Full: Lighter (2x) about 21% less graphics
// work with slightly rougher coin edges, Lightest (1x) about 32% less with visibly jagged edges.
export type PictureQuality = 'full' | 'lighter' | 'lightest';

export const PICTURE_QUALITIES: readonly PictureQuality[] = ['full', 'lighter', 'lightest'];

/** How many times the frame's size each way the stage draws at (its RenderQuality.supersample). */
export const PICTURE_SUPERSAMPLE: Record<PictureQuality, number> = { full: 3, lighter: 2, lightest: 1 };

export function isPictureQuality(x: unknown): x is PictureQuality {
  return typeof x === 'string' && (PICTURE_QUALITIES as readonly string[]).includes(x);
}
