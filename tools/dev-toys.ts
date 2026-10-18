// The dev host with the toy switch on: `npm run dev:toys` is `npm run dev` (the stand-in host in
// kit/src/kit/host/host.ts: the pinball on its own, with the city's wallet and a fake audience) with PINBALL_TOYS set
// to 1, so that the panel's `toy` action (PinballGame.action) is taken and `npm run toy` can raise and lower the field
// toys on it. The city never sets PINBALL_TOYS and shows no button for it. Everything else is as `npm run dev` has it:
// the machine is src/manifest.ts, its pages are src's, the wallet and the save file are in data-host/, and the port is
// --port (7841 by default; the owner's own play server may be on it, so a scratch run takes another).
// Usage: npm run dev:toys [-- --port 7843]
import { resolve } from 'node:path';
import { startHost } from '@kit/host/host';
import { manifest } from '../src/manifest';

process.env.PINBALL_TOYS = '1';

const at = process.argv.indexOf('--port');
const port = at > 0 ? Number(process.argv[at + 1]) : 7841;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`dev-toys: --port needs a port number from 1 to 65535, not ${JSON.stringify(process.argv[at + 1])}`);
  process.exit(2);
}

const host = await startHost({ manifest, port, dataDir: resolve('data-host'), machineDir: resolve('src') });
console.log(`${manifest.entry.label} on the stand-in host, toy switch on (npm run toy):\n  stage  ${host.url}/stage.html\n  panel  ${host.url}/panel.html`);
const stop = () => void host.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
