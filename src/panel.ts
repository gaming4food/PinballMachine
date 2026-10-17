// The pinball machine in the control panel (docs/MACHINE_REPOS.md section 2): its card, which of its four hype buttons
// wait, so the panel can mark them Ready; and what its Reset does. The buttons themselves are listed in the entry
// (entry.ts), and the panel draws them from there.
import { definePanel } from '@kit/panel';
import { entry } from './entry';
import { pinballCard } from './panel/pinball-card';
import { pinballStateOf } from './shared/pinball';

/** The buttons waiting, for the panel to mark Ready. Null for any message but the pinball's own. */
function hypeReady(msg: unknown): readonly string[] | null {
  return pinballStateOf(msg)?.waiting ?? null;
}

export const panel = definePanel({
  id: entry.id,
  title: entry.label,
  card: pinballCard,
  hypeReady,
  reset: 'Clears the table and the line.',
});
