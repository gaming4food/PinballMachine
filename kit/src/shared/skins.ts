// The coin shop: looks viewers can buy with the coins they win. Coins are points only, so this is purely
// cosmetic and is never sold for money or gifts. Shared by the server (prices, rules) and the stage (looks).

export interface Skin {
  /** What viewers type: !skin <id>. The first word of the label, lowercased. */
  id: string;
  label: string;
  /** Coins to unlock; once unlocked, switching back to it is free. */
  price: number;
  /** Metal tint (0xRRGGBB): coins are fully metallic, so this colors their shine. */
  tint: number;
  /** Light the coin gives off by itself, so it shines even where nothing reflects on it. */
  glow?: number;
  /** Shifts through the rainbow (each coin a little out of step with the others). */
  rainbow?: boolean;
  /**
   * A pattern drawn across the coin's metal by the stage (see SKIN_PATTERNS and scene.ts's skin shader), instead of a
   * plain tint; `tint` is then just its swatch color in the shop. The animated ones move.
   */
  pattern?: SkinPattern;
  /** Which page of the stage's coin shop it's on. */
  shelf: 'metals' | 'patterns' | 'elements';
}

/** The patterned skins (2026-10-02). Their order is the number the stage's shader knows each by: append only. */
export const SKIN_PATTERNS = [
  'lava', 'galaxy', 'plasma', 'circuit',
  'holo', 'chrome', 'pearl', 'opal',
  'carbon', 'marble', 'tiger', 'camo', 'diamond', 'checker',
  'frost', 'flame', 'toxic', 'storm',
] as const;
export type SkinPattern = (typeof SKIN_PATTERNS)[number];
/** The number the stage's shader knows a pattern by (0 is none). */
export const patternNumber = (pattern: SkinPattern | undefined) => (pattern ? SKIN_PATTERNS.indexOf(pattern) + 1 : 0);

/** Everyone starts with gold (drawn in the machine's own gold, which varies a little by look). */
export const DEFAULT_SKIN = 'gold';

export const SKINS: Skin[] = [
  { id: 'gold', label: 'GOLD', price: 0, tint: 0xf2b541, shelf: 'metals' },
  { id: 'silver', label: 'SILVER', price: 50, tint: 0xdfe4ec, shelf: 'metals' },
  { id: 'bronze', label: 'BRONZE', price: 50, tint: 0xc7793c, shelf: 'metals' },
  { id: 'rose', label: 'ROSE GOLD', price: 100, tint: 0xf0a08c, shelf: 'metals' },
  { id: 'emerald', label: 'EMERALD', price: 150, tint: 0x2fd67a, shelf: 'metals' },
  { id: 'sapphire', label: 'SAPPHIRE', price: 150, tint: 0x3f7bff, shelf: 'metals' },
  { id: 'ruby', label: 'RUBY', price: 150, tint: 0xff3b55, shelf: 'metals' },
  { id: 'amethyst', label: 'AMETHYST', price: 150, tint: 0xa45cff, shelf: 'metals' },
  { id: 'obsidian', label: 'OBSIDIAN', price: 250, tint: 0x2a2633, shelf: 'metals' },
  { id: 'neon', label: 'NEON', price: 400, tint: 0xff2bd6, glow: 1.2, shelf: 'metals' },
  { id: 'rainbow', label: 'RAINBOW', price: 750, tint: 0xffffff, glow: 0.35, rainbow: true, shelf: 'metals' },
  // Patterned and textured, and shiny (2026-10-02).
  { id: 'carbon', label: 'CARBON FIBER', price: 200, tint: 0x2b2e34, pattern: 'carbon', shelf: 'patterns' },
  { id: 'checker', label: 'CHECKER', price: 200, tint: 0xe8e8e8, pattern: 'checker', shelf: 'patterns' },
  { id: 'diamond', label: 'DIAMOND PLATE', price: 250, tint: 0xb8bec8, pattern: 'diamond', shelf: 'patterns' },
  { id: 'camo', label: 'CAMO', price: 250, tint: 0x5b6b3a, pattern: 'camo', shelf: 'patterns' },
  { id: 'tiger', label: 'TIGER', price: 300, tint: 0xff8a1e, pattern: 'tiger', shelf: 'patterns' },
  { id: 'marble', label: 'MARBLE', price: 350, tint: 0xf2efe9, pattern: 'marble', shelf: 'patterns' },
  { id: 'chrome', label: 'CHROME', price: 300, tint: 0xf4f6fa, pattern: 'chrome', shelf: 'patterns' },
  { id: 'pearl', label: 'PEARL', price: 350, tint: 0xf6efe6, pattern: 'pearl', shelf: 'patterns' },
  { id: 'opal', label: 'OPAL', price: 500, tint: 0xbfe8ff, pattern: 'opal', shelf: 'patterns' },
  { id: 'holo', label: 'HOLOGRAPHIC', price: 800, tint: 0xc8a8ff, pattern: 'holo', shelf: 'patterns' },
  // Elemental, and animated and glowing (2026-10-02).
  { id: 'frost', label: 'FROST', price: 500, tint: 0x9fe6ff, pattern: 'frost', shelf: 'elements' },
  { id: 'toxic', label: 'TOXIC', price: 500, tint: 0x7dff3a, pattern: 'toxic', shelf: 'elements' },
  { id: 'circuit', label: 'CIRCUIT', price: 600, tint: 0x1fd6ff, pattern: 'circuit', shelf: 'elements' },
  { id: 'flame', label: 'FLAME', price: 700, tint: 0xff6a1a, pattern: 'flame', shelf: 'elements' },
  { id: 'storm', label: 'STORM', price: 700, tint: 0x8a93b8, pattern: 'storm', shelf: 'elements' },
  { id: 'plasma', label: 'PLASMA', price: 800, tint: 0xb04dff, pattern: 'plasma', shelf: 'elements' },
  { id: 'lava', label: 'LAVA', price: 900, tint: 0xff4a10, pattern: 'lava', shelf: 'elements' },
  { id: 'galaxy', label: 'GALAXY', price: 1000, tint: 0x5a3cff, pattern: 'galaxy', shelf: 'elements' },
];

export const skinById = new Map(SKINS.map((skin) => [skin.id, skin]));

/** Neon colors for coin markers, name tags and the leaderboard: !color <name>. */
export const COLORS: Record<string, number> = {
  pink: 0xff2bd6,
  cyan: 0x22e6ff,
  yellow: 0xffd23f,
  orange: 0xff8a2a,
  red: 0xff3355,
  green: 0x3dff8a,
  lime: 0xb6ff3d,
  blue: 0x4d8dff,
  purple: 0xa45cff,
  white: 0xf3ecff,
};

export const COLOR_PRICE = 30;

/**
 * Animated names (2026-10-02): !color rainbow and the like. Bought the same way as a color, they replace it: the name
 * animates on the leaderboard, in the feed, over the viewer's coins, in win popups and on alert cards (see the
 * name-fx classes in stage/style.css), and `color` is the plain color their coins' inlay and anything else shows.
 */
export const NAME_EFFECTS = {
  sparkle: { label: 'SPARKLE', price: 150, color: 0xf3ecff },
  glitch: { label: 'GLITCH', price: 200, color: 0x22e6ff },
  gold: { label: 'GOLD SHIMMER', price: 250, color: 0xffc84a },
  rainbow: { label: 'RAINBOW', price: 300, color: 0xff2bd6 },
} as const;
export type NameFx = keyof typeof NAME_EFFECTS;
export const isNameFx = (v: unknown): v is NameFx => typeof v === 'string' && Object.hasOwn(NAME_EFFECTS, v);
