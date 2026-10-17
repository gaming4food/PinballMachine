// Small helpers shared by the stage and the control panel.
import type { Platform } from '../shared/protocol';

export const cssColor = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

const BADGE: Record<Platform, string> = { twitch: 'TW', youtube: 'YT', tiktok: 'TT', kick: 'KI', tips: 'TIP', sim: 'SIM' };

/** The CSS class that animates a name bought with !color rainbow and the like (see stage/style.css), or ''. */
export const nameFxClass = (fx: string | undefined) => (fx && /^[a-z]+$/.test(fx) ? `fx-${fx}` : '');

export function platformBadge(platform: Platform): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = `plat plat-${platform}`;
  el.textContent = BADGE[platform];
  return el;
}
