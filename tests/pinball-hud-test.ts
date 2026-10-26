// Tests the pinball's scoreboard over the stage (PinballHud, stage/pinball-hud.ts): the balls on the table with their
// owners and scores, the next 3 in line, the words to type (which the layout's Play commands switch hides, as the
// claw's), a ball's result, and the big titles: MULTIBALL!, BALL SAVED!, DOUBLE SCORE!, a bank's when its plaques match
// (HORUS MATCHED, RA MATCHED, ANKH MATCHED and EYE MATCHED) and a ball's result, each as the stage draws its time. And
// the Pharaoh's quest: the banner of the mode that runs (its names, its goal's progress and a bar of its time counting
// down as the stage draws), the finale's, the four god lamps, and the quest's titles from its cues.
// Built in Node from fake elements, as the claw's turn box is tested.
// Usage: npm run pinball-hud-test
import assert from 'node:assert/strict';
import { type God, GOD_COLOR, GODS, type PinballHypeMsg, type PinballState, QUEST, RULES, tombPrize } from '../src/shared/pinball';
// The overlay is the stage's: its CSS and any pictures and sound files are stubbed (stub-assets.ts), so it loads in Node.
import './stub-assets';

const { PinballHud, ballSaved, TITLE_SECONDS, pinballOverlay, isFullFrame } = await import('../src/stage/pinball');

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** An element's style as the scoreboard uses it: plain properties, and custom ones (--c) through setProperty. */
class FakeStyle {
  color = '';
  width = '';
  private readonly custom = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.custom.set(name, value);
  }
  removeProperty(name: string): string {
    const was = this.custom.get(name) ?? '';
    this.custom.delete(name);
    return was;
  }
  getPropertyValue(name: string): string {
    return this.custom.get(name) ?? '';
  }
}

/** Just enough of an element for the scoreboard to be built in Node, and read. */
class FakeElement {
  id = '';
  className = '';
  innerHTML = '';
  textContent = '';
  hidden = false;
  readonly dataset: Record<string, string> = {};
  readonly style = new FakeStyle();
  children: FakeElement[] = [];
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children = [...nodes];
  }
  find(match: (el: FakeElement) => boolean): FakeElement | null {
    if (match(this)) return this;
    for (const child of this.children) {
      const found = child.find(match);
      if (found) return found;
    }
    return null;
  }
  byId(id: string): FakeElement | null {
    return this.find((el) => el.id === id);
  }
  byClass(name: string): FakeElement | null {
    return this.find((el) => el.className.split(' ').includes(name));
  }
  /** Everything it says: its own text and markup (tags dropped), then its children's. */
  text(): string {
    return [this.textContent, this.innerHTML.replace(/<[^>]*>/g, ''), ...this.children.map((c) => c.text())].filter(Boolean).join(' ');
  }
}

const state = (more: Partial<PinballState> = {}): PinballState => ({
  phase: 'idle',
  balls: [],
  line: [],
  multiball: false,
  doubleUntil: null,
  saverUntil: null,
  lockLit: false,
  lastResult: null,
  waiting: [],
  quest: { done: [], mode: null, finale: null },
  events: { sandstorm: null, curse: null, mummy: null },
  ...more,
});
const moment = (id: string, at: number, more: Partial<PinballHypeMsg> = {}): PinballHypeMsg => ({ kind: 'pinballHype', id, at, ...more });
const msgOf = (s: PinballState) => ({ kind: 'pinball', state: s });

type Quest = PinballState['quest'];
type Mode = NonNullable<Quest['mode']>;
const quest = (more: Partial<Quest> = {}): Quest => ({ done: [], mode: null, finale: null, ...more });
/** A god's mode that runs: all its time left at the table's time 100, with a ball in play and no goal hit yet. */
const mode = (god: God, more: Partial<Mode> = {}): Mode => ({ god, left: QUEST.modeSeconds, at: 100, running: true, progress: 0, goal: QUEST.goals[god], ...more });
/** A cue as the server sends it, at the table's time `at`; `rest` is the cue's kind and its fields. */
const cue = (at: number, rest: { cue: string } & Record<string, unknown>) => ({ kind: 'pinballCue', at, ...rest });

const money = (n: number) => n.toLocaleString('en-US');
/** Text with its non-breaking spaces as plain ones, for comparing what it says. */
const plain = (s: string) => s.replace(/\u00a0/g, ' ');
/** A colour as the stage writes it in CSS. */
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
/** The gold of the jackpot's and the finale's titles, and of the finale's banner: Ra's. */
const GOLD = GOD_COLOR.ra;

/**
 * A scoreboard built from fake elements, and its parts. `made` counts the elements it has made so far. With `panel`, it
 * is made as the full layout makes it, given the city's right-column panel (#machine-panel) besides the overlay's slot;
 * its parts are then looked for in the panel.
 */
function board(opts: { panel?: boolean } = {}) {
  let made = 0;
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      made++;
      return new FakeElement();
    },
  };
  const slot = new FakeElement();
  const panel = opts.panel ? new FakeElement() : null;
  const hud = new PinballHud(slot as unknown as HTMLElement, panel as unknown as HTMLElement | null);
  const part = (name: string) => {
    const el = (panel ?? slot).byClass(name);
    assert.ok(el, `the scoreboard has .${name}`);
    return el;
  };
  const title = slot.byId('pinball-title');
  assert.ok(title, 'the overlay has a big title (#pinball-title)');
  const words = title.byClass('title-words');
  const by = title.byClass('title-by');
  assert.ok(words && by, 'the title holds its words (.title-words) and a line over them (.title-by)');
  /** What the title shows: its words, or null when hidden. */
  const shown = () => (title.hidden ? null : words.textContent);
  return { hud, slot, panel, part, title, shown, by, made: () => made };
}

