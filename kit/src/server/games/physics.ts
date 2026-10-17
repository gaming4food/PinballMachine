// Rapier's start-up and the physics step's length, shared by every machine and by the server's loop (hosts.ts), so
// starting the server no longer loads a game to get them (2026-10-09, docs/SPEEDWAY.md part 1; they were the coin
// pusher's, whose sim still passes them on for the tests that import them there). Every
// machine's physics runs on Rapier's SIMD edition (2026-10-03). Tested by npm run machines-test.
import RAPIER from '@dimforge/rapier3d-simd-compat';

/** One physics step: every machine steps 60 times a second. */
export const DT = 1 / 60;

/** Rapier's WebAssembly, loaded once per thread before any machine is made. */
export function initPhysics(): Promise<void> {
  return RAPIER.init();
}
