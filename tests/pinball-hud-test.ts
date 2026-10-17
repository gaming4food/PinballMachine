// Tests the pinball's scoreboard over the stage (PinballHud, stage/pinball-hud.ts): the balls on the table with their
// owners and scores, the next 3 in line, the words to type (which the layout's Play commands switch hides, as the
// claw's), a ball's result, and the big titles: MULTIBALL!, BALL SAVED!, DOUBLE SCORE! and a ball's result, each as
// the stage draws its time. Built in Node from fake elements, as the claw's turn box is tested.
// Usage: npm run pinball-hud-test
import assert from 'node:assert/strict';
import type { PinballHypeMsg, PinballState } from '../src/shared/pinball';
// The overlay is the stage's: its CSS and any pictures and sound files are stubbed (stub-assets.ts), so it loads in Node.
import './stub-assets';

const { PinballHud, ballSaved, TITLE_SECONDS } = await import('../src/stage/pinball');

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** Just enough of an element for the scoreboard to be built in Node, and read. */
class FakeElement {
  id = '';
  className = '';
  innerHTML = '';
  textContent = '';
  hidden = false;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
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
  ...more,
});
const moment = (id: string, at: number, more: Partial<PinballHypeMsg> = {}): PinballHypeMsg => ({ kind: 'pinballHype', id, at, ...more });
const msgOf = (s: PinballState) => ({ kind: 'pinball', state: s });

/** A scoreboard built from fake elements, and its parts. */
function board() {
  (globalThis as { document?: unknown }).document = { createElement: () => new FakeElement() };
  const slot = new FakeElement();
  const hud = new PinballHud(slot as unknown as HTMLElement);
  const part = (name: string) => {
    const el = slot.byClass(name);
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
  return { hud, slot, part, title, shown, by };
}

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
  hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: 7, name: 'Alex', score: 12345 }] })));
  const text = part('pinball-ball').text();
  assert.ok(text.includes('Alex') && text.includes('12,345'), text);
  hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: null, name: null, score: 40 }] })));
  assert.ok(part('pinball-ball').text().includes('HOUSE'), part('pinball-ball').text());
});

test('a chat name is text, never markup', () => {
  const { hud, part } = board();
  hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: 7, name: '<b>x</b>', score: 1 }], line: [{ userId: 2, name: '<i>y</i>' }] })));
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
  hud.message(msgOf(state({ phase: 'playing', balls: [{ owner: 1, name: 'Alex', score: 0 }] })));
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
