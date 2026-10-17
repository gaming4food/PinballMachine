// The stand-in host (docs/MACHINE_REPOS.md section 3): one machine, run on its own in its own repo, with Coin-Op City's
// real wallet and fake audience, a stage page and a panel page. It's what an agent working on a machine runs instead of
// the whole city; the real thing is coin-op-city, which imports the machine when the owner releases it.
//   - http: Vite (middleware mode) serves stage.html and panel.html from this folder, with the machine's pages and
//     card (pages.ts, panel.ts in its folder) as the virtual modules virtual:host-pages and virtual:host-panel.
//   - ws /ws?role=stage|panel: the machine, made from its manifest, stepped at 60 Hz (while a stage is open, for a
//     machine that doesn't run unseen), snapshots to the stages every second step, published four times a second.
//     A panel can send it chat (which buys the machine's hype too, at its starting prices: server/chat-hype.ts), the fake
//     audience's switch, its card's buttons (machine.action: the hype buttons too) and the machine's resets
//     (admin.clearMachine, admin.resetMeter).
// Usage: npx tsx <kit>/src/kit/host/host.ts --machine <id> | --dir <machine folder> [--port 7811] [--data <folder>]
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type WebSocket, WebSocketServer } from 'ws';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import { ChatHype } from '../../server/chat-hype';
import { ChatSimulator } from '../../server/connectors/simulator';
import { Economy } from '../../server/economy';
import { EventBus } from '../../server/events';
import { DT, initPhysics } from '../../server/games/physics';
import { hypeItems } from '../../shared/hype-sale';
import { DEFAULT_PRICES } from '../../shared/prices';
import type { MachineManifest } from '../manifest';
import { roomInfo } from '../server';

const HOST_DIR = import.meta.dirname;
const KIT_DIR = resolve(HOST_DIR, '..');
/** Messages a panel hears as well as the stages (as the city's control panel does), with the machine's room. */
const FOR_PANELS = new Set(['board', 'meter', 'feed', 'machine']);

export interface HostOptions {
  manifest: MachineManifest;
  port: number;
  /** Where the wallet and the machine's save file live. */
  dataDir: string;
  /** The machine's folder, holding pages.ts and panel.ts (default machines/<id>, as in coin-op-city). */
  machineDir?: string;
  /** Pages too (Vite). Off for tests that only talk to the socket. */
  pages?: boolean;
}

