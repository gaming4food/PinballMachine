// The pinball's sounds. Each plays the sound files picked for it (pinball-sound-picks.ts), or is made on the stage's
// synth (PinballVoice, below; the synth is the kit's StageSynth), as the claw's are. When each plays (PinballSoundCues)
// is decided from what the stage can see, since the game sends its hits only as state and snapshots:
// - the table as the stage draws it: a flipper starting up is a flip, one of the lock's drop targets going down or a
//   flip plaque turning to its back (the header's bits) a target, a ball coming into a bumper's or a sling's reach a
//   bumper's pop or a sling's kick, a pop-up going down with a ball at it a target (the game puts them away too, with
//   none), and a ball meeting the mummy while it stands (it stays up when hit, so no bit changes) a target (inferred
//   from where the ball is drawn: the header has no hit events);
// - a 'spawn' is a launch, a ball gone below the drain a drain, and a drained ball back at once a saved one;
// - multiball: a press's moment (pinballHype) at its time, or the state turning it on when the lock starts it.
// Tested without a sound card: npm run pinball-sounds-test.
import type { StageSynth } from '@kit/stage';
import { type PinballHypeMsg, type PinballState } from '../shared/pinball';
import { TABLE_IN_USE, TABLE, type Table } from '../shared/table';
import { TARGET_THICK, targetFrame } from './pinball-parts';
import { PINBALL_SOUNDS, type PinballMoment, type PinballPicks } from './pinball-sound-picks';

/** What the cues tell: each moment, with which part it was (the scene flashes a bumper's cap with it). */
export interface PinballCueSink {
  flip(side: 'left' | 'right'): void;
  bumper(id: string): void;
  sling(id: string): void;
  /**
   * A target was hit (a drop target or a pop-up knocked down, a flip plaque turned to its back, or the standing mummy
   * met by a ball): its place in the table's targets, and for the mummy the ball that met it, where it met it (the
   * stage rocks the mummy away from it).
   */
  target(index: number, ball?: DrawnBall): void;
  drain(): void;
  launch(): void;
  multiball(): void;
  saved(): void;
}

/** A ball as the stage draws it this frame, on the table (x across, z up it). */
export interface DrawnBall {
  id: number;
  x: number;
  z: number;
}

/** How far a flipper must swing up between two looks for it to be going up (degrees). */
const RISING = 0.5;
/** A ball this close to a part's face (beyond touching) is meeting it; it must get this much further away to leave. */
const REACH = 0.08;
const LEAVE = 0.25;
/**
 * A ball (as last drawn) this close to a pop-up's face (beyond touching) as it goes down knocked it down: the frame
 * before, it was at most a frame's travel short of it, and bounced back after. The game putting one away has no ball at
 * it.
 */
const KNOCKED = 1;
/** A press's multiball moment this long past is let go, not played late (the claw's titles' STALE_SECONDS). */
const STALE = 2;
/** The state turning multiball on within this long of a press's moment is that press, already heard. */
const SAME_MULTIBALL = 3;
/** The simulation time drawn going back by more than this is the table's clock starting again (the server restarted). */
const CLOCK_BACK = 1;

/** How far (x, z) is from the segment a to b. */
function segmentDistance(x: number, z: number, a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const k = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (a[0] + k * dx), z - (a[1] + k * dz));
}

/** A rising target as the cues see it: its place in the table's targets, its id, and its body's footprint. */
interface Riser {
  index: number;
  id: string;
  /** Its face's middle line, along its width, and half its thickness across it. */
  a: [number, number];
  b: [number, number];
  half: number;
}

export class PinballSoundCues {
  /** Each flipper's angle last looked at, and whether it was going up. */
  private readonly last = new Map<'left' | 'right', { angle: number; rising: boolean }>();
  /** The targets down and turned last looked at; null before the first look. */
  private lastTargets: { down: number; turned: number } | null = null;
  /** For each ball seen, the parts it's meeting now. */
  private readonly meeting = new Map<number, Set<string>>();
  /** Multiball state last heard (null before the first), the press moments waiting, and the last one's time. */
  private multiballOn: boolean | null = null;
  private readonly pending: number[] = [];
  private lastMoment = -Infinity;
  private t = -Infinity;
  /**
   * The rising targets (shared/table.ts Target.rise): the pop-ups, which drop when hit, and the mummy, which stays up
   * and is hit again and again. The game raises them and puts them away as well, so a bit of theirs going down is no
   * hit of itself (only the lock's drop targets' are): a pop-up's is when a ball is at it, and the mummy's hits are
   * heard as a ball meets it while it stands (balls).
   */
  private readonly popups: Riser[];
  private readonly held: Riser[];
  private readonly risingBits: number;
  /** The balls as last drawn: where they were as a pop-up went down. */
  private drawn: DrawnBall[] = [];

