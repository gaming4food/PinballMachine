// The pinball machine keeps the machine contract (coin-op-city's docs/MACHINE_REPOS.md section 2; kit/src/kit/manifest.ts
// and pages.ts): what coin-op-city checks when it imports this machine, checked here first. Its entry lists its four
// hype buttons, each for sale from chat. Its panel module gives the control panel its card, which of the buttons wait
// (Ready), and the words for its Reset.
// Usage: npm test (or npx tsx tests/contract-test.ts)
import assert from 'node:assert/strict';
import type { MachineEntryText } from '@kit/manifest';
import type { MachinePanel } from '@kit/panel';
import type { PinballState } from '../src/shared/pinball';
// The stage's CSS and the like are the browser's business: stubbed (stub-assets.ts), so the pages load in Node.
import './stub-assets';

const { MACHINE_API } = await import('@kit/manifest');
const { manifest } = await import('../src/manifest');
const { pages } = await import('../src/pages');
const { panel } = await import('../src/panel');
/** The panel module as the platform reads it, where which hype buttons wait and the reset's words are optional. */
const machinePanel: MachinePanel = panel;

/** The pinball's state as its server sends it, with nothing on the table. */
const idle: PinballState = {
  phase: 'idle',
  balls: [],
  line: [],
  multiball: false,
  doubleUntil: null,
  saverUntil: null,
  lockLit: false,
  lastResult: null,
  waiting: [],
};

const checks: [string, () => void][] = [
  ['the manifest keeps the contract', () => {
    assert.equal(manifest.api, MACHINE_API);
    assert.equal(manifest.api, 1);
    const entry: MachineEntryText = manifest.entry;
    for (const key of ['id', 'label', 'icon', 'items', 'queued', 'statusTitle', 'testLabel', 'testChat', 'stripTag'] as const) {
      assert.ok(typeof entry[key] === 'string' && entry[key].trim().length > 0, `entry.${key} is written`);
    }
    const html = entry.howTo.map((line) => (typeof line === 'string' ? line : line.html));
    assert.ok(html.length >= 1 && html.every((line) => line.trim().length > 0), 'How to Play has lines');
    assert.ok((['released', 'development'] as string[]).includes(entry.release), 'released or in development');
    if (entry.bots) assert.ok(entry.bots.play.length > 0 && entry.bots.join.trim().length > 0, "the bots' lines");
    const commands = entry.layoutCommands;
    if (commands) assert.ok(commands.short.trim().length > 0 && commands.full.length === 4, "the Layouts card's words and place");
    assert.equal(typeof manifest.server.make, 'function');
    assert.equal(typeof manifest.server.runsUnseen, 'boolean');
    assert.equal(typeof pages.stage.Scene, 'function');
    assert.equal(pages.id, entry.id);
    assert.equal(panel.id, entry.id);
    assert.equal(typeof panel.card, 'function');
    assert.equal(entry.id, 'pinball');
    assert.equal(entry.release, 'development');
    assert.equal(manifest.server.runsUnseen, false);
  }],
  ["the entry's four hype buttons, in order, each for sale from chat", () => {
    // Read through the entry's type, as the platform reads it: there, `hype` is optional.
    const entry: MachineEntryText = manifest.entry;
    assert.deepEqual(entry.hype, [
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
    ]);
    const ids = entry.hype!.map((button) => button.id);
    assert.equal(new Set(ids).size, ids.length, 'no id twice');
  }],
  ["the reset's words", () => {
    assert.equal(machinePanel.reset, 'Clears the table and the line.');
  }],
  ['which hype buttons wait', () => {
    const ready = machinePanel.hypeReady!;
    assert.equal(typeof ready, 'function');
    assert.equal(ready({}), null, "anything but the pinball's own message: null");
    assert.equal(ready({ kind: 'claw' }), null);
    assert.equal(ready(null), null);
    assert.deepEqual(ready({ kind: 'pinball', state: idle }), [], 'a pinball state with no waits');
    assert.deepEqual(ready({ kind: 'pinball', state: { ...idle, waiting: ['saver'] } }), ['saver'], 'a waiting saver');
  }],
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').slice(0, 6).join('\n      ')}`);
  }
}
console.log(failed ? `\n${failed} failed` : `\nall ${checks.length} passed`);
process.exit(failed ? 1 : 0);
