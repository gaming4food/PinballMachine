// Visual presets for the stage. Pick one with ?look=<name> in the stage URL.
// Later these become machine themes that community milestones can unlock.

export interface Look {
  label: string;
  background: number;
  exposure: number;
  envIntensity: number;
  /** Brightness of the panels in the reflection environment (what shiny metal "sees"). */
  env: { top: number; pink: number; cyan: number; warm: number; violet: number };
  hemi: number;
  key: number;
  accents: number;
  bloom: { strength: number; radius: number; threshold: number };
  tubes: number;
  /** Playfield grid colors; glow > 0 makes the grid lines emit light. */
  floor: { base: string; line: string; dot: string; glow: number };
  coin: { color: number; roughness: number; bump: number; goldGlow: number };
  /**
   * Owner marker on each coin face, and how bright it is (house <= 0 hides it): a ring, a center dot, or an inlay (a
   * big disc of colored enamel set into the face, like a poker chip, with a dark groove around it so the color
   * stands out against the gold). `houseLogo` (an inlay only): a picture set into the house coins instead, as bright
   * as `house`.
   */
  marker: { shape: 'ring' | 'dot' | 'inlay'; inner: number; outer: number; owned: number; house: number; houseLogo?: string };
  /**
   * 'steel': the stainless-steel machine (steel.ts). 'photo': the concept picture, with the coins drawn over it
   * (photo.ts). Otherwise the original dark cabinet with a grid floor.
   */
  machine?: 'steel' | 'photo';
}

export const LOOKS: Record<string, Look> = {
  neon: {
    label: 'Neon (first version)',
    background: 0x07040f,
    exposure: 1.05,
    envIntensity: 0.75,
    env: { top: 1.8, pink: 2.5, cyan: 2.5, warm: 1.6, violet: 1.2 },
    hemi: 0.7,
    key: 700,
    accents: 60,
    bloom: { strength: 0.6, radius: 0.5, threshold: 1.1 },
    tubes: 3.2,
    floor: { base: '#120a22', line: '#2a1b4d', dot: '#4a3590', glow: 0 },
    coin: { color: 0xffc23a, roughness: 0.36, bump: 2, goldGlow: 0.45 },
    marker: { shape: 'ring', inner: 0.33, outer: 0.39, owned: 1.5, house: 0.6 },
  },
  gold: {
    label: 'Gold Rush',
    background: 0x06050a,
    exposure: 1.05,
    envIntensity: 1.2,
    env: { top: 3.2, pink: 1.2, cyan: 1.2, warm: 3.0, violet: 0.6 },
    hemi: 0.55,
    key: 850,
    accents: 25,
    // High threshold: coin highlights stay crisp; only the neon tubes and sparks bloom.
    bloom: { strength: 0.2, radius: 0.3, threshold: 2.2 },
    tubes: 3.4,
    floor: { base: '#07070c', line: '#16162a', dot: '#262645', glow: 0 },
    // Soft enough that highlights spread over a few pixels instead of glinting pixel by pixel (2026-09-29).
    coin: { color: 0xf2b541, roughness: 0.32, bump: 2.4, goldGlow: 0.12 },
    // An inlay: the thin ring this look had (2026-09-29) was too thin to tell viewers' colors apart (2026-09-30).
    // House coins carry the Coin-Op City logo (2026-09-30): since 2026-10-04 the gold towers of the brand kit's badge,
    // without its ring (the coin's own rim does that job). ?v= changes with the picture, so pages fetch it afresh.
    marker: { shape: 'inlay', inner: 0, outer: 0.31, owned: 1.1, house: 1.15, houseLogo: '/media/coins/house-logo.png?v=2' },
  },
  hyper: {
    label: 'Hyper Neon',
    background: 0x0b0418,
    exposure: 0.95,
    envIntensity: 0.85,
    env: { top: 1.4, pink: 3.2, cyan: 3.2, warm: 1.0, violet: 2.0 },
    hemi: 0.75,
    key: 600,
    accents: 80,
    bloom: { strength: 0.75, radius: 0.55, threshold: 1.0 },
    tubes: 3.8,
    floor: { base: '#12061f', line: '#ff2bd6', dot: '#22e6ff', glow: 0.35 },
    coin: { color: 0xffd34d, roughness: 0.32, bump: 2, goldGlow: 0.6 },
    marker: { shape: 'ring', inner: 0.28, outer: 0.4, owned: 2.0, house: 0.6 },
  },
  clean: {
    label: 'Clean Arcade',
    background: 0x0a0d1a,
    exposure: 1.15,
    envIntensity: 1.0,
    env: { top: 2.2, pink: 1.4, cyan: 1.4, warm: 1.8, violet: 0.8 },
    hemi: 1.0,
    key: 950,
    accents: 30,
    bloom: { strength: 0.25, radius: 0.35, threshold: 1.5 },
    tubes: 2.2,
    floor: { base: '#0f3550', line: '#16486a', dot: '#1d5a82', glow: 0 },
    coin: { color: 0xe0a83a, roughness: 0.32, bump: 2.2, goldGlow: 0.35 },
    marker: { shape: 'dot', inner: 0, outer: 0.17, owned: 1.3, house: 0 },
  },
};

// Stainless Steel (2026-09-30): the Gold Rush coins and lighting in the stainless-steel machine from the concept picture.
LOOKS.steel = { ...LOOKS.gold, label: 'Stainless Steel', machine: 'steel' };
// Concept Picture (2026-09-30): the ChatGPT concept picture itself as the machine, with the Gold Rush coins over it.
LOOKS.photo = { ...LOOKS.gold, label: 'Concept Picture', machine: 'photo' };

export const DEFAULT_LOOK = 'photo';

export function lookFromUrl(): Look {
  const name = new URLSearchParams(location.search).get('look') ?? DEFAULT_LOOK;
  return LOOKS[name] ?? LOOKS[DEFAULT_LOOK];
}
