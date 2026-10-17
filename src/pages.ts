// The pinball machine's stage side (docs/MACHINE_REPOS.md section 2): its scene. The scoreboard overlay and the
// snapshot type come with the stage.
import { definePages } from '@kit/stage';
import { entry } from './entry';
import { PinballScene } from './stage/pinball';

export const pages = definePages({
  id: entry.id,
  stage: { Scene: PinballScene },
});