test('with a panel (the full layout), the scoreboard is drawn in the panel, once, and not over the stage', () => {
  const { hud, slot, panel, part } = board({ panel: true });
  assert.ok(panel);
  const inPanel = panel.byId('pinball-hud');
  assert.ok(inPanel, 'the panel holds #pinball-hud');
  assert.equal(slot.byId('pinball-hud'), null, 'the overlay over the stage has no scoreboard');
  assert.equal(inPanel.dataset.place, 'panel', "it is marked for the panel's look (pinball.css)");
  panel.hidden = true;
  hud.message(msgOf(state()));
  assert.equal(panel.hidden, false, 'the panel is shown whenever the scoreboard draws into it, whatever the host did before');
  hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: 7, name: 'Alex', score: 12345, color: null }], line: [{ userId: 2, name: 'Bea' }], quest: quest({ done: ['ra'], mode: mode('horus') }) })));
  for (const name of ['pinball-gods', 'pinball-banner', 'pinball-ball', 'pinball-next', 'pinball-type']) {
    assert.ok(inPanel.byClass(name), `.${name} is in the panel`);
    assert.equal(slot.byClass(name), null, `.${name} is not over the stage`);
  }
  assert.ok(part('pinball-ball').text().includes('12,345'), 'the panel shows the play');
  assert.ok(part('pinball-banner').text().includes('FALCON'), "and the mode's banner");
});

test('with a panel, the big title stays over the table (in the overlay), not in the panel', () => {
  const { hud, slot, panel, shown } = board({ panel: true });
  assert.ok(panel);
  assert.ok(slot.byId('pinball-title'), 'the overlay has #pinball-title');
  assert.equal(panel.byId('pinball-title'), null, 'the panel has none');
  hud.message(moment('multiball', 10));
  hud.tick(10);
  assert.equal(shown(), 'MULTIBALL!');
});

test('without a panel (corner, 9:16), the scoreboard is over the stage as before, unmarked', () => {
  const { slot } = board();
  const root = slot.byId('pinball-hud');
  assert.ok(root, 'the overlay holds #pinball-hud');
  assert.equal(root.dataset.place, undefined, 'with no mark: its look is the one under the table');
  assert.deepEqual(slot.children.map((c) => c.id), ['pinball-hud', 'pinball-title'], 'the scoreboard, then the title, as before');
});

test("the overlay tells the scene the layout: full (the machine fills the frame's height) with a panel, not without", () => {
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeElement() };
  pinballOverlay(new FakeElement() as unknown as HTMLElement, new FakeElement() as unknown as HTMLElement);
  assert.equal(isFullFrame(), true, 'a panel: the full layout');
  pinballOverlay(new FakeElement() as unknown as HTMLElement, null);
  assert.equal(isFullFrame(), false, 'no panel: corner or 9:16');
});

test('a state with two in line shows both names in .pinball-next, in order', () => {
  const { hud, part } = board();
  hud.message(msgOf(state({ phase: 'launching', line: [{ userId: 1, name: 'Alex' }, { userId: 2, name: 'Bea' }] })));
  const next = part('pinball-next');
  assert.equal(next.hidden, false, 'shown');
  const text = next.text();
  assert.ok(text.includes('Alex') && text.includes('Bea'), `both names (${text})`);
  assert.ok(text.indexOf('Alex') < text.indexOf('Bea'), 'Alex first');
});

test('the line shows at most the next 3, and how many more', () => {
  const { hud, part } = board();
  const line = ['Alex', 'Bea', 'Cy', 'Dee', 'Eve'].map((name, i) => ({ userId: i + 1, name }));
  hud.message(msgOf(state({ phase: 'playing', line })));
  const text = part('pinball-next').text();
  for (const name of ['Alex', 'Bea', 'Cy']) assert.ok(text.includes(name), `${name} is next (${text})`);
  for (const name of ['Dee', 'Eve']) assert.ok(!text.includes(name), `${name} isn't shown (${text})`);
  assert.ok(text.includes('+2'), `and how many more (${text})`);
});

test('an empty line hides .pinball-next', () => {
  const { hud, part } = board();
  hud.message(msgOf(state({ line: [{ userId: 1, name: 'Alex' }] })));
  hud.message(msgOf(state()));
  assert.equal(part('pinball-next').hidden, true);
});

test("the ball on the table: its owner's name and its score; a house ball says so", () => {
  const { hud, part } = board();
  hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: 7, name: 'Alex', score: 12345, color: null }] })));
  const text = part('pinball-ball').text();
  assert.ok(text.includes('Alex') && text.includes('12,345'), text);
  hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: null, name: null, score: 40, color: null }] })));
  assert.ok(part('pinball-ball').text().includes('HOUSE'), part('pinball-ball').text());
});

test('a chat name is text, never markup', () => {
  const { hud, part } = board();
  hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: 7, name: '<b>x</b>', score: 1, color: null }], line: [{ userId: 2, name: '<i>y</i>' }] })));
  const ball = part('pinball-ball');
  const next = part('pinball-next');
  for (const el of [ball, next]) assert.ok(!el.find((e) => e.innerHTML.includes('<i>') || e.innerHTML.includes('<b>x')), 'no name goes in as markup');
  assert.ok(ball.text().includes('<b>x</b>') && next.text().includes('<i>y</i>'), 'they show as typed');
});

test('the words to type are there, marked .cmd for the Play commands switch to hide', () => {
  const { hud, part } = board();
  hud.message(msgOf(state()));
  const type = part('pinball-type');
  assert.ok(type.className.split(' ').includes('cmd'), 'the line is .cmd');
  const text = type.text();
  for (const word of ['TYPE', 'BALL', 'LEFT', 'RIGHT']) assert.ok(text.includes(word), `${word} (${text})`);
});

