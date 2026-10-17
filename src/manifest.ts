// The pinball machine's server manifest (docs/MACHINE_REPOS.md section 2).
import { defineMachine, MACHINE_API } from '@kit/server';
import { entry } from './entry';
import { PinballGame } from './server/game';

export const manifest = defineMachine({
  api: MACHINE_API,
  entry,
  // Unlike the claw, it stops when no stage is open: the ball freezes until one comes back.
  server: { make: (d) => new PinballGame(d.room, d.economy, d.out, d.saveFile), runsUnseen: false },
});
