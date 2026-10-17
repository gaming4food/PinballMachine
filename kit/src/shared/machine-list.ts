// Coin-Op City's machines, one entry each (docs/SPEEDWAY.md, part 1, 2026-10-09). The server makes its rooms from this
// list (server/rooms.ts), and the control panel and the stage take each machine's name, icon and words from it, so a
// new machine starts with its entry here. Tested by npm run machines-test.
import { ENTRIES } from '../../machines/entries';
import type { HypeButton } from '../kit/hype-action';
import type { MachineEntryText } from '../kit/manifest';

/**
 * A machine on the list: a manifest's entry (MachineEntryText, so the two can't drift apart). How to Play's lines and
 * the corner-strip tag may be left out (a plain entry for a machine a page doesn't know yet has neither).
 */
export type MachineEntry = Omit<MachineEntryText, 'howTo' | 'stripTag'> & Partial<Pick<MachineEntryText, 'howTo' | 'stripTag'>>;

/**
 * Every machine: the machines copied into machines/<id>/ by npm run machine:import (docs/MACHINE_REPOS.md), from their
 * manifests' entries, in the indexes' order. The coin pusher comes first (machine:import keeps it there): it's the
 * machine a link or layout naming none shows.
 */
export const MACHINE_LIST = [...ENTRIES] as const satisfies readonly MachineEntry[];

/** A machine's room id: one the list names. */
export type RoomId = (typeof MACHINE_LIST)[number]['id'];

export const ROOM_IDS: readonly RoomId[] = MACHINE_LIST.map((m) => m.id);

/**
 * The machine a link or layout that names none shows: the first on the list, the coin pusher ('main'; machine:import
 * keeps it first). In a machine's own repo, whose list is just its own entry, that machine.
 */
export const DEFAULT_ROOM: RoomId = MACHINE_LIST[0].id;

export const isRoomId = (id: unknown): id is RoomId => ROOM_IDS.includes(id as RoomId);

/**
 * A machine's entry on the list. A page older than its server, sent a machine it doesn't know yet, still draws with a
 * plain entry until it reloads.
 */
export function machineEntry(id: RoomId): MachineEntry {
  return (
    MACHINE_LIST.find((m) => m.id === id) ?? {
      id,
      label: String(id),
      icon: '🎮',
      items: 'things',
      queued: 'waiting',
      statusTitle: '',
      testLabel: 'Test',
      testChat: 'test',
      rainsAtZero: false,
      release: 'released',
    }
  );
}

/**
 * A machine's hype buttons, in the order the control panel draws them: its entry's list (MachineEntryText.hype), or
 * none. Whatever needs them reads them here. It goes through machineEntry, which is typed MachineEntry: in a machine's
 * own repo the list holds just its entry, as a literal type that may have no `hype` field.
 */
export function hypeOf(room: RoomId): readonly HypeButton[] {
  return machineEntry(room).hype ?? [];
}