test('a pinballHype moment for multiball shows MULTIBALL! at its time, for its time', () => {
  const { hud, shown, title } = board();
  hud.message(msgOf(state()));
  hud.message(moment('multiball', 10));
  hud.tick(9.9);
  assert.equal(shown(), null, 'not before its time');
  hud.tick(10);
  assert.equal(shown(), 'MULTIBALL!');
  assert.equal(title.dataset.title, 'multiball', 'in its colour (data-title)');
  hud.tick(10 + TITLE_SECONDS);
  assert.equal(shown(), null, 'gone');
});

test("a bank's moment shows its title: HORUS, RA, ANKH and EYE MATCHED", () => {
  const { hud, shown } = board();
  let at = 10;
  for (const name of ['HORUS', 'RA', 'ANKH', 'EYE']) {
    hud.message(moment(`bank-${name.toLowerCase()}`, at));
    hud.tick(at);
    assert.equal(shown(), `${name} MATCHED`);
    at += TITLE_SECONDS + 1;
  }
});

test("a bought moment names its buyer over the title, in their colour; the streamer's has no name line", () => {
  const { hud, shown, by } = board();
  hud.message(moment('double', 10, { by: { name: 'Alex', color: 0x22ff88 } }));
  hud.tick(10);
  assert.equal(shown(), 'DOUBLE SCORE!');
  assert.equal(by.textContent, 'Alex');
  assert.equal(by.style.color, '#22ff88');
  assert.equal(by.hidden, false);
  hud.message(moment('saver', 20));
  hud.tick(20);
  assert.equal(shown(), 'BALL SAVER!');
  assert.equal(by.hidden, true);
});

test('multiball started by the lock (no moment) shows MULTIBALL! from the state; one from a press shows once', () => {
  const { hud, shown } = board();
  hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: 1, name: 'Alex', score: 0, color: null }] })));
  hud.tick(5);
  hud.message(msgOf(state({ phase: 'playing', multiball: true })));
  hud.tick(5.1);
  assert.equal(shown(), 'MULTIBALL!', 'from the lock');
  hud.tick(5.1 + TITLE_SECONDS);
  assert.equal(shown(), null);
  hud.message(msgOf(state({ phase: 'playing', multiball: false })));
  // A press: the moment comes first, then the state with multiball on.
  hud.message(moment('multiball', 20));
  hud.message(msgOf(state({ phase: 'playing', multiball: true })));
  hud.tick(20);
  assert.equal(shown(), 'MULTIBALL!');
  hud.tick(20 + TITLE_SECONDS);
  assert.equal(shown(), null, 'once, not twice');
});

test("the table's clock starting again (the server restarted) leaves no title stuck, and the next ones show", () => {
  const { hud, shown } = board();
  hud.message(msgOf(state({ phase: 'playing' })));
  hud.tick(600);
  hud.message(msgOf(state({ phase: 'playing', multiball: true })));
  hud.tick(600.1);
  assert.equal(shown(), 'MULTIBALL!', 'from the lock, on the old clock');
  hud.message(moment('double', 600.5));
  hud.message(moment('saver', 900));
  // The server restarts mid-title: its clock starts again from 0, and the page carries on.
  hud.tick(0.5);
  assert.equal(shown(), null, "the old clock's title goes");
  hud.message(moment('nudge', 1));
  hud.tick(1);
  assert.equal(shown(), 'NUDGE!', 'a new title shows at its time');
  hud.tick(1 + TITLE_SECONDS);
  assert.equal(shown(), null, 'and goes after its own 2.2 s');
  hud.message(msgOf(state({ phase: 'playing', multiball: false })));
  hud.tick(5);
  hud.message(msgOf(state({ phase: 'playing', multiball: true })));
  hud.tick(5.1);
  assert.equal(shown(), 'MULTIBALL!', "the lock's multiball, not taken for the old clock's");
  hud.tick(5.1 + TITLE_SECONDS);
  hud.tick(901);
  assert.equal(shown(), null, "the old clock's waiting titles were let go");
});

test('a saved ball shows BALL SAVED! (the stage saw it drain and come straight back)', () => {
  const { hud, shown } = board();
  hud.tick(30);
  ballSaved(30);
  hud.tick(30.05);
  assert.equal(shown(), 'BALL SAVED!');
});

test("a state with lastResult shows its name, points and coins; a new one gets the big title, hello's doesn't", () => {
  const { hud, part, shown, by } = board();
  hud.message(msgOf(state({ lastResult: { name: 'Bea', points: 800, coins: 0 } })));
  hud.tick(1);
  assert.equal(shown(), null, 'the result already there when the page opened gets no title');
  hud.message(msgOf(state({ lastResult: { name: 'Alex', points: 12345, coins: 12 } })));
  const text = part('pinball-result').text();
  assert.ok(text.includes('Alex') && text.includes('12,345') && text.includes('12 COINS'), text);
  hud.tick(2);
  assert.equal(shown(), '12,345 POINTS');
  assert.ok(by.textContent.includes('Alex') && by.textContent.includes('12 COINS'), by.textContent);
});

/** The share of the mode's time the banner's bar shows (its width, a percentage). */
const barShare = (fill: FakeElement) => parseFloat(fill.style.width) / 100;
/** How close the bar is held to the time it should show: a tenth of a percent, a fraction of a pixel of it. */
const nearShare = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) < 0.002, `${what}: the bar shows ${got}, not ${want}`);

