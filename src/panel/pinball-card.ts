// The control panel's Pinball card. A stub: the line and the table's state come with the game.
import type { CardFactory } from '@kit/panel';

export const pinballCard: CardFactory = (root) => {
  root.innerHTML = '<p class="pinball-line">Nobody in line</p>';
  return { message() {} };
};
