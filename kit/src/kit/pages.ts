// A machine's stage and panel sides (docs/MACHINE_REPOS.md section 2), kept apart from its server manifest so the server
// never loads them, and from each other so the control panel never loads the stage's scene: the stage page imports
// machines/pages.ts, the control panel machines/panels.ts.
import type { SceneClass } from '../client/stage/machine-scene';
import type { Prices } from '../shared/prices';
import { SNAP_HEADER } from '../shared/protocol';

/** What a machine's OverlayFactory gives back: fed its own messages and the stage's clock. */
export interface MachineOverlay {
  message(msg: unknown): void;
  tick(simTime: number): void;
}
/**
 * Something a machine draws over its stage (the Speedway's race box), fed its own messages and the stage's clock.
 * `root` is the overlay slot over the whole 1920x1080 stage. `panel` is the machine's own section at the top of the
 * stage's right column, above the live feed (added 2026-10-26, for the pinball's scoreboard): given in the full-screen
 * layout only, empty and shown, and null in the corner and vertical layouts, where the machine keeps what it shows in
 * `root`. The panel is 372 px wide less its padding (332 px of content), takes its height from what the machine puts in
 * it (the feed and tips below give way), and has no border of its own: the machine styles its content. A machine that
 * takes only `root` gets no panel and nothing changes for it.
 */
export type OverlayFactory = (root: HTMLElement, panel: HTMLElement | null) => MachineOverlay;
/** The stage's three ways of drawing (shared/layouts.ts's LayoutMode). */
export type StageMode = 'full' | 'corner' | 'vertical';
/**
 * Starts a machine's overlay on a stage (the city's and the stand-in host's): the panel slot is emptied, shown and
 * given to the machine in the full-screen layout, and emptied, hidden and kept from it in the others. Null for a
 * machine with no overlay (its panel slot stays empty and hidden).
 */
export function mountOverlay(pages: MachinePages | undefined, root: HTMLElement, slot: HTMLElement | null, mode: StageMode): MachineOverlay | null {
  const panel = slot && mode === 'full' && pages?.stage.overlay ? slot : null;
  if (slot) {
    slot.replaceChildren();
    slot.hidden = panel === null;
  }
  return pages?.stage.overlay?.(root, panel) ?? null;
}
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
    /**
     * Its own pages for the stage's rotating tips, after How to Play and the career leaders (the coin pusher's shop).
     * Called with the standard prices at first, and again with the channel's when they arrive (the stage swaps the pages
     * for the new ones); a function that takes no prices keeps its pages as they were.
     */
    tips?: (prices: Prices) => HTMLElement[];
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