test('the banner shows the running mode: its names, its progress, and its time counting down while a ball is in play, held while not', () => {
  const { hud, part } = board();
  const banner = part('pinball-banner');
  const names = part('names');
  const goal = part('goal');
  const fill = part('fill');
  hud.message(msgOf(state()));
  assert.equal(banner.hidden, true, 'no banner with no mode running');

  // Each mode's god and name, and what its goal has counted.
  const modes: [God, string, string][] = [
    ['ra', 'RA · SUN CHASE', 'SHOTS'],
    ['horus', 'HORUS · FALCON STRIKE', 'FALCONS'],
    ['ankh', 'ANKH · THE MUMMY WAKES', 'MUMMY'],
  ];
  for (const [god, named, label] of modes) {
    hud.message(msgOf(state({ phase: 'playing', quest: quest({ mode: mode(god, { progress: 2 }) }) })));
    hud.tick(100);
    assert.equal(banner.hidden, false, `${god}'s banner shows`);
    assert.equal(names.textContent, named);
    assert.equal(goal.textContent, `${label} 2/${QUEST.goals[god]}`);
    assert.equal(banner.style.getPropertyValue('--c'), css(GOD_COLOR[god]), `${god}'s banner takes its god's colour`);
  }

  // Its time is counted down from the table's time the state was made at, as the stage draws it: smoothly.
  hud.message(msgOf(state({ phase: 'playing', quest: quest({ mode: mode('ra', { left: 20, at: 100 }) }) })));
  hud.tick(100);
  nearShare(barShare(fill), 20 / QUEST.modeSeconds, "at the state's time");
  hud.tick(105);
  nearShare(barShare(fill), 15 / QUEST.modeSeconds, '5 s on');
  hud.tick(110.5);
  nearShare(barShare(fill), 9.5 / QUEST.modeSeconds, 'between whole seconds');

  // The stage draws a little behind the server: before the state's time the bar can't be fuller than the whole mode.
  hud.message(msgOf(state({ phase: 'playing', quest: quest({ mode: mode('ra', { left: QUEST.modeSeconds, at: 200 }) }) })));
  hud.tick(199.9);
  nearShare(barShare(fill), 1, "before the state's time");
  // And past the end of its time it is empty, never less.
  hud.tick(200 + QUEST.modeSeconds + 5);
  nearShare(barShare(fill), 0, 'after the time is up');

  // A ball drained: the clock stops, and the bar holds where the state left it however long the table waits.
  hud.message(msgOf(state({ phase: 'launching', quest: quest({ mode: mode('ra', { left: 12, at: 300, running: false }) }) })));
  hud.tick(300);
  nearShare(barShare(fill), 12 / QUEST.modeSeconds, 'held');
  hud.tick(330);
  nearShare(barShare(fill), 12 / QUEST.modeSeconds, 'held 30 s on');
  // The next ball: it counts down again from the state's time.
  hud.message(msgOf(state({ phase: 'playing', quest: quest({ mode: mode('ra', { left: 12, at: 340, running: true }) }) })));
  hud.tick(345);
  nearShare(barShare(fill), 7 / QUEST.modeSeconds, 'running again');

  // The mode ends (won: the god is crossed off), and the banner goes with it.
  hud.message(msgOf(state({ quest: quest({ done: ['ra'] }) })));
  assert.equal(banner.hidden, true, 'the banner goes when the mode does');
});

test("Tomb Raid's banner counts its prize down with its time; the finale's shows the next jackpot", () => {
  const { hud, part } = board();
  const banner = part('pinball-banner');
  const names = part('names');
  const goal = part('goal');
  const bar = part('bar');
  const fill = part('fill');
  const gods = part('pinball-gods');
  const eye = (more: Partial<Mode> = {}) => msgOf(state({ phase: 'playing', quest: quest({ done: ['ra', 'horus', 'ankh'], mode: mode('eye', more) }) }));
  hud.message(eye());
  hud.tick(100);
  assert.equal(names.textContent, 'EYE · TOMB RAID');
  assert.equal(goal.textContent, `PRIZE ${money(tombPrize(QUEST.modeSeconds))}`, 'the prize with all the time left');

  // The prize falls with the time, and agrees with the bar at every moment: both come from the one time drawn.
  let last = Infinity;
  for (const t of [100, 107, 114, 121, 128]) {
    hud.tick(t);
    const left = QUEST.modeSeconds - (t - 100);
    assert.equal(goal.textContent, `PRIZE ${money(tombPrize(left))}`, `with ${left} s left`);
    nearShare(barShare(fill), left / QUEST.modeSeconds, `with ${left} s left`);
    assert.ok(tombPrize(left) < last, `the prize fell (${tombPrize(left)} after ${last})`);
    last = tombPrize(left);
  }

  // No ball in play: the time is held, and so is the prize.
  hud.message(eye({ left: 18, at: 130, running: false }));
  hud.tick(130);
  assert.equal(goal.textContent, `PRIZE ${money(tombPrize(18))}`);
  hud.tick(150);
  assert.equal(goal.textContent, `PRIZE ${money(tombPrize(18))}`, 'held while the table waits');

  // The finale: Pharaoh's Gold with the jackpot the next ball in the tomb pays, in gold, with no bar or goal.
  const jackpot = QUEST.jackpot.first + QUEST.jackpot.step;
  hud.message(msgOf(state({ phase: 'playing', multiball: true, quest: quest({ done: [...GODS], finale: { jackpot } }) })));
  hud.tick(160);
  assert.equal(banner.hidden, false);
  assert.equal(names.textContent, `PHARAOH'S GOLD · JACKPOT ${money(jackpot)}`);
  assert.equal(banner.style.getPropertyValue('--c'), css(GOLD), 'in gold');
  assert.equal(bar.hidden, true, 'no time bar in the finale');
  assert.equal(goal.hidden, true, 'and no goal');
  // A ball in the tomb pays it, and the banner shows the next.
  hud.message(msgOf(state({ phase: 'playing', multiball: true, quest: quest({ done: [...GODS], finale: { jackpot: jackpot + QUEST.jackpot.step } }) })));
  assert.equal(names.textContent, `PHARAOH'S GOLD · JACKPOT ${money(jackpot + QUEST.jackpot.step)}`);

  // A finale a restart saved waits for a ball: no banner yet, but the lamps show, all four lit.
  hud.message(msgOf(state({ phase: 'idle', quest: quest({ done: [...GODS] }) })));
  assert.equal(banner.hidden, true);
  assert.equal(gods.hidden, false);
  assert.deepEqual(gods.children.map((lamp) => lamp.dataset.lit), ['on', 'on', 'on', 'on']);
  // The quest starts over, and the next mode shows its bar and its goal again.
  hud.message(msgOf(state({ phase: 'playing', quest: quest({ mode: mode('horus', { progress: 1 }) }) })));
  assert.equal(banner.hidden, false);
  assert.equal(bar.hidden, false);
  assert.equal(goal.hidden, false);
  assert.equal(goal.textContent, `FALCONS 1/${QUEST.goals.horus}`);
  // And the Eye's again, with the time and so the prize it last showed: its prize comes back over the other's goal.
  hud.message(eye({ left: 18, at: 170, running: false }));
  hud.tick(170);
  assert.equal(goal.textContent, `PRIZE ${money(tombPrize(18))}`);
});

