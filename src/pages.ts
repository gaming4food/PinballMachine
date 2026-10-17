// The pinball machine's stage side (docs/MACHINE_REPOS.md section 2): its scene, its scoreboard overlay, and its
// snapshot, whose header carries the flippers, the lit inserts, the drop targets and the spinner.
import { definePages } from '@kit/stage';
import { entry } from './entry';
import { SNAP_PINBALL_HEADER, SNAP_TYPE_PINBALL } from './shared/pinball';
import { PinballHud, PinballScene } from './stage/pinball';

export const pages = definePages({
  id: entry.id,
  stage: {
    Scene: PinballScene,
    overlay: (slot) => new PinballHud(slot),
    snapshot: { type: SNAP_TYPE_PINBALL, headerBytes: SNAP_PINBALL_HEADER },
  },
});