  constructor(
    private readonly sink: PinballCueSink,
    private readonly table: Table = TABLE_IN_USE,
  ) {
    const risers = (rise: 'drop' | 'hold') =>
      table.targets.flatMap((t, index): Riser[] => {
        if (t.rise !== rise) return [];
        const { u } = targetFrame(table, t);
        const ex = (u[0] * t.width) / 2;
        const ez = (u[1] * t.width) / 2;
        return [{ index, id: t.id, a: [t.x - ex, t.z - ez], b: [t.x + ex, t.z + ez], half: (t.depth ?? TARGET_THICK) / 2 }];
      });
    this.popups = risers('drop');
    this.held = risers('hold');
    this.risingBits = [...this.popups, ...this.held].reduce((bits, r) => bits | (1 << r.index), 0);
  }

  /** How far a ball's surface is from a rising target's (beyond touching it). */
  private gap(r: Riser, ball: DrawnBall): number {
    return segmentDistance(ball.x, ball.z, r.a, r.b) - TABLE.ballRadius - r.half;
  }

  /** The flippers as drawn, at simulation time t: one starting up is a flip (the first look is only a look). */
  flippers(_t: number, left: number, right: number): void {
    for (const [side, angle] of [['left', left], ['right', right]] as const) {
      const f = this.table.flippers.find((x) => x.side === side);
      if (!f) continue;
      const up = Math.sign(f.upDeg - f.restDeg);
      const was = this.last.get(side);
      const rising = was !== undefined && (angle - was.angle) * up > RISING;
      if (rising && !was.rising) this.sink.flip(side);
      this.last.set(side, { angle, rising });
    }
  }

  /**
   * The targets down and the flip plaques turned to their backs (bit i for target i): a drop target newly down, or a
   * plaque newly turned, is a hit and sounds; one coming back up, or turning back to its front, is silent. A pop-up
   * newly down is a hit when a ball (as last drawn) is at it, and otherwise the game putting it away, which is silent;
   * the mummy going down is silent too (its hits are heard as a ball meets it: balls).
   */
  targets(down: number, turned = 0): void {
    const was = this.lastTargets;
    this.lastTargets = { down, turned };
    if (was === null) return;
    const newlyDown = down & ~was.down;
    let hits = (newlyDown & ~this.risingBits) | (turned & ~was.turned);
    for (const p of this.popups) if (newlyDown & (1 << p.index) && this.drawn.some((ball) => this.gap(p, ball) < KNOCKED)) hits |= 1 << p.index;
    for (let i = 0; i < this.table.targets.length; i++) if (hits & (1 << i)) this.sink.target(i);
  }

  /**
   * The balls as drawn: one coming within reach of a bumper, a sling or the standing mummy is its hit, once, until it
   * has left (the first look at a ball is only a look).
   */
  balls(balls: readonly DrawnBall[]): void {
    const R = TABLE.ballRadius;
    const seen = new Set<number>();
    for (const ball of balls) {
      seen.add(ball.id);
      const before = this.meeting.get(ball.id);
      const now = new Set<string>();
      for (const b of this.table.bumpers) {
        const d = Math.hypot(ball.x - b.x, ball.z - b.z) - b.radius - R;
        if (d < REACH || (before?.has(b.id) && d < LEAVE)) {
          now.add(b.id);
          if (before && !before.has(b.id)) this.sink.bumper(b.id);
        }
      }
      for (const s of this.table.slings) {
        const d = segmentDistance(ball.x, ball.z, s.a, s.b) - R;
        if (d < REACH || (before?.has(s.id) && d < LEAVE)) {
          now.add(s.id);
          if (before && !before.has(s.id)) this.sink.sling(s.id);
        }
      }
      for (const h of this.held) {
        // Down (or before the first look at the targets) it has no face to meet: a ball rolls over its slot.
        if (!this.lastTargets || this.lastTargets.down & (1 << h.index)) continue;
        const d = this.gap(h, ball);
        if (d < REACH || (before?.has(h.id) && d < LEAVE)) {
          now.add(h.id);
          if (before && !before.has(h.id)) this.sink.target(h.index, ball);
        }
      }
      this.meeting.set(ball.id, now);
    }
    for (const id of this.meeting.keys()) if (!seen.has(id)) this.meeting.delete(id);
    this.drawn = [...balls];
  }

