// Draws a machine's hype buttons (MachineEntryText.hype in manifest.ts). The city's control panel and the stand-in
// host's panel both call it, so a machine's buttons look and act the same in each. Their style is the control panel's
// (style.css).
import type { HypeButton } from './hype-action';

/** What a button says while its boost is waiting for the next drop. */
const READY = 'Ready';

/**
 * Draws one `button.hype-button` per entry into `root`, in place of what was there: its icon and name, with the hint as
 * its tooltip, and after the name an empty, hidden `span.hype-caption`. A press calls `press` with the button's id.
 *
 * `ready` gets the ids of the buttons waiting for the next drop (MachinePanel.hypeReady). Those buttons say "Ready" in
 * place of their names, with the class `ready` for the style and aria-disabled for screen readers, and pressing one
 * does nothing. A button that isn't in the list goes back to its name and presses again. An id that isn't drawn is
 * ignored.
 *
 * `captions` gets a line of small print for each button, by id (what chat types and pays to buy it, say), shown under
 * its name. A button the record leaves out has none: its line is emptied and hidden. An id that isn't drawn is ignored.
 * A Ready button keeps its caption.
 */
export function drawHype(
  root: HTMLElement,
  buttons: readonly HypeButton[],
  press: (id: string) => void,
): { ready(ids: readonly string[]): void; captions(byId: Readonly<Record<string, string>>): void } {
  /** The ids waiting for the next drop, as the last `ready` said: a press on one of them does nothing. */
  let waiting = new Set<string>();
  const drawn = buttons.map(({ id, label, icon, hint }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hype-button';
    button.title = hint;
    const mark = document.createElement('span');
    mark.className = 'hype-icon';
    mark.textContent = icon;
    const name = document.createElement('span');
    name.className = 'hype-label';
    name.textContent = label;
    // Empty and hidden until `captions` gives it a line.
    const caption = document.createElement('span');
    caption.className = 'hype-caption';
    caption.hidden = true;
    // The plain space keeps the icon and the name apart wherever the style doesn't (a grid ignores it).
    button.append(mark, ' ', name, caption);
    button.addEventListener('click', () => {
      if (!waiting.has(id)) press(id);
    });
    return { id, button, name, label, caption };
  });
  root.replaceChildren(...drawn.map((one) => one.button));
  return {
    ready(ids) {
      waiting = new Set(ids);
      for (const { id, button, name, label } of drawn) {
        const on = waiting.has(id);
        button.classList.toggle('ready', on);
        // The panel calls this with every state the machine sends, so only touch the attribute and the text when they
        // change.
        if (button.hasAttribute('aria-disabled') !== on) {
          if (on) button.setAttribute('aria-disabled', 'true');
          else button.removeAttribute('aria-disabled');
        }
        const text = on ? READY : label;
        if (name.textContent !== text) name.textContent = text;
      }
    },
    captions(byId) {
      for (const { id, caption } of drawn) {
        // The panel calls this each time the prices may have changed, so only touch a caption when its line changes.
        const text = byId[id] ?? '';
        if (caption.textContent !== text) caption.textContent = text;
        if (caption.hidden !== !text) caption.hidden = !text;
      }
    },
  };
}