test('the god lamps light as gods are crossed off, and go when the quest starts over', () => {
  const { hud, part } = board();
  const gods = part('pinball-gods');
  const lit = () => gods.children.filter((lamp) => lamp.dataset.lit === 'on').map((lamp) => lamp.dataset.god);
  hud.message(msgOf(state()));
  assert.equal(gods.hidden, true, 'a quest with nothing in it shows no lamps');
  assert.deepEqual(gods.children.map((lamp) => lamp.dataset.god), [...GODS], "four lamps, in the quest's order");
  assert.deepEqual(gods.children.map((lamp) => lamp.style.getPropertyValue('--c')), GODS.map((god) => css(GOD_COLOR[god])), "each in its god's colour");

  // A mode running shows them, all dark: no god is crossed off yet.
  hud.message(msgOf(state({ phase: 'playing', quest: quest({ mode: mode('ra') }) })));
  assert.equal(gods.hidden, false);
  assert.deepEqual(lit(), []);
  // Ra's won: the mode is over, and one god is enough to show them.
  hud.message(msgOf(state({ phase: 'playing', quest: quest({ done: ['ra'] }) })));
  assert.equal(gods.hidden, false);
  assert.deepEqual(lit(), ['ra']);
  // Horus too, with the Ankh's mode running.
  hud.message(msgOf(state({ phase: 'playing', quest: quest({ done: ['ra', 'horus'], mode: mode('ankh') }) })));
  assert.deepEqual(lit(), ['ra', 'horus']);
  // The fourth is the finale: all four are lit.
  hud.message(msgOf(state({ phase: 'playing', multiball: true, quest: quest({ done: [...GODS], finale: { jackpot: QUEST.jackpot.first } }) })));
  assert.deepEqual(lit(), [...GODS]);
  // The finale ends with multiball, and the quest starts over: the lamps go out and away.
  hud.message(msgOf(state({ phase: 'playing', quest: quest() })));
  assert.deepEqual(lit(), []);
  assert.equal(gods.hidden, true);
});

/** Decision 4's titles: each god's mode, by its name (its start, and its win with the prize after it) and its loss. */
const MODE_TITLES: Record<God, { name: string; lost: string }> = {
  ra: { name: 'SUN CHASE!', lost: 'THE SUN SETS' },
  horus: { name: 'FALCON STRIKE!', lost: 'THE FALCON FLIES' },
  ankh: { name: 'THE MUMMY WAKES!', lost: 'THE MUMMY SLEEPS' },
  eye: { name: 'TOMB RAID!', lost: 'THE TOMB SEALS' },
};

test("each quest title at its time, in its colour: a mode's start, won with its prize, lost, a jackpot, the finale", () => {
  const { hud, shown, title } = board();
  hud.message(msgOf(state()));
  let at = 10;
  /** One cue's title: not before its time, its words and its colour at it, and gone TITLE_SECONDS on. */
  const plays = (rest: { cue: string } & Record<string, unknown>, words: string, color: number) => {
    hud.message(cue(at, rest));
    hud.tick(at - 0.1);
    assert.equal(shown(), null, `${words}: not before its time`);
    hud.tick(at);
    assert.equal(shown(), words);
    assert.equal(title.style.getPropertyValue('--c'), css(color), `${words}: in its colour`);
    hud.tick(at + TITLE_SECONDS);
    assert.equal(shown(), null, `${words}: gone after ${TITLE_SECONDS} s`);
    at += TITLE_SECONDS + 1;
  };
  for (const god of GODS) {
    const { name, lost } = MODE_TITLES[god];
    // Tomb Raid pays its countdown, which the cue carries; the others pay the mode's prize.
    const prize = god === 'eye' ? tombPrize(12) : QUEST.prize;
    plays({ cue: 'modeStart', god }, name, GOD_COLOR[god]);
    plays({ cue: 'modeWon', god, prize }, `${name} +${money(prize)}`, GOD_COLOR[god]);
    plays({ cue: 'modeLost', god }, lost, GOD_COLOR[god]);
  }
  const jackpot = QUEST.jackpot.first + QUEST.jackpot.step;
  plays({ cue: 'jackpot', value: jackpot, x: 0, z: 0 }, `JACKPOT ${money(jackpot)}!`, GOLD);
  plays({ cue: 'finale' }, "PHARAOH'S GOLD!", GOLD);

  // A goal hit, a toy's hit and the finale's end have no title, and a cue that isn't one shows nothing.
  const none = [
    cue(at, { cue: 'goal', god: 'ra', x: 0, z: 0 }),
    cue(at, { cue: 'toyHit', part: 'target-mummy', down: false, x: 0, z: 0 }),
    cue(at, { cue: 'finaleEnd' }),
    cue(at, { cue: 'modeStart', god: 'osiris' }),
    cue(at, { cue: 'jackpot', value: 'lots', x: 0, z: 0 }),
  ];
  for (const msg of none) {
    hud.message(msg);
    hud.tick(at);
    assert.equal(shown(), null, `${msg.cue} has no title`);
  }
  // The next title with no colour of its own takes its look back: the quest's colour doesn't stay on it.
  hud.message(moment('multiball', at + 1));
  hud.tick(at + 1);
  assert.equal(shown(), 'MULTIBALL!');
  assert.equal(title.style.getPropertyValue('--c'), '', "a quest title's colour is not left on the next title");
});