  /**
   * A fresh hello: everything looked at is forgotten, so the new connection's first looks are only looks, and so are
   * the times kept (the new server's clock may have started again from 0).
   */
  reset(): void {
    this.last.clear();
    this.lastTargets = null;
    this.meeting.clear();
    this.drawn = [];
    this.multiballOn = null;
    this.pending.length = 0;
    this.lastMoment = -Infinity;
    this.t = -Infinity;
  }

  launched(): void {
    this.sink.launch();
  }

  drained(): void {
    this.sink.drain();
  }

  saved(): void {
    this.sink.saved();
  }

  /** A hype moment: a press of multiball plays its sound at the moment's time (frame). */
  hype(m: PinballHypeMsg): void {
    if (m.id !== 'multiball') return;
    this.pending.push(m.at);
    this.pending.sort((a, b) => a - b);
  }

  /** The state: multiball turning on with no press heard for it is the lock's (hello's state is only a look). */
  state(s: PinballState): void {
    const was = this.multiballOn;
    this.multiballOn = s.multiball;
    if (was !== false || !s.multiball) return;
    if (this.pending.length || this.lastMoment > this.t - SAME_MULTIBALL) return;
    this.lastMoment = this.t;
    this.sink.multiball();
  }

  /** Each frame, at the simulation time drawn: a press's multiball when its time comes (one long past goes unheard). */
  frame(t: number): void {
    if (t < this.t - CLOCK_BACK) {
      // The table's clock started again with no hello between (the page carried on): the old clock's times go, and so
      // do its presses still waiting; those already on the new clock (at most a second ahead) stay.
      this.lastMoment = -Infinity;
      const kept = this.pending.filter((at) => at <= t + CLOCK_BACK);
      this.pending.splice(0, this.pending.length, ...kept);
    }
    this.t = t;
    while (this.pending.length && this.pending[0] <= t) {
      const at = this.pending.shift()!;
      this.lastMoment = at;
      if (t - at <= STALE) this.sink.multiball();
    }
  }
}

const midiHz = (note: number) => 440 * 2 ** ((note - 69) / 12);

/**
 * The pinball's sounds: the files picked for them (pinball-sound-picks.ts), or made on the stage's synth: an arcade
 * table's solenoids and bells. A moment with no pick, or whose files haven't loaded, plays its synth, at its pick's
 * volume if it has one. With no synth (a muted preview) each is silent, and no file is fetched.
 */
export class PinballVoice {
  private readonly gains = new Map<PinballMoment, { out: AudioNode; space: AudioNode }>();

  constructor(
    private readonly synth: StageSynth | null,
    private readonly table: PinballPicks = PINBALL_SOUNDS,
  ) {
    const files = [...new Set(Object.values(table).flatMap((pick) => pick.files))];
    if (files.length) synth?.preload?.(files);
  }

  /** One of the moment's picked files, if one has loaded, and true; false: play the synth. */
  private file(moment: PinballMoment, jitter = 0): boolean {
    const pick = this.table[moment];
    if (!pick?.files.length || !this.synth?.sample) return false;
    return this.synth.sample(pick.files, { volume: pick.volume, jitter });
  }

  /** Where the moment's synth plays, through gains of its own at its pick's volume (as the claw's ClawVoice). */
  private outs(s: StageSynth, moment: PinballMoment): { out: AudioNode; space: AudioNode } {
    const pick = this.table[moment];
    if (!pick) return { out: s.out, space: s.space };
    let outs = this.gains.get(moment);
    if (!outs) {
      const gain = (to: AudioNode) => {
        const node = to.context.createGain();
        node.gain.value = pick.volume;
        node.connect(to);
        return node;
      };
      outs = { out: gain(s.out), space: gain(s.space) };
      this.gains.set(moment, outs);
    }
    return outs;
  }

