// The pinball machine's stage side (docs/MACHINE_REPOS.md section 2): its scene, its scoreboard overlay, and its
// snapshot, whose header carries the three flippers, the lit inserts, the targets down, the plaques turned, both
// spinners and the toys' bits.
import { definePages } from '@kit/stage';
import { entry } from './entry';
import { SNAP_PINBALL_HEADER, SNAP_TYPE_PINBALL } from './shared/pinball';
import { pinballOverlay, PinballScene } from './stage/pinball';

export const pages = definePages({
  id: entry.id,
  stage: {
    Scene: PinballScene,
    // The panel (the city's right column) comes in the full layout only: the scoreboard goes there, and the machine fills
    // the frame's height (pinballOverlay).
    overlay: pinballOverlay,
    snapshot: { type: SNAP_TYPE_PINBALL, headerBytes: SNAP_PINBALL_HEADER },
  },
});
