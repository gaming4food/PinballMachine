// The control panel's Pinball card: the line of viewers waiting for a ball, each with a Remove button (the streamer's way
// to take someone out). It hears the pinball's own messages ({ kind: 'pinball', state }). One click listener on the
// root reads data-remove, so drawing the list again piles up nothing. The pinball sends its state about 4 times a second
// in play, so the list is drawn again only when the line changed: a Remove button replaced between its press and its
// release would lose the click.
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
  /** The line drawn now, as its HTML (built from the ids and the names alone). */
  let drawn = lineHtml([]);
  root.innerHTML = drawn;
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const button = target?.closest?.('[data-remove]') as HTMLElement | null;
    const userId = Number(button?.dataset.remove);
    if (button && Number.isFinite(userId)) act({ kind: 'remove', userId });
  });
  return {
    message(msg) {
      const state = pinballStateOf(msg);
      if (!state) return;
      const html = lineHtml(state.line);
      if (html === drawn) return;
      drawn = html;
      root.innerHTML = html;
    },
  };
};
