// Raises and lowers the field toys on a running dev host (`npm run dev:toys`), or starts one of the quest's modes or
// its finale there: it sends the host's panel socket the action the game takes (PinballGame.action), `toy` for each
// toy named (then setToy) or `quest` (then Quest.begin or beginFinale), and the game moves a toy as soon as no ball is
// in its way. The table steps only while a stage page is open, so a toy asked for with none open moves when one opens,
// and a mode's clock runs only while a ball is in play. A host started by `npm run dev` ignores the actions: the
// switch is dev:toys', and the city has none.
// Usage: npm run toy -- <popups|mummy|tomb|diverter|all> <up|down> [port]
//        npm run toy -- mode <ra|horus|ankh|eye> [port]   (that god's mode now, whatever ran ending with no prize)
//        npm run toy -- finale [port]                      (the finale now: its multiball and its toys)
// The port is 7841 by default. Exits 0 once every action is sent, 2 for words it doesn't know, and 1 when the host
// can't be reached.
import { WebSocket } from 'ws';
import type { Toy } from '../src/server/game';
import { GODS, MODE_NAME } from '../src/shared/pinball';

/** Every toy the game has: the keys are held to its Toy type both ways, so this list can't drift from it. */
const TOYS = Object.keys({ popups: 0, mummy: 0, tomb: 0, diverter: 0 } satisfies Record<Toy, 0>) as Toy[];

/**
 * The actions the words ask for, what they ask (for the line said once they are sent), and the words after them (the
 * port, if any); or null for words it doesn't know.
 */
function read([first, ...more]: string[]): { actions: unknown[]; asked: string; after: string[] } | null {
  if (first === 'finale') return { actions: [{ kind: 'quest', start: 'finale' }], asked: 'the finale', after: more };
  const [second, ...after] = more;
  if (first === 'mode') {
    const god = GODS.find((g) => g === second);
    return god ? { actions: [{ kind: 'quest', start: god }], asked: `mode ${god} (${MODE_NAME[god]})`, after } : null;
  }
  const toys = first === 'all' ? TOYS : TOYS.filter((toy) => toy === first);
  if (!toys.length || (second !== 'up' && second !== 'down')) return null;
  return { actions: toys.map((toy) => ({ kind: 'toy', toy, up: second === 'up' })), asked: `${toys.join(', ')} ${second}`, after };
}

const words = read(process.argv.slice(2));
const [portArg, ...extra] = words?.after ?? [];
const port = portArg === undefined ? 7841 : Number(portArg);
if (!words || extra.length > 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`usage: npm run toy -- <${TOYS.join('|')}|all> <up|down> [port]`);
  console.error(`       npm run toy -- mode <${GODS.join('|')}> [port]`);
  console.error('       npm run toy -- finale [port]');
  console.error('       (the port is 7841 by default)');
  process.exit(2);
}
const { actions, asked } = words;
const url = `ws://localhost:${port}/ws?role=panel`;

function fail(why: string): never {
  console.error(`toy: ${why}`);
  process.exit(1);
}

function done(): never {
  console.log(`toy: asked ${asked} on port ${port} (only a host started by npm run dev:toys takes it)`);
  process.exit(0);
}

let sent = 0;
const socket = new WebSocket(url, { handshakeTimeout: 5000 });
socket.on('error', (err: NodeJS.ErrnoException) => {
  fail(`can't reach the dev host at ${url} (${err.code ?? err.message}). Is npm run dev:toys running on port ${port}?`);
});
socket.on('open', () => {
  for (const action of actions) {
    socket.send(JSON.stringify({ t: 'machine.action', action }), (err) => {
      if (err) fail(`couldn't send the action for ${asked}: ${err.message}`);
      // Closed once every action is out, so the host has them all before the socket goes.
      if (++sent === actions.length) socket.close();
    });
  }
  // A host that never answers the close is not waited for, as long as it has been sent everything.
  setTimeout(() => (sent === actions.length ? done() : fail('the dev host did not take the actions')), 3000).unref();
});
socket.on('close', () => (sent === actions.length ? done() : fail('the dev host closed the connection before every action was sent')));
