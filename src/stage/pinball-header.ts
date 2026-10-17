// The pinball's part of each of its snapshots (shared/pinball.ts, SNAP_TYPE_PINBALL) as the stage reads it: the time,
// how many balls, both flippers' angles, the lit inserts, the drop targets down and the spinner's turn, as the server
// writes them (server/sim.ts's snapshot). It lives apart from pinball.ts, which needs a page, so that a test can read it
// too (npm run pinball-header-test).

/** The table as a snapshot's header has it. Angles are the table's degrees (shared/table.ts); the spinner's radians. */
export interface PinballHeader {
  simTime: number;
  count: number;
  left: number;
  right: number;
  /** The lit inserts (shared/pinball.ts LIT). */
  lit: number;
  /** The drop targets down: bit i for target i. */
  targets: number;
  spinner: number;
}

/** The table as a snapshot's header has it (`view` starts at the snapshot's first byte, the type). */
export function readPinballHeader(view: DataView): PinballHeader {
  return {
    simTime: view.getFloat64(1, true),
    count: view.getUint16(9, true),
    left: view.getFloat32(11, true),
    right: view.getFloat32(15, true),
    lit: view.getUint32(19, true),
    targets: view.getUint8(23),
    spinner: view.getFloat32(24, true),
  };
}
