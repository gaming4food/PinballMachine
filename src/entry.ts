// The pinball machine as the platform shows it (docs/MACHINE_REPOS.md section 2): plain data, read by the server, the
// panel and the stage.
import type { MachineEntryText } from '@kit/shared';

export const entry = {
  id: 'pinball',
  label: 'Pinball',
  icon: '🎯',
  items: 'balls',
  queued: 'in line',
  statusTitle: 'Balls on the table, balls in the line, the pages showing it (OBS and previews), and how long each step of the game takes',
  testLabel: 'Launch a ball (as a test viewer)',
  testChat: 'ball',
  rainsAtZero: false,
  release: 'development',
  howTo: [
    '<b>ball</b> puts your ball in the line, and it launches when its turn comes',
    '<b>left</b> · <b>right</b> flip the flippers, all of chat together',
    { after: 'skip', html: 'A drained ball pays its owner, and everyone who flipped it shares a cut' },
  ],
  stripTag: 'TYPE <b>BALL</b> · <b>LEFT</b> · <b>RIGHT</b> TO PLAY',
  bots: { join: 'ball', play: ['left', 'right', 'left', 'right', 'l', 'r'] },
  // Its hype buttons, in the panel's order. The streamer presses each for free. Chat can buy each: the words to type
  // after the !, what a reply calls it, its price to start with, and the owner's limits on that price, all in coins.
  hype: [
    {
      id: 'multiball',
      label: 'Multiball',
      icon: '🎱',
      hint: '2 more balls, from the line or the house',
      sale: { words: ['multiball'], what: 'multiball', price: 200, limits: { min: 50, max: 5000 } },
    },
    {
      id: 'saver',
      label: 'Ball saver',
      icon: '🛟',
      hint: 'No ball can drain for 15 seconds',
      sale: { words: ['saver'], what: 'a ball saver', price: 50, limits: { min: 10, max: 1000 } },
    },
    {
      id: 'double',
      label: 'Double score',
      icon: '✖️',
      hint: 'Every point counts twice for 30 seconds',
      sale: { words: ['double'], what: 'double score', price: 100, limits: { min: 20, max: 2000 } },
    },
    {
      id: 'nudge',
      label: 'Nudge',
      icon: '🫨',
      hint: 'A bump of the table jolts every ball',
      sale: { words: ['nudge'], what: 'a nudge', price: 30, limits: { min: 5, max: 500 } },
    },
  ],
} as const satisfies MachineEntryText;
