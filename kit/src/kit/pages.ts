// A machine's stage and panel sides (docs/MACHINE_REPOS.md section 2), kept apart from its server manifest so the server
// never loads them, and from each other so the control panel never loads the stage's scene: the stage page imports
// machines/pages.ts, the control panel machines/panels.ts.
import type { SceneClass } from '../client/stage/machine-scene';
import { SNAP_HEADER } from '../shared/protocol';

/** Something a machine draws over its stage (the Speedway's race box), fed its own messages and the stage's clock. */
export type OverlayFactory = (root: HTMLElement) => { message(msg: unknown): void; tick(simTime: number): void };
/** A machine's card in the control panel, fed its own messages; `act` sends its buttons' actions to the machine. */
export type CardFactory = (root: HTMLElement, act: (action: unknown) => void) => { message(msg: unknown): void };

/**
 * A machine's snapshot type, and how many bytes its header takes: its bodies are read from there. A header longer than
 * the coin pusher's (SNAP_HEADER) carries the machine's own numbers, for its scene's snapshotHeader.
 */
export interface SnapshotFormat {
  type: number;
  headerBytes: number;
}

/** A machine's stage side. */
export interface MachinePages {
  id: string;
  stage: {
    Scene: SceneClass;
    overlay?: OverlayFactory;
    /** Its snapshot's type and header (SnapshotFormat). */
    snapshot?: SnapshotFormat;
    /** Its own pages for the stage's rotating tips, after How to Play and the career leaders (the coin pusher's shop). */
    tips?: () => HTMLElement[];
    /**
     * Its snapshot type alone, read with the coin pusher's header (bodies from SNAP_HEADER). The stage still reads it:
     * the Speedway gives it.
     * @deprecated Use `snapshot`.
     */
    snapshotType?: number;
  };
}

/** A machine's snapshot as the stage reads it: its `snapshot`, or its `snapshotType` with the coin pusher's header. */
export const snapshotOf = (pages: MachinePages): SnapshotFormat | undefined =>
  pages.stage.snapshot ?? (pages.stage.snapshotType === undefined ? undefined : { type: pages.stage.snapshotType, headerBytes: SNAP_HEADER });

/**
 * A machine's card in the control panel, and what else it gives the panel. The platform draws the card, the Ready marks
 * on the hype buttons (the entry lists the buttons: MachineEntryText.hype) and the reset's words without naming the
 * machine (docs/MACHINE_REPOS.md section 2).
 */
export interface MachinePanel {
  id: string;
  title: string;
  card: CardFactory;
  /**
   * The ids of its hype buttons that are waiting for the next drop, read from one of the machine's own messages (the ones
   * its card hears), or null for any other message. The panel marks them Ready, and pressing one does nothing.
   */
  hypeReady?: (msg: unknown) => readonly string[] | null;
  /** What resetting the machine does, in a sentence, above the panel's Reset button. */
  reset?: string;
}

export const definePages = <P extends MachinePages>(pages: P): P => pages;
export const definePanel = <P extends MachinePanel>(panel: P): P => panel;
