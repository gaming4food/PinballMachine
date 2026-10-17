// The control panel's Pinball card: the line of viewers waiting for a ball, each with a Remove button (the streamer's way
// to take someone out). It hears the pinball's own messages ({ kind: 'pinball', state }). One click listener on the
// root reads data-remove, so drawing the list again piles up nothing.
import type { CardFactory } from '@kit/panel';
import { pinballStateOf, type PinballState } from '../shared/pinball';

/** Text safe to put in HTML: a viewer's name is whatever they typed in chat. */
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The line as HTML: a list with a Remove button on each viewer, or "Nobody in line". */
function lineHtml(line: PinballState['line']): string {
  if (!line.length) return '<p class="pinball-line">Nobody in line</p>';
  const items = line.map((l) => `<li>${escapeHtml(l.name)} <button data-remove="${Number(l.userId)}">Remove</button></li>`).join('');
  return `<ol class="pinball-line">${items}</ol>`;
}

export const pinballCard: CardFactory = (root, act) => {
  root.innerHTML = lineHtml([]);
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const button = target?.closest?.('[data-remove]') as HTMLElement | null;
    const userId = Number(button?.dataset.remove);
    if (button && Number.isFinite(userId)) act({ kind: 'remove', userId });
  });
  return {
    message(msg) {
      const state = pinballStateOf(msg);
      if (state) root.innerHTML = lineHtml(state.line);
    },
  };
};
