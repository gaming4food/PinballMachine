// The stand-in host's stage (host.ts): the city's stage trimmed to the machine. Its scene and overlay come from the
// machine's pages.ts, drawn with the city's lighting and no backdrop videos, and a small feed shows what happened.
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/monoton';
import '@fontsource/press-start-2p';
import '../../client/namefx.css';
import '../../client/stage/style.css';
import './host.css';
import { pages } from 'virtual:host-pages';
import type { FeedItem } from '../../shared/protocol';
import { StageAudio } from '../../client/stage/audio';
import { FULL_QUALITY, HEIGHT, WIDTH } from '../../client/stage/frame';
import { lookFromUrl } from '../../client/stage/looks';
import { StageNet } from '../../client/stage/net';
import { snapshotOf } from '../pages';

const stage = document.getElementById('stage')!;
const fit = () => {
  stage.style.transform = `translate(-50%, -50%) scale(${Math.min(innerWidth / WIDTH, innerHeight / HEIGHT)})`;
};
addEventListener('resize', fit);
fit();

// Browsers play sound only after a click. The platform's own moments (a coin's tray clink) play their synth here, with
// none of the platform's sound files: a machine's repo has no /media/sfx/ (kit:export copies only media/coins). The
// machine's own files still play (StageSynth.sample).
const audio = new StageAudio(false, 'all', {});
addEventListener('pointerdown', () => void audio.resume());

const scene = new pages.stage.Scene(document.getElementById('gl') as HTMLCanvasElement, document.getElementById('labels')!, lookFromUrl(), audio, true, false, FULL_QUALITY, false);
void document.fonts.ready.then(() => scene.paintSigns());
const overlay = pages.stage.overlay?.(document.getElementById('machine-overlay')!) ?? null;
const machineMessage = (msg: unknown) => {
  overlay?.message(msg);
  scene.machineMessage?.(msg);
};

const feed = document.getElementById('host-feed')!;
const showFeed = (items: FeedItem[]) => {
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item.text;
    feed.append(li);
  }
  while (feed.children.length > 6) feed.firstElementChild!.remove();
};
const offline = document.getElementById('host-offline')!;
const snapshot = snapshotOf(pages);

const net = new StageNet(
  {
    onHello: (msg) => {
      scene.reset();
      feed.replaceChildren();
      showFeed(msg.feed);
      scene.setLeader(msg.board[0]?.name ?? null, msg.board[0]?.balance ?? 0);
      if (msg.machine !== undefined) machineMessage(msg.machine);
    },
    onTimed: (msg) => {
      if (msg.t !== 'score') return;
      scene.popScore(`+${msg.amount} ${msg.name}`, msg.color, msg.x, msg.fx);
      // The machine's own sound for a win, if it has one (MachineScene.score).
      scene.score?.(msg);
    },
    onMessage: (msg) => {
      if (msg.t === 'machine') machineMessage(msg.msg);
      else if (msg.t === 'feed') showFeed([msg.item]);
      else if (msg.t === 'board') scene.setLeader(msg.rows[0]?.name ?? null, msg.rows[0]?.balance ?? 0);
    },
    onConnection: (online) => {
      offline.hidden = online;
    },
  },
  pages.id,
  'full',
  false,
  snapshot ? [snapshot] : [],
  scene,
  snapshot?.type,
);
net.connect();

let last = performance.now();
const frame = (now: number) => {
  requestAnimationFrame(frame);
  const t = net.renderTime(now / 1000);
  net.releaseTimed(t);
  scene.update(net, t, Math.min(0.1, (now - last) / 1000));
  overlay?.tick(t);
  last = now;
};
requestAnimationFrame(frame);