  /** A flipper's solenoid: a hard clack with a low thump under it. */
  flip(): void {
    const s = this.synth;
    if (!s || !s.allow(6) || this.file('flip', 0.04)) return;
    const { out } = this.outs(s, 'flip');
    const t = s.now();
    s.hiss(out, t, 0.04, 0.22, 'bandpass', 2200, undefined, 1.8, 0.001);
    s.tone(out, 'square', 140, t, 0.07, 0.06, 80, 0.001);
  }

  /** A pop bumper: a bright pop and a short ring. */
  bumper(): void {
    const s = this.synth;
    if (!s || !s.allow(6) || this.file('bumper', 0.04)) return;
    const { out, space } = this.outs(s, 'bumper');
    const t = s.now();
    s.tone(out, 'square', midiHz(84), t, 0.06, 0.05, midiHz(72), 0.001);
    s.hiss(out, t, 0.03, 0.2, 'highpass', 3000, undefined, 0.7, 0.001);
    s.bell(space, midiHz(91), t + 0.005, 0.03, 0.4);
  }

  /** A slingshot's kick: a dull rubber thwack. */
  sling(): void {
    const s = this.synth;
    if (!s || !s.allow(6) || this.file('sling', 0.04)) return;
    const { out } = this.outs(s, 'sling');
    const t = s.now();
    s.tone(out, 'triangle', 220, t, 0.08, 0.09, 110, 0.001);
    s.hiss(out, t, 0.05, 0.16, 'bandpass', 900, undefined, 1.5, 0.001);
  }

  /** A drop target going down: a click and a bell. */
  target(): void {
    const s = this.synth;
    if (!s || !s.allow(6) || this.file('target')) return;
    const { out } = this.outs(s, 'target');
    const t = s.now();
    s.hiss(out, t, 0.025, 0.2, 'bandpass', 3200, undefined, 2.5, 0.001);
    s.bell(out, midiHz(88), t + 0.01, 0.04, 0.6);
  }

  /** The drain: a falling buzz. */
  drain(): void {
    const s = this.synth;
    if (!s || this.file('drain')) return;
    const { out } = this.outs(s, 'drain');
    const t = s.now();
    s.tone(out, 'sawtooth', 330, t, 0.6, 0.05, 70, 0.01);
    s.tone(out, 'sine', 90, t + 0.05, 0.4, 0.12, 45, 0.005);
  }

  /** The plunger letting go: a spring's thunk and a rising whoosh. */
  launch(): void {
    const s = this.synth;
    if (!s || this.file('launch')) return;
    const { out } = this.outs(s, 'launch');
    const t = s.now();
    s.tone(out, 'sine', 120, t, 0.2, 0.18, 60, 0.002);
    s.hiss(out, t, 0.35, 0.12, 'bandpass', 600, 3000, 1.2, 0.01);
  }

  /** Multiball: a fast rising run into a ringing chord, the music dipping under it. */
  multiball(): void {
    const s = this.synth;
    if (!s) return;
    s.duck(1.5);
    if (this.file('multiball')) return;
    const { out, space } = this.outs(s, 'multiball');
    const t = s.now();
    [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => s.tone(out, 'square', midiHz(n), t + i * 0.06, 0.1, 0.06));
    [84, 88, 91].forEach((n) => s.tone(out, 'triangle', midiHz(n), t + 0.45, 1, 0.05, undefined, 0.02));
    [96, 100, 103].forEach((n, i) => s.bell(space, midiHz(n), t + 0.5 + i * 0.07, 0.025, 0.6));
  }

  /** A ball saved: two quick rising chimes. */
  saved(): void {
    const s = this.synth;
    if (!s || this.file('saved')) return;
    const { out } = this.outs(s, 'saved');
    const t = s.now();
    [79, 86].forEach((n, i) => s.bell(out, midiHz(n), t + i * 0.12, 0.05, 0.8));
  }
}