/** Starts the host. It gives back its address, its wallet (a test gives a viewer coins through it) and how to close it. */
export async function startHost(opts: HostOptions): Promise<{ close(): Promise<void>; url: string; economy: Economy }> {
  await initPhysics();
  const { manifest, dataDir } = opts;
  const id = manifest.entry.id;
  const machineDir = resolve(opts.machineDir ?? join('machines', id));
  const room = roomInfo(id, manifest.entry.label);
  mkdirSync(dataDir, { recursive: true });
  const economy = new Economy(dataDir);
  const bus = new EventBus();
  const simulator = new ChatSimulator(bus);
  const stages = new Set<WebSocket>();
  const panels = new Set<WebSocket>();
  const sendAll = (to: Set<WebSocket>, data: string | Buffer) => {
    for (const ws of to) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  const game = manifest.server.make({
    room,
    economy,
    out: {
      send: (msg: ServerMsg) => {
        sendAll(stages, JSON.stringify(msg));
        if (FOR_PANELS.has(msg.t)) sendAll(panels, JSON.stringify({ ...msg, room: id }));
      },
    },
    saveFile: join(dataDir, `machine-${id}.json`),
    prices: () => DEFAULT_PRICES,
  });
  game.load();
  bus.on((ev) => game.handle(ev));

  // Chat buys the machine's hype from the chat box, as it does in the city. No streamer sets anything here: the machine is
  // always on stream, its hype is for sale at the starting prices, and its switch is on.
  const chatHype = new ChatHype({
    economy,
    items: hypeItems([manifest.entry]),
    price: (item) => item.price,
    saleOn: () => true,
    onStream: () => [room.id],
    machine: () => game,
    // Coins moved, so the machine's high scores need sending again.
    boardChanged: () => game.markBoardDirty(),
  });
  // After the machine's handler: the sale only knows a viewer the machine has met.
  bus.on((ev) => {
    if (ev.kind !== 'chat') return;
    const user = economy.find(ev.platform, ev.userId);
    if (user) chatHype.handle(user, ev.text);
  });

  // 60 steps a second, kept to the clock; the fake audience ticks with them.
  const running = () => manifest.server.runsUnseen || stages.size > 0;
  let last = performance.now();
  let owed = 0;
  const stepper = setInterval(() => {
    const now = performance.now();
    owed = Math.min(owed + (now - last) / 1000, 0.25);
    last = now;
    while (owed >= DT) {
      owed -= DT;
      if (!running()) continue;
      simulator.tick(DT);
      game.step();
      if (game.sim.tick % 2 === 0 && stages.size) sendAll(stages, game.sim.snapshot());
    }
  }, 4);
  const publisher = setInterval(() => game.publish(Date.now()), 250);
  const saver = setInterval(() => {
    economy.flush();
    game.save();
    game.pruneLimits();
    chatHype.prune();
  }, 10_000);

  const server = createServer();
  const vite = opts.pages === false ? null : await pagesServer(server, machineDir);
  const media = resolve(KIT_DIR, '../../media');
  server.on('request', (req, res) => {
    // The city's coin pictures (the house logo), which kit:export copies beside the kit.
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://host').pathname);
    if (/^\/media\/coins\/[\w.-]+\.(png|webp)$/.test(path)) {
      readFile(join(media, path.slice('/media/'.length)))
        .then((data) => res.writeHead(200, { 'content-type': path.endsWith('.png') ? 'image/png' : 'image/webp' }).end(data))
        .catch(() => res.writeHead(404).end());
      return;
    }
    if (vite) vite.middlewares(req, res);
    else res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://host');
    if (url.pathname !== '/ws') return; // Vite's own (its page reloads) has its own listener
    const role = url.searchParams.get('role') === 'panel' ? 'panel' : 'stage';
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (role === 'stage') {
        stages.add(ws);
        for (const msg of [{ t: 'power', on: true }, game.hello(), game.leaders()] as ServerMsg[]) ws.send(JSON.stringify(msg));
        ws.on('close', () => stages.delete(ws));
        return;
      }
      panels.add(ws);
      ws.send(JSON.stringify({ t: 'host', machine: id, label: manifest.entry.label, bot: { enabled: simulator.enabled, rate: simulator.rate } }));
      ws.send(JSON.stringify({ t: 'board', room: id, rows: game.leaderboard() }));
      for (const item of game.recentFeed()) ws.send(JSON.stringify({ t: 'feed', room: id, item }));
      if (game.panelState) ws.send(JSON.stringify({ t: 'machine', room: id, msg: game.panelState() }));
      ws.on('message', (data) => {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(String(data)) as ClientMsg;
        } catch {
          return;
        }
        if (msg.t === 'sim.chat') simulator.sendChat(String(msg.name).slice(0, 40) || 'Viewer', msg.platform ?? 'youtube', String(msg.text).slice(0, 300));
        else if (msg.t === 'sim.bot') {
          simulator.enabled = Boolean(msg.enabled);
          simulator.rate = Math.max(0, Math.min(50, Number(msg.rate) || 0));
        } else if (msg.t === 'machine.action') game.action?.(msg.action);
        // The panel's resets, as the city's panel sends them. There's one machine here, so the room they name doesn't matter.
        else if (msg.t === 'admin.clearMachine') game.resetMachine();
        else if (msg.t === 'admin.resetMeter') game.resetMeter();
      });
      ws.on('close', () => panels.delete(ws));
    });
  });
  await new Promise<void>((ok) => server.listen(opts.port, '127.0.0.1', ok));
  const url = `http://localhost:${opts.port}`;
  let closing: Promise<void> | undefined;

  return {
    url,
    economy,
    close() {
      // Once, and every caller waits for it: a second Ctrl+C (or SIGTERM after SIGINT) mustn't exit before the machine
      // and the wallet are saved, and node:sqlite throws closing a database twice.
      closing ??= (async () => {
        clearInterval(stepper);
        clearInterval(publisher);
        clearInterval(saver);
        for (const ws of [...stages, ...panels]) ws.terminate();
        wss.close();
        await vite?.close();
        await new Promise<void>((ok) => server.close(() => ok()));
        game.save();
        // Closed, not only flushed: Windows can't delete a database that's still open (kit-host-test's folder).
        economy.close();
      })();
      return closing;
    },
  };
}

/**
 * The host's two virtual modules: the machine's stage side, and its card, or null for a machine with none (no panel.ts,
 * as the coin pusher's: the panel shows its hype buttons without a card).
 */
export function hostModules(machineDir: string): Record<'virtual:host-pages' | 'virtual:host-panel', string> {
  const panel = join(machineDir, 'panel.ts');
  return {
    'virtual:host-pages': `export { pages } from ${JSON.stringify(join(machineDir, 'pages.ts'))};`,
    'virtual:host-panel': existsSync(panel) ? `export { panel } from ${JSON.stringify(panel)};` : 'export const panel = null;',
  };
}

/** Vite, serving the host's two pages with the machine's own stage side and card. */
async function pagesServer(server: ReturnType<typeof createServer>, machineDir: string) {
  // The kit, the machine, and the project the host runs in (a machine repo's node_modules is beside its kit/).
  const { createServer: createVite, searchForWorkspaceRoot } = await import('vite');
  const virtual: Record<string, string> = hostModules(machineDir);
  return createVite({
    configFile: false,
    root: HOST_DIR,
    appType: 'mpa',
    publicDir: false,
    logLevel: 'warn',
    resolve: { alias: { '@kit': KIT_DIR } },
    server: { middlewareMode: true, hmr: { server }, fs: { allow: [resolve(KIT_DIR, '../..'), machineDir, searchForWorkspaceRoot(process.cwd())] } },
    plugins: [
      {
        name: 'coinop-host-machine',
        resolveId: (spec) => (spec in virtual ? `\0${spec}` : null),
        load: (resolved) => (resolved.startsWith('\0virtual:host-') ? virtual[resolved.slice(1)] : null),
      },
    ],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const machineDir = resolve(arg('dir') ?? join('machines', arg('machine') ?? ''));
  const { manifest } = (await import(pathToFileURL(join(machineDir, 'manifest.ts')).href)) as { manifest: MachineManifest };
  const port = Number(arg('port')) || 7811;
  const host = await startHost({ manifest, port, dataDir: resolve(arg('data') ?? 'data-host'), machineDir });
  console.log(`${manifest.entry.label} on the stand-in host:\n  stage  ${host.url}/stage.html\n  panel  ${host.url}/panel.html`);
  const stop = () => void host.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
