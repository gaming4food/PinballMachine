// The stand-in host's panel (host.ts): chat as a viewer, the fake audience's switch and rate, and the machine's own
// card from its panel.ts, with its hype buttons (each says what chat types and pays to buy it) and its Reset under the
// card, as the city's control panel shows them.
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/700.css';
import '../../client/control/style.css';
import './host.css';
import { panel } from 'virtual:host-panel';
import { hypeCaption, hypeItems } from '../../shared/hype-sale';
import { hypeOf, MACHINE_LIST, machineEntry, type RoomId } from '../../shared/machine-list';
import { DEFAULT_PRICES } from '../../shared/prices';
import type { ClientMsg, FeedItem } from '../../shared/protocol';
import { drawHype } from '../hype';
import { hypeAction } from '../hype-action';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let ws: WebSocket | null = null;
// The machine's room is any string here (the city's ClientMsg names only the rooms it knows).
const send = (msg: ClientMsg | { t: 'machine.action'; room: string; action: unknown } | { t: 'admin.clearMachine'; room: string }) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

// The machine list in a machine's own repo holds just that machine: its room. A machine with no card (no panel.ts, as
// the coin pusher's) has no card here either, and goes by its entry's name.
const room = (panel?.id ?? MACHINE_LIST[0].id) as RoomId;
const title = panel?.title ?? machineEntry(room).label;
$('host-card').hidden = !panel;
if (panel) $('host-card-title').textContent = panel.title;
const card = panel?.card($('host-card-body'), (action) => send({ t: 'machine.action', room, action }));

// Under the card, if the machine gives them: its hype buttons, from its entry, and its Reset with the machine's own
// words.
const buttons = hypeOf(room);
const hype = buttons.length
  ? drawHype($('host-hype-buttons'), buttons, (id) => send({ t: 'machine.action', room, action: hypeAction(id) }))
  : null;
$('host-hype').hidden = !hype;
// The host's chat box buys these at their starting prices (host.ts), so each button for sale says what to type and what it
// costs. A button with no sale has no line. Set once: the host's prices never change.
hype?.captions(Object.fromEntries(hypeItems([machineEntry(room)]).map((item) => [item.id, hypeCaption(item, DEFAULT_PRICES)])));
const resetWords = panel?.reset;
if (resetWords) {
  $('host-reset').hidden = false;
  $('host-reset-words').textContent = resetWords;
  const reset = $('host-reset-button');
  reset.textContent = `Reset the ${title}`;
  reset.addEventListener('click', () => {
    if (confirm(`Reset the ${title} now? ${resetWords}`)) send({ t: 'admin.clearMachine', room });
  });
}

const feed = $('host-panel-feed');
const showFeed = (item: FeedItem) => {
  const li = document.createElement('li');
  li.textContent = item.text;
  feed.prepend(li);
  while (feed.children.length > 40) feed.lastElementChild!.remove();
};

$('host-chat').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = $<HTMLInputElement>('host-text');
  if (!text.value.trim()) return;
  send({ t: 'sim.chat', name: $<HTMLInputElement>('host-name').value.trim() || 'Viewer', platform: 'youtube', text: text.value.trim() });
  text.value = '';
});
const bot = $<HTMLInputElement>('host-bot');
const rate = $<HTMLInputElement>('host-rate');
const sendBot = () => send({ t: 'sim.bot', enabled: bot.checked, rate: Number(rate.value) || 0 });
bot.addEventListener('change', sendBot);
rate.addEventListener('change', sendBot);

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=panel`);
  ws.onopen = () => ($('host-online').textContent = 'connected');
  ws.onclose = () => {
    $('host-online').textContent = 'reconnecting…';
    setTimeout(connect, 1000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as { t: string; [key: string]: unknown };
    if (msg.t === 'host') {
      $('host-title').textContent = `${String(msg.label)} on the stand-in host`;
      const state = msg.bot as { enabled: boolean; rate: number };
      bot.checked = state.enabled;
      rate.value = String(state.rate);
    } else if (msg.t === 'machine') {
      card?.message(msg.msg);
      // Which hype buttons are waiting for the next drop: null when this message isn't about that, [] when none are.
      const waiting = panel?.hypeReady?.(msg.msg);
      if (waiting) hype?.ready(waiting);
    } else if (msg.t === 'feed') showFeed(msg.item as FeedItem);
  };
}
connect();