test("each event's title names its buyer; MUMMY DOWN! +10,000 shows at its cue's time in gold", () => {
  const { hud, shown, title, by } = board();
  hud.message(msgOf(state()));
  let at = 10;
  for (const [id, words] of [['sandstorm', 'SANDSTORM!'], ['curse', "PHARAOH'S CURSE!"], ['mummy', 'THE MUMMY RISES!']] as const) {
    hud.message(moment(id, at, { by: { name: 'Alex', color: 0x22ff88 } }));
    hud.tick(at - 0.1);
    assert.equal(shown(), null, `${words}: not before its time`);
    hud.tick(at);
    assert.equal(shown(), words);
    assert.equal(by.textContent, 'Alex', `${words} names its buyer`);
    hud.tick(at + TITLE_SECONDS);
    assert.equal(shown(), null, `${words}: gone`);
    at += TITLE_SECONDS + 1;
  }
  hud.message(cue(at, { cue: 'summonDown', value: RULES.summonPrize, x: 1, z: 2 }));
  hud.tick(at - 0.1);
  assert.equal(shown(), null, 'not before its cue');
  hud.tick(at);
  assert.equal(shown(), `MUMMY DOWN! +${money(RULES.summonPrize)}`);
  assert.equal(shown(), 'MUMMY DOWN! +10,000');
  assert.equal(title.style.getPropertyValue('--c'), css(GOLD), 'in gold');
  hud.tick(at + TITLE_SECONDS);
  assert.equal(shown(), null, 'gone');
});

test('the flags show while each event lasts, from the state alone, and go when it ends', () => {
  const { hud, part } = board();
  const flags = part('pinball-flags');
  // A page opened late: its first state already has the events on.
  hud.message(msgOf(state({ phase: 'playing', events: { sandstorm: { until: 150, dir: 1 }, curse: { until: 140 }, mummy: { until: 130 } } })));
  assert.equal(flags.hidden, false);
  assert.equal(plain(flags.textContent), 'SANDSTORM · CURSED · MUMMY');
  hud.message(msgOf(state({ phase: 'playing', events: { sandstorm: { until: 150, dir: -1 }, curse: null, mummy: null } })));
  assert.equal(flags.textContent, 'SANDSTORM');
  hud.message(msgOf(state({ phase: 'playing', multiball: true, events: { sandstorm: null, curse: { until: 160 }, mummy: null } })));
  assert.equal(plain(flags.textContent), 'MULTIBALL · CURSED');
  hud.message(msgOf(state({ phase: 'playing' })));
  assert.equal(flags.hidden, true, 'gone when each ends');
  assert.equal(flags.textContent, '');
});

test('a flag wraps only as a whole: a line of flags breaks only after a separator, never inside BALL SAVER or LOCK LIT', () => {
  const { hud, part } = board();
  hud.message(msgOf(state({ phase: 'playing', multiball: true, doubleUntil: 130, saverUntil: 120, lockLit: true })));
  const text = part('pinball-flags').textContent;
  assert.equal(plain(text), 'MULTIBALL · 2× SCORE · BALL SAVER · LOCK LIT');
  // The places a line may break (ordinary spaces) are exactly one after each separator.
  const breaks = [...text.matchAll(/ /g)].map((m) => m.index);
  const after = [...text.matchAll(/·/g)].map((m) => (m.index ?? 0) + 1);
  assert.deepEqual(breaks, after, `breaks only after a dot (${JSON.stringify(text)})`);
  for (const flag of ['2×\u00a0SCORE', 'BALL\u00a0SAVER', 'LOCK\u00a0LIT']) assert.ok(text.includes(flag), `${JSON.stringify(flag)} is held together`);
});

test("a page opened mid-mode shows the banner and the lamps from hello's state, and no title", () => {
  const { hud, part, shown } = board();
  // The page has been drawing a while: the table's time is known from the snapshots before hello's state comes.
  hud.tick(500);
  hud.message(msgOf(state({ phase: 'playing', quest: quest({ done: ['ra'], mode: mode('horus', { left: 18, at: 499.8, progress: 1 }) }) })));
  assert.equal(part('pinball-banner').hidden, false);
  assert.equal(part('names').textContent, 'HORUS · FALCON STRIKE');
  assert.equal(part('goal').textContent, `FALCONS 1/${QUEST.goals.horus}`);
  const gods = part('pinball-gods');
  assert.equal(gods.hidden, false);
  assert.deepEqual(gods.children.filter((lamp) => lamp.dataset.lit === 'on').map((lamp) => lamp.dataset.god), ['ra']);
  hud.tick(500);
  nearShare(barShare(part('fill')), (18 - 0.2) / QUEST.modeSeconds, 'its time as drawn');
  for (const t of [500.1, 501, 503, 510]) {
    hud.tick(t);
    assert.equal(shown(), null, `no title at ${t}`);
  }
});

/**
 * The titles that show, in order, with the time each first showed, as the stage draws every `step` seconds from `from`
 * to `to`: each once, however many frames it is up for (the stage restarts its animation for each, flipping data-run).
 */
function titlesShown({ hud, shown, title }: ReturnType<typeof board>, from: number, to: number, step = 0.05): { words: string; at: number }[] {
  const seen: { words: string; at: number }[] = [];
  let run: string | undefined;
  for (let i = 0; from + i * step <= to; i++) {
    const t = from + i * step;
    hud.tick(t);
    const words = shown();
    if (words !== null && title.dataset.run !== run) seen.push({ words, at: t });
    run = words === null ? undefined : title.dataset.run;
  }
  return seen;
}
/** Whether a title first showed at `want`, to the frame (the step it was looked for at). */
const showedAt = (got: { at: number }, want: number, step = 0.05) => Math.abs(got.at - want) <= step + 1e-9;

