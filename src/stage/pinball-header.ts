// The pinball's part of each of its snapshots (shared/pinball.ts, SNAP_TYPE_PINBALL) as the stage reads it: the time,
// how many balls, the three flippers' angles, the lit inserts, the targets down and turned and both spinners' turns, as
// the server writes them (server/sim.ts's snapshot). It lives apart from pinball.ts, which needs a page, so that a test
// can read it too (npm run pinball-header-test).

/** The table as a snapshot's header has it. Angles are the table's degrees (shared/table.ts); the spinners' radians. */
export interface PinballHeader {
  time: number;
  count: number;
  /** The flippers' angles in the table's order (left, right, upper right). */
  flippers: number[];
  /** The lit inserts (shared/pinball.ts LIT). */
  lit: number;
  /** The drop targets down: bit i for target i. */
  targetsDown: number;
  /** The flip targets turned to their backs: bit i for target i. */
  targetsTurned: number;
  /** The spinners' turns: the main spinner, then the right one. */
  spinners: number[];
}

/** The table as a snapshot's header has it (`view` starts at the snapshot's first byte, the type). */
export function readPinballHeader(view: DataView): PinballHeader {
  return {
    time: view.getFloat64(1, true),
    count: view.getUint16(9, true),
    flippers: [view.getFloat32(11, true), view.getFloat32(15, true), view.getFloat32(19, true)],
    lit: view.getUint32(23, true),
    targetsDown: view.getUint32(27, true),
    targetsTurned: view.getUint32(31, true),
    spinners: [view.getFloat32(35, true), view.getFloat32(39, true)],
  };
}
