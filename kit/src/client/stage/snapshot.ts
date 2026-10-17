// Reading the server's binary snapshots (shared/protocol.ts) for the stage's net.ts: a machine's own header, then its
// bodies. Apart from net.ts, which needs a page, so a test can read snapshots too (npm run snapshot-test).
import { type BodyState, SNAP_STRIDE } from '../../shared/protocol';

/** A body as a snapshot has it: which, where and turned how. */
export type SnapshotBody = Pick<BodyState, 'id' | 'p' | 'q'>;

/**
 * A snapshot, or null for a type `types` doesn't name. `types` says, for each type, how many bytes its header takes:
 * where its bodies start (the coin pusher's at SNAP_HEADER, the claw's after its fingers and trolley). `header` is
 * the snapshot from its first byte to there, as the machine wrote it.
 */
export function readSnapshot(
  buf: ArrayBuffer,
  types: ReadonlyMap<number, number>,
): { type: number; simTime: number; header: DataView; bodies: SnapshotBody[] } | null {
  const view = new DataView(buf);
  const type = view.getUint8(0);
  const headerBytes = types.get(type);
  if (headerBytes === undefined) return null;
  const count = view.getUint16(9, true);
  const bodies: SnapshotBody[] = [];
  for (let i = 0, o = headerBytes; i < count; i++, o += SNAP_STRIDE) {
    bodies.push({
      id: view.getUint32(o, true),
      p: [view.getFloat32(o + 4, true), view.getFloat32(o + 8, true), view.getFloat32(o + 12, true)],
      q: [view.getFloat32(o + 16, true), view.getFloat32(o + 20, true), view.getFloat32(o + 24, true), view.getFloat32(o + 28, true)],
    });
  }
  return { type, simTime: view.getFloat64(1, true), header: new DataView(buf, 0, headerBytes), bodies };
}

/** The ids a body moves as in snapshots: its own, and for a body made of pieces (ChainBody), piece k's as id + k. */
export const chainPieceIds = (body: Pick<BodyState, 'id' | 'chain'>): number[] => body.chain?.pieces.map((_, k) => body.id + k) ?? [body.id];