test("a bank's match shows its title and then the mode it starts, each in its turn", () => {
  const { hud, shown } = board();
  hud.message(msgOf(state({ phase: 'playing' })));
  hud.tick(9);
  // The bank's title (a hype moment) and the mode's start come at the same moment: the start is second in line, and is
  // shown when the first is done, TITLE_SECONDS after its moment.
  hud.message(moment('bank-horus', 10));
  hud.message(cue(10, { cue: 'modeStart', god: 'horus' }));
  hud.tick(10);
  assert.equal(shown(), 'HORUS MATCHED');
  hud.tick(10 + TITLE_SECONDS);
  assert.equal(shown(), 'FALCON STRIKE!', 'its turn');
  hud.tick(10 + 2 * TITLE_SECONDS);
  assert.equal(shown(), null, 'and gone after its own time');
});

test("the fourth god's win shows its prize and then PHARAOH'S GOLD!, with no MULTIBALL! for the finale's multiball", () => {
  const b = board();
  const prize = tombPrize(12);
  b.hud.message(msgOf(state({ phase: 'playing', quest: quest({ done: ['ra', 'horus', 'ankh'], mode: mode('eye', { at: 90 }) }) })));
  b.hud.tick(99.9);
  // At the moment of the win the cues come, and the state with the finale begun and its multiball on. The stage draws a
  // little behind the server, so the cues wait for their time.
  b.hud.message(cue(100, { cue: 'modeWon', god: 'eye', prize }));
  b.hud.message(cue(100, { cue: 'finale' }));
  b.hud.message(msgOf(state({ phase: 'playing', multiball: true, quest: quest({ done: [...GODS], finale: { jackpot: QUEST.jackpot.first } }) })));
  const titles = titlesShown(b, 99.9, 112);
  assert.deepEqual(titles.map((t) => t.words), [`TOMB RAID! +${money(prize)}`, "PHARAOH'S GOLD!"], 'the finale says multiball itself');
  assert.ok(showedAt(titles[0], 100) && showedAt(titles[1], 100 + TITLE_SECONDS), `each in its turn (${titles.map((t) => t.at)})`);
});

test("a saved finale begun by the next ball shows PHARAOH'S GOLD! and no MULTIBALL! either", () => {
  const b = board();
  // A restart saved the finale: every god is done and it waits for a ball (so the state has no finale yet).
  b.hud.message(msgOf(state({ phase: 'launching', quest: quest({ done: [...GODS] }) })));
  b.hud.tick(49.9);
  // The next ball is in play: the finale begins, with its multiball.
  b.hud.message(cue(50, { cue: 'finale' }));
  b.hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: 1, name: 'Alex', score: 0, color: null }], multiball: true, quest: quest({ done: [...GODS], finale: { jackpot: QUEST.jackpot.first } }) })));
  assert.deepEqual(titlesShown(b, 49.9, 60).map((t) => t.words), ["PHARAOH'S GOLD!"]);
});

test('one rule for every title, hype or quest: three of one moment each show in their turn, and a fourth is let go', () => {
  const b = board();
  b.hud.message(msgOf(state({ phase: 'playing' })));
  // Four titles at one moment, as a flurry can make: two hype titles, a quest title, and a hype title behind them all.
  b.hud.message(moment('double', 10));
  b.hud.message(moment('saver', 10));
  b.hud.message(cue(10, { cue: 'jackpot', value: QUEST.jackpot.first, x: 0, z: 0 }));
  b.hud.message(moment('nudge', 10));
  const titles = titlesShown(b, 9.95, 25);
  assert.deepEqual(titles.map((t) => t.words), ['DOUBLE SCORE!', 'BALL SAVER!', `JACKPOT ${money(QUEST.jackpot.first)}!`], 'the fourth, NUDGE!, is let go');
  // Each in the slot after the one before: the third, a quest title, 2 titles (4.4 s) after its moment.
  assert.ok(titles.every((t, k) => showedAt(t, 10 + k * TITLE_SECONDS)), `at 10, 12.2 and 14.4 (${titles.map((t) => t.at.toFixed(2))})`);
});

test('a hype title waiting behind two quest titles is shown, not starved', () => {
  const b = board();
  b.hud.message(msgOf(state({ phase: 'playing' })));
  b.hud.message(cue(10, { cue: 'modeWon', god: 'horus', prize: QUEST.prize }));
  b.hud.message(cue(10, { cue: 'jackpot', value: QUEST.jackpot.first, x: 0, z: 0 }));
  b.hud.message(moment('double', 10));
  const titles = titlesShown(b, 9.95, 25);
  assert.deepEqual(titles.map((t) => t.words), [`FALCON STRIKE! +${money(QUEST.prize)}`, `JACKPOT ${money(QUEST.jackpot.first)}!`, 'DOUBLE SCORE!']);
  assert.ok(showedAt(titles[2], 10 + 2 * TITLE_SECONDS), `the hype title in its turn, 4.4 s after its moment (${titles[2].at.toFixed(2)})`);
});

test('a title more than 2 s late for its turn is let go, hype or quest, and is never shown for even a frame', () => {
  const { hud, shown } = board();
  hud.message(msgOf(state()));
  // On a free slot: a hype title 2.5 s late, and a quest title 5 s late, which is inside what a title may wait behind
  // others (6.4 s) but is a page catching up here, so let go and not flashed for one frame.
  hud.message(moment('double', 10));
  hud.tick(12.5);
  assert.equal(shown(), null, 'a hype title 2.5 s late');
  hud.message(cue(20, { cue: 'jackpot', value: QUEST.jackpot.first, x: 0, z: 0 }));
  hud.tick(25);
  assert.equal(shown(), null, 'a quest title 5 s late');
  hud.message(cue(30, { cue: 'jackpot', value: QUEST.jackpot.first + QUEST.jackpot.step, x: 0, z: 0 }));
  hud.tick(40);
  assert.equal(shown(), null, 'a quest title 10 s late');
  // Behind another title: the first shows, and then the page stalls. The second is only 5 s past its moment, but its
  // turn comes 2.8 s after the first ended, which is late for its slot, so it is let go (else it would show for a frame).
  hud.message(moment('saver', 50));
  hud.message(cue(50, { cue: 'modeStart', god: 'ra' }));
  hud.tick(50);
  assert.equal(shown(), 'BALL SAVER!');
  hud.tick(55);
  assert.equal(shown(), null, 'its turn came 2.8 s late');
  // The next moment shows at its time as ever.
  hud.message(moment('nudge', 60));
  hud.tick(60);
  assert.equal(shown(), 'NUDGE!');
});

