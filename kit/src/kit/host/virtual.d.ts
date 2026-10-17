// The machine the stand-in host runs: its stage side and its card (host.ts serves these from the machine's folder).
declare module 'virtual:host-pages' {
  export const pages: import('../pages').MachinePages;
}
declare module 'virtual:host-panel' {
  /** Null for a machine with no card (no panel.ts). */
  export const panel: import('../pages').MachinePanel | null;
}
