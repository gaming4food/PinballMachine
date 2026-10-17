// A machine's manifest (docs/MACHINE_REPOS.md section 2): what the platform knows of a machine that lives in its own
// repo and is copied into machines/<id>/. Its entry is plain data, read by the server, the panel and the stage alike;
// its server side is here; its stage and panel sides are in a separate file (kit/pages.ts), so the server never loads
// three.js or a stylesheet to read a manifest. Tested by npm run machines-test.
import type { MakeMachine } from '../server/games/machine';
import type { HypeButton } from './hype-action';

/** The machine interface's version. A manifest made for another version is refused and logged (server/rooms.ts). */
export const MACHINE_API = 1;

/**
 * How to Play's lines every machine shares, by id, in their order on the stage's page, where each is #howto-<id>
 * (machines-test checks the page's shared lines are these, in this order).
 */
export const SHARED_HOW_TO_IDS = ['coins', 'fireworks', 'stats', 'sr', 'skip'] as const;

/**
 * One of How to Play's lines, HTML (<b> only). It goes before the lines every machine shares, or, given with `after`,
 * just after the shared line for that command (a !color line after !fireworks, say).
 */
export type HowToLine = string | { html: string; after: (typeof SHARED_HOW_TO_IDS)[number] };

/** What the platform shows and says about a machine. */
export interface MachineEntryText {
  /** Its room id: layouts, stage links (?room=), messages and its save file (machine-<id>.json). */
  id: string;
  /** Its name in the control panel: the Machine row and the status line. */
  label: string;
  /** Its icon on the Layouts card's Machine row and on the layout tabs. */
  icon: string;
  /** The status line's words for the things in it and still to come, and what its numbers mean on hover. */
  items: string;
  queued: string;
  statusTitle: string;
  /** The Test card's first button, and what its test viewer types. */
  testLabel: string;
  testChat: string;
  /** A layout's countdown reaching zero sets off a free coin rain on it. */
  rainsAtZero: boolean;
  /** 'development': played on the owner's own PC only, Coming soon everywhere else. */
  release: 'released' | 'development';
  /** How to Play's lines on its stage. */
  howTo: readonly HowToLine[];
  /** The corner strip's tag under it, HTML (<b> only). */
  stripTag: string;
  /**
   * For a machine that also shows what to type in the full-screen layouts: the Layouts card's Play commands piece in
   * its words, and where that sits on the full-screen map (left, top, width, height, in percent).
   */
  layoutCommands?: { short: string; full: readonly number[] };
  /** The fake audience: what a bot types to take part, then what it types while playing. */
  bots?: { join: string; play: readonly string[] };
  /** Its hype buttons, in the order the control panel draws them. Those with a `sale` can be bought from chat. */
  hype?: readonly HypeButton[];
}

/** A machine's server-side manifest. */
export interface MachineManifest {
  /** The interface version it was made for: MACHINE_API. */
  api: number;
  entry: MachineEntryText;
  server: { make: MakeMachine; runsUnseen: boolean };
}

/** Writes a manifest with its types checked. */
export const defineMachine = <M extends MachineManifest>(manifest: M): M => manifest;