test('in a flurry the titles are served in the order of their moments, hype and quest alike: neither starves the other', () => {
  const { hud, shown, title } = board();
  hud.message(msgOf(state({ phase: 'playing' })));
  // For a minute: a quest title (a jackpot) every 1.5 s, and between them a hype title (a coin-bought one) every 3 s.
  const due: { at: number; msg: object }[] = [];
  for (let k = 0; k < 40; k++) due.push({ at: 10 + 1.5 * k, msg: cue(10 + 1.5 * k, { cue: 'jackpot', value: QUEST.jackpot.first + 1000 * k, x: 0, z: 0 }) });
  for (let k = 0; k < 20; k++) due.push({ at: 10.75 + 3 * k, msg: moment(['double', 'saver', 'nudge'][k % 3], 10.75 + 3 * k) });
  due.sort((a, b) => a.at - b.at);
  let next = 0;
  let run: string | undefined;
  let quests = 0;
  let hypes = 0;
  for (let i = 0; 9.9 + i * 0.05 <= 100; i++) {
    const t = 9.9 + i * 0.05;
    // Each moment reaches the page a little before the stage draws it.
    while (next < due.length && due[next].at - 0.1 <= t) hud.message(due[next++].msg);
    hud.tick(t);
    const words = shown();
    if (words !== null && title.dataset.run !== run) {
      if (words.startsWith('JACKPOT')) quests++;
      else hypes++;
    }
    run = words === null ? undefined : title.dataset.run;
  }
  // Not all can be shown (each takes 2.2 s), but each kind gets at least half the share of its titles the other gets.
  const note = `${hypes} of 20 hype titles and ${quests} of 40 quest titles shown`;
  assert.ok(hypes / 20 >= quests / 40 / 2, `the hype titles are starved: ${note}`);
  assert.ok(quests / 40 >= hypes / 20 / 2, `the quest titles are starved: ${note}`);
});

test('a state with no quest (from a server older than it) shows no banner and no lamps, and the scoreboard carries on', () => {
  const { hud, part, shown } = board();
  /** A state as a server older than the quest sends it: with no `quest` at all. */
  const old = (more: Partial<PinballState> = {}) => {
    const s: Partial<PinballState> = state(more);
    delete s.quest;
    return msgOf(s as PinballState);
  };
  hud.message(old({ phase: 'playing', balls: [{ owner: 7, name: 'Alex', score: 100, color: null }] }));
  hud.tick(1);
  assert.equal(part('pinball-banner').hidden, true, 'no banner');
  assert.equal(part('pinball-gods').hidden, true, 'no lamps');
  assert.ok(part('pinball-ball').text().includes('Alex'), 'the rest of the scoreboard is drawn');
  // Its titles still come from the states: multiball, and a new last ball.
  hud.message(old({ phase: 'playing', multiball: true, balls: [{ owner: 7, name: 'Alex', score: 100, color: null }] }));
  hud.tick(1.1);
  assert.equal(shown(), 'MULTIBALL!');
  hud.message(old({ phase: 'playing', multiball: true, lastResult: { name: 'Bea', points: 800, coins: 3 } }));
  hud.tick(4);
  assert.equal(shown(), '800 POINTS');
  for (const t of [4.1, 5, 6.5, 9]) hud.tick(t);
});

test("the table's clock starting again lets go the quest's titles still waiting on the old clock, and the new ones show", () => {
  const { hud, shown } = board();
  hud.message(msgOf(state({ phase: 'playing' })));
  hud.tick(600);
  hud.message(cue(600, { cue: 'jackpot', value: QUEST.jackpot.first, x: 0, z: 0 }));
  hud.message(cue(603, { cue: 'jackpot', value: QUEST.jackpot.first + QUEST.jackpot.step, x: 0, z: 0 }));
  hud.tick(600);
  assert.equal(shown(), `JACKPOT ${money(QUEST.jackpot.first)}!`, 'on the old clock');
  // The server restarts mid-title: its clock starts again from 0, and the page carries on.
  hud.tick(0.5);
  assert.equal(shown(), null, "the old clock's title goes");
  hud.message(cue(1, { cue: 'finale' }));
  hud.tick(1);
  assert.equal(shown(), "PHARAOH'S GOLD!", 'a new title shows at its time');
  hud.tick(1 + TITLE_SECONDS);
  hud.tick(603);
  assert.equal(shown(), null, "the old clock's waiting title was let go");
});

test('a frame makes nothing: the banner is built once, and the bar and the prize are written to the elements it has', () => {
  const { hud, part, made } = board();
  const fill = part('fill');
  hud.message(msgOf(state({ phase: 'playing', quest: quest({ done: ['ra', 'horus', 'ankh'], mode: mode('eye') }) })));
  const before = made();
  const widths = new Set<string>();
  for (let t = 100; t < 130; t += 1 / 60) {
    hud.tick(t);
    widths.add(fill.style.width);
  }
  assert.equal(made(), before, 'no element made while the time counts down');
  assert.ok(widths.size > 60, `the bar moved a step at a time, many times (${widths.size} widths)`);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').join('\n      ')}`);
  }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} passed`);
process.exit(failed ? 1 : 0);
