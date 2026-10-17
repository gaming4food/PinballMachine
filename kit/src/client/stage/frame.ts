// The stage's frame and how hard each frame is drawn: the 1920 x 1080 page, and the full and light render settings.
// Kept apart from the coin pusher's scene (scene.ts) so a machine's scene can use them through the kit (src/kit/stage.ts)
// without pulling the coin pusher in.

export const WIDTH = 1920;
export const HEIGHT = 1080;

/** How much work each frame takes. OBS gets full quality; the control panel's preview gets the light version. */
export interface RenderQuality {
  /** Fraction of 1920x1080 in the canvas; the picture is scaled up to fill the frame. */
  scale: number;
  shadows: boolean;
  /** Multisampling (edge smoothing) samples; 0 turns it off. */
  msaa: number;
  /**
   * Supersampling (see supersample.ts): the scene is drawn this many times the canvas's size each way and shrunk
   * back down, which smooths every edge, the coins' face relief included; 1 turns it off.
   */
  supersample: number;
  /** Adds the bloom's glow over the drawing in a full-size pass of its own, as before 2026-10-04 (?glow=separate). */
  separateGlow?: boolean;
}

/**
 * Drawn at 5760x3240 and shrunk to 1920x1080: 9 samples for every pixel, so the coin faces' artwork and shine come
 * out crisper (your pick 2026-10-01 from a side-by-side, with the coins' flat edges kept). It was 3840x2160 with 4x
 * multisampling on top, whose multisampling alone cost about 5 ms of the RTX 3060's time a frame: this measured
 * 5.8 ms idle and 6.3 ms in a Coin Rain against 8.4 and 9.2. `?ss=2&msaa=4` brings the old setting back.
 */
export const FULL_QUALITY: RenderQuality = { scale: 1, shadows: true, msaa: 0, supersample: 3 };
/** Roughly a tenth of the GPU work of 1080p without supersampling at the preview's frame rate: a quarter of the pixels, no shadows or smoothing. */
export const LIGHT_QUALITY: RenderQuality = { scale: 0.5, shadows: false, msaa: 0, supersample: 1 };
