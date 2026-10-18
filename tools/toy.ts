// Raises and lowers the field toys on a running dev host (`npm run dev:toys`): it sends the host's panel socket the
// `toy` action the game takes (PinballGame.action, then setToy) for each toy named, and the game moves it as soon as
// no ball is in its way. The table steps only while a stage page is open, so a toy asked for with none open moves when
// one opens. A host started by `npm run dev` ignores the action: the switch is dev:toys', and the city has none.
// Usage: npm run toy -- <popups|mummy|tomb|diverter|all> <up|down> [port]   (the port is 7841 by default)
// Exits 0 once every toy is asked, 2 for words it doesn't know, and 1 when the host can't be reached.
import { WebSocket } from 'ws';
import type { Toy } from '../src/server/game';

/** Every toy the game has: the keys are held to its Toy type both ways, so this list can't drift from it. */
const TOYS = Object.keys({ popups: 0, mummy: 0, tomb: 0, diverter: 0 } satisfies Record<Toy, 0>) as Toy[];

const [which, direction, portArg, ...extra] = process.argv.slice(2);
const toys = which === 'all' ? TOYS : TOYS.filter((toy) => toy === which);
const port = portArg === undefined ? 7841 : Number(portArg);
if (!toys.length || (direction !== 'up' && direction !== 'down') || extra.length > 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`usage: npm run toy -- <${TOYS.join('|')}|all> <up|down> [port]   (the port is 7841 by default)`);
  process.exit(2);
}
const up = direction === 'up';
const url = `ws://localhost:${port}/ws?role=panel`;

function fail(why: string): never {
  console.error(`toy: ${why}`);
  process.exit(1);
}

function done(): never {
  console.log(`toy: asked ${toys.join(', ')} ${direction} on port ${port} (only a host started by npm run dev:toys takes it)`);
  process.exit(0);
}

let sent = 0;
const socket = new WebSocket(url, { handshakeTimeout: 5000 });
socket.on('error', (err: NodeJS.ErrnoException) => {
  fail(`can't reach the dev host at ${url} (${err.code ?? err.message}). Is npm run dev:toys running on port ${port}?`);
});
socket.on('open', () => {
  for (const toy of toys) {
    socket.send(JSON.stringify({ t: 'machine.action', action: { kind: 'toy', toy, up } }), (err) => {
      if (err) fail(`couldn't send the action for ${toy}: ${err.message}`);
      // Closed once every action is out, so the host has them all before the socket goes.
      if (++sent === toys.length) socket.close();
    });
  }
  // A host that never answers the close is not waited for, as long as it has been sent everything.
  setTimeout(() => (sent === toys.length ? done() : fail('the dev host did not take the actions')), 3000).unref();
});
socket.on('close', () => (sent === toys.length ? done() : fail('the dev host closed the connection before every toy was asked')));
