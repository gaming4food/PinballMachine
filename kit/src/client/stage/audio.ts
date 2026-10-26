// Stage audio: arcade sound effects, from the sound files picked for them (sounds.ts) or synthesized in code, plus music.
// The server picks the songs (see server/music.ts); the stage plays them with crossfades, or generated synthwave when
// none are imported.
import type { MusicState } from '../../shared/protocol';
import { SampleBank } from './samples';
import { STAGE_SOUNDS, type StageMoment, winMoment } from './sounds';

// "Balanced" mix: effects and music at similar levels, glued together by a gentle compressor.
// Imported songs are normalized to -16 LUFS; the generated music and the effects are scaled to sit beside them.
const SFX_LEVEL = 1.8;
const MUSIC_LEVEL = 0.6;
/** A bomb's blast, against the other game sounds: about 12 dB down from how it was first made. */
const BOMB_LEVEL = 0.25;
/**
 * Alert voices (see voice()): Piper's recordings are about -15 LUFS, peaking at full scale, so about 14 dB down (at full
 * level they were far over the stage's other sounds, and at 0.4 still loud, the owner heard, 2026-10-17).
 */
const VOICE_LEVEL = 0.2;
const GENERATED_MUSIC_LEVEL = 2.4;
const CROSSFADE_SEC = 3;
/** How quickly the music eases out when paused and back in when unpaused. */
const PAUSE_FADE_SEC = 0.6;
/** A live stream (internet radio) that drops tries again after this long. */
const RADIO_RETRY_MS = 4000;
/**
 * The music passing between the stages and the music source (MusicState.mutedHere): one eases out while the other
 * eases in at the same pace, playing the same song at the same spot, so the stream hears one steady copy throughout.
 */
const HANDOVER_SEC = 0.15;
/**
 * The moments that come in bursts (a coin rain): each of their files plays a little higher or lower, so a rain doesn't
 * machine-gun. The rest keep their own pitch, as the soundboard plays them.
 */
const FREQUENT: ReadonlySet<StageMoment> = new Set(['clink', 'tray', 'trayOwned']);
/** A heavy drop's landing (see impact), as its moment. */
const IMPACT_MOMENT = { gold: 'impactGold', giant: 'impactGiant', bomb: 'impactBomb' } as const;

const midiHz = (note: number) => 440 * 2 ** ((note - 69) / 12);

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A synthetic room: decaying stereo noise, used as a reverb impulse. */
function roomImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  }
  return buffer;
}

/**
 * The echo of a big open space (an arcade hall, a street): a quick burst of early reflections, then a long tail
 * that loses its highs as it dies, the way real rooms swallow treble. Gives blasts and bells somewhere to ring out.
 */
function hallImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(2, Math.floor(rate * seconds), rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      const k = i / data.length;
      // A one-pole lowpass whose cutoff falls over the tail.
      const smooth = 0.05 + 0.9 * k;
      low += (Math.random() * 2 - 1 - low) * (1 - smooth);
      data[i] = low * (1 - k) ** 2.2 * (i < rate * 0.004 ? 0 : 1);
    }
    // A handful of distinct early reflections off nearby walls.
    for (let r = 0; r < 8; r++) {
      const at = Math.floor(rate * (0.008 + Math.random() * 0.07));
      data[at] += (Math.random() < 0.5 ? -1 : 1) * (0.6 - r * 0.05);
    }
  }
  return buffer;
}

/** A soft-clipping curve: pushes loud sounds into warm distortion, like a speaker (or an eardrum) overloading. */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

/** Shared helpers for scheduling short synthesized sounds. */
class Voice {
  constructor(
    readonly ctx: AudioContext,
    readonly noise: AudioBuffer,
  ) {}

  gain(value: number, to: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(to);
    return g;
  }

  /** An oscillator with a quick attack and exponential decay. `glideTo` sweeps the pitch over the note. */
  tone(out: AudioNode, type: OscillatorType, hz: number, start: number, dur: number, vol: number, glideTo?: number, attack = 0.003): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(vol, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  /** A burst of filtered noise; `sweepTo` moves the filter over the burst. */
  hiss(out: AudioNode, start: number, dur: number, vol: number, filter: BiquadFilterType, hz: number, sweepTo?: number, q = 0.8, attack = 0.004): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = dur > this.noise.duration - 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(hz, start);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    f.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(vol, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(env).connect(out);
    src.start(start, Math.max(0, Math.random() * (this.noise.duration - dur - 0.1)));
    src.stop(start + dur + 0.05);
  }

  /** A metallic strike: inharmonic partials, each ringing for its own time. `ring` stretches every decay. */
  bell(out: AudioNode, hz: number, start: number, vol: number, ring = 1): void {
    const partials: [number, number, number][] = [[1, 1, 0.9], [2.0, 0.55, 0.6], [2.76, 0.45, 0.45], [5.4, 0.25, 0.25], [8.93, 0.12, 0.14]];
    for (const [ratio, amp, decay] of partials) {
      // Overtones too high to hear (or for the sound card to play) are skipped.
      if (hz * ratio < 16000) this.tone(out, 'sine', hz * ratio, start, decay * ring, vol * amp, undefined, 0.002);
    }
  }

  /** A sound placed left or right (-1 to 1) in the stereo picture. */
  panned(pan: number, to: AudioNode): StereoPannerNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(to);
    return p;
  }
}

/**
 * The stage's synth, for a machine to make its own sounds with (the claw's: claw-sounds.ts): the stage's own notes,
 * each started at a time from now(), into out (heard with the stage's effects) or space (heard only as the hall's echo),
 * and the machine's own sound files (preload, sample).
 */
export interface StageSynth {
  /** Now on the audio clock, a moment ahead, so a sound started now is never late. */
  now(): number;
  /** The effects, under the Game sounds slider with the stage's own. */
  readonly out: AudioNode;
  /** The hall's echo (see hallImpulse): what's sent here is heard only ringing round the room. */
  readonly space: AudioNode;
  /** An oscillator with a quick attack and exponential decay. `glideTo` sweeps the pitch over the note. */
  tone(out: AudioNode, type: OscillatorType, hz: number, start: number, dur: number, vol: number, glideTo?: number, attack?: number): void;
  /** A burst of filtered noise; `sweepTo` moves the filter over the burst. */
  hiss(out: AudioNode, start: number, dur: number, vol: number, filter: BiquadFilterType, hz: number, sweepTo?: number, q?: number, attack?: number): void;
  /** A metallic strike: inharmonic partials, each ringing for its own time. `ring` stretches every decay. */
  bell(out: AudioNode, hz: number, start: number, vol: number, ring?: number): void;
  /** Dips the music a little (to 0.6) under a big moment, and lets it swell back over about `seconds`. */
  duck(seconds: number): void;
  /**
   * Whether one more effect may start: the stage's and the machine's are counted together over each 100 ms, and this
   * one plays only while no more than `max` have been asked for, itself included (a coin's clink allows 6).
   */
  allow(max: number): boolean;
  /**
   * A coin dropping into a tray: the stage's ringing clink, louder for a viewer's coin than the house's, its picked file
   * or its synth, at `volume` times its own (1 by default).
   */
  tray(owned: boolean, volume?: number): void;
  /**
   * A coin hitting the pusher's pile: the stage's short metallic clink, its picked file or its synth, at `volume` times
   * its own (1 by default). (Optional: a synth from an older kit hasn't one.)
   */
  clink?(volume?: number): void;
  /**
   * Sound files to fetch and decode, each once, so they're ready to play (see sample). They load once the stage can be
   * heard; one that fails is logged and never plays. (Optional, like sample: a synth from an older kit has neither.)
   */
  preload?(urls: readonly string[]): void;
  /**
   * Plays one of `files` if one has decoded (several take turns, never one twice in a row), and says so: at `volume`
   * (1 plays a file as it is), `pan` from -1 (left) to 1 (right), centred by default, a pitch up to `jitter` off its
   * own (0.04, 4%, by default), at `at` (a time from now(), now by default). False, playing nothing, when none has
   * decoded (yet, or ever) or the stage is silenced: play the synth instead. Ask allow() first, as for the synth's notes.
   */
  sample?(files: readonly string[], o?: { volume?: number; pan?: number; jitter?: number; at?: number }): boolean;
}

/** Everything the stage page asks of its audio. */
export interface StageSounds {
  /** The synth, for a machine's own sounds (StageSynth); null when silent (a muted preview). */
  synth(): StageSynth | null;
  readonly suspended: boolean;
  resume(): Promise<void>;
  /** Plays what the server's DJ says, at the volumes it says. */
  followMusic(state: MusicState): void;
  clink(volume?: number): void;
  tray(owned: boolean): void;
  win(amount: number): void;
  explosion(): void;
  /** A bomb's fuse fizzing for `seconds`, starting `delay` seconds from now. */
  fuse(seconds: number, delay: number): void;
  /** A gift, donation or sub (tier 1 to 4): a rising swell for `windup` seconds, then the payoff as its drops fall. */
  donation(tier: number, windup: number): void;
  /** A gift's heavy drop (gold or giant coin, bomb) slamming into the machine, `delay` seconds from now. */
  impact(kind: 'gold' | 'giant' | 'bomb', delay: number): void;
  quake(seconds: number): void;
  turbo(): void;
  fanfare(): void;
  jingle(): void;
  /** Starts fetching an alert's voice recording (see alerts.ts), so it plays the moment its card asks. */
  preloadVoice(url: string): void;
  /** Plays an alert's voice recording, made on the server, with the music ducked under it. */
  voice(url: string): void;
  /** Silent while the machine is switched off (not paid for), and back again when it's on. */
  setSilenced(silenced: boolean): void;
}

/**
 * For a muted stage (the control panel's preview): plays nothing, so it also skips decoding songs, fetching sound
 * files and scheduling notes, which would otherwise keep running unheard.
 */
export const SILENT_SOUNDS: StageSounds = {
  synth: () => null,
  suspended: false,
  resume: async () => {},
  followMusic() {},
  clink() {},
  tray() {},
  win() {},
  explosion() {},
  fuse() {},
  donation() {},
  impact() {},
  quake() {},
  turbo() {},
  fanfare() {},
  jingle() {},
  preloadVoice() {},
  voice() {},
  setSilenced() {},
};

export class StageAudio implements StageSounds {
  readonly ctx = new AudioContext({ latencyHint: 'playback' });
  private readonly v: Voice;
  private readonly master: GainNode;
  private readonly sfx: GainNode;
  private readonly musicBus: GainNode;
  /** Dips the music under a blast or a big gift, so they hit harder (the music's own volume stays on musicBus). */
  private readonly duckBus: GainNode;
  /** Send to the hall's echo (see hallImpulse); it comes back into the effects, under the effects volume. */
  private readonly space: GainNode;
  /** The synth as a machine plays it (see synth). */
  private readonly face: StageSynth;
  /** The sound files: the stage's own picks (see table) and a machine's (StageSynth.preload), each loaded once. */
  private readonly samples: SampleBank<AudioBuffer>;
  /** Every sound file asked for, loaded once the stage can be heard (see loadSamples). */
  private readonly wanted = new Set<string>();
  /** Each moment's synth, through gains of its own at its pick's volume (see synthOut). */
  private readonly moments = new Map<StageMoment, { sfx: GainNode; space: GainNode }>();
  private silenced: boolean;
  private readonly drive = driveCurve(2.5);
  private readonly analyser: AnalyserNode;
  private readonly levelData = new Float32Array(1024);
  private music: MusicPlayer | null = null;
  private window = { at: 0, count: 0 };
  private lastWinAt = 0;
  /** Whether the music source had the music last time (see followMusic); null before the first word from the server. */
  private sourceHadIt: boolean | null = null;

  constructor(
    muted: boolean,
    /** 'music': the music source (stage/music.html), which plays only the music, and only while it has its turn. */
    private readonly part: 'all' | 'music' = 'all',
    /** The stage's picks: STAGE_SOUNDS (sounds.ts), or a test's own. */
    private readonly table: typeof STAGE_SOUNDS = STAGE_SOUNDS,
  ) {
    const ctx = this.ctx;
    this.silenced = muted;
    this.v = new Voice(ctx, whiteNoise(ctx, 3));
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master = ctx.createGain();
    this.master.gain.value = muted ? 0 : 0.9;
    this.master.connect(comp).connect(this.analyser).connect(ctx.destination);
    this.sfx = this.v.gain(SFX_LEVEL, this.master);
    this.duckBus = this.v.gain(1, this.master);
    this.musicBus = this.v.gain(MUSIC_LEVEL, this.duckBus);
    const hall = ctx.createConvolver();
    hall.buffer = hallImpulse(ctx, 3.2);
    hall.connect(this.v.gain(0.55, this.sfx));
    this.space = this.v.gain(1, hall);
    this.samples = new SampleBank<AudioBuffer>(
      (url) =>
        fetch(url)
          .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status}`))))
          .then((data) => ctx.decodeAudioData(data))
          .catch((err: Error) => {
            // Its moment stays on the synth.
            console.warn('sound file did not load', url, err.message);
            throw err;
          }),
      (buffer, at, volume, rate, pan) => {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = rate;
        // Through a panner even when centred (which takes it 3 dB down), as the soundboard plays it, so a file is as
        // loud here as when it was picked.
        src.connect(this.v.gain(volume, this.v.panned(pan, this.sfx)));
        src.start(at);
      },
    );
    this.face = {
      now: () => this.now(),
      out: this.sfx,
      space: this.space,
      tone: (...note) => this.v.tone(...note),
      hiss: (...note) => this.v.hiss(...note),
      bell: (...note) => this.v.bell(...note),
      duck: (seconds) => this.duck(0.6, seconds),
      allow: (max) => this.allow(max),
      tray: (owned, volume) => this.tray(owned, volume),
      clink: (volume) => this.clink(volume),
      preload: (urls) => this.preload(urls),
      sample: (files, o) => this.sample(files, o),
    };
    // Sound files load once the stage can be heard: in a browser after the first click, in OBS (which needs none) at
    // once.
    ctx.addEventListener('statechange', () => this.loadSamples());
    this.preload(Object.values(table).flatMap((pick) => pick.files));
  }

  get suspended(): boolean {
    return this.ctx.state !== 'running';
  }

  setSilenced(silenced: boolean): void {
    this.silenced = silenced;
    this.master.gain.setTargetAtTime(silenced ? 0 : 0.9, this.ctx.currentTime, 0.05);
    this.loadSamples();
  }

  /** Browsers (but not OBS) only allow sound after a click; call this from one. */
  async resume(): Promise<void> {
    await this.ctx.resume();
    this.music?.resume();
    this.loadSamples();
  }

  /** Sound files to load (see loadSamples), each once. */
  private preload(urls: readonly string[]): void {
    for (const url of urls) this.wanted.add(url);
    // Once what runs now has finished: a stage silenced as soon as it's made (main.ts, off screen) fetches nothing.
    queueMicrotask(() => this.loadSamples());
  }

  /**
   * Loads the sound files asked for, once the stage can be heard: running (in a browser, after the first click) and not
   * silenced. Until then, and if one fails, its moment plays its synth. The music source plays none.
   */
  private loadSamples(): void {
    if (this.part === 'music' || this.silenced || this.ctx.state !== 'running') return;
    this.samples.preload([...this.wanted]);
  }

  /** One of `files`, if one has decoded, on the effects (see StageSynth.sample). None plays while silenced. */
  private sample(files: readonly string[], o: { volume?: number; pan?: number; jitter?: number; at?: number } = {}): boolean {
    if (this.silenced) return false;
    return this.samples.play(files, { at: o.at ?? this.now(), volume: o.volume ?? 1, pan: o.pan, jitter: o.jitter });
  }

  /**
   * A moment's picked file (see table), if it has one that has decoded: started at `at`, at its pick's volume times
   * `volume`, and true. False when the moment plays its synth instead.
   */
  private played(moment: StageMoment, at: number, volume = 1): boolean {
    const pick = this.table[moment];
    if (!pick) return false;
    return this.sample(pick.files, { at, volume: pick.volume * volume, jitter: FREQUENT.has(moment) ? undefined : 0 });
  }

  /**
   * Where a moment's synth plays: the effects, and the hall's echo, each through a gain of the moment's own at its
   * pick's volume (1 without one), so a moment kept on its synth plays as loud as it was picked.
   */
  private synthOut(moment: StageMoment): { sfx: GainNode; space: GainNode } {
    let out = this.moments.get(moment);
    if (!out) {
      const volume = this.table[moment]?.volume ?? 1;
      out = { sfx: this.v.gain(volume, this.sfx), space: this.v.gain(volume, this.space) };
      this.moments.set(moment, out);
    }
    return out;
  }

  followMusic(state: MusicState): void {
    // Glide to new volumes rather than jumping, so dragging a slider sounds smooth.
    const t = this.ctx.currentTime;
    // Muted on the streamer's end, with a music source open: that source plays the music for the stream and the
    // stages leave it out (the streamer hears the stages through OBS). Otherwise the stages play it, and it's silent.
    const sourceHasIt = state.mutedHere && state.musicSourceOpen;
    const first = this.sourceHadIt === null;
    const handover = !first && sourceHasIt !== this.sourceHadIt;
    this.sourceHadIt = sourceHasIt;
    const ours = sourceHasIt === (this.part === 'music');
    const level = !ours ? 0 : MUSIC_LEVEL * state.musicVolume;
    const g = this.musicBus.gain;
    // A page that's just opened starts where it should be, so it never adds a moment of music that isn't its turn.
    if (first) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(level, t);
    }
    else g.setTargetAtTime(level, t, handover ? HANDOVER_SEC : level === 0 ? 0.6 : 0.08);
    this.sfx.gain.setTargetAtTime(this.part === 'music' ? 0 : SFX_LEVEL * state.sfxVolume, t, 0.08);
    this.music ??= new MusicPlayer(this.ctx, this.musicBus);
    this.music.follow(state);
  }

  /** Loudness right now (RMS, 0..1): lets tests confirm sound is actually being produced. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.levelData);
    let sum = 0;
    for (const x of this.levelData) sum += x * x;
    return Math.sqrt(sum / this.levelData.length);
  }

  /** Caps how many effects start per 100 ms, so a cascade of 50 coins is a shower, not a wall of noise. */
  private allow(max: number): boolean {
    const now = this.ctx.currentTime;
    if (now - this.window.at > 0.1) this.window = { at: now, count: 0 };
    return ++this.window.count <= max;
  }

  private now(): number {
    return this.ctx.currentTime + 0.01;
  }

  synth(): StageSynth {
    return this.face;
  }

  // Each moment plays its picked file (see played) once it has decoded, and otherwise its synth, described below.

  /** A coin landing on the pile: a short, slightly random metallic clink. */
  clink(volume = 1): void {
    if (!this.allow(6)) return;
    const t = this.now();
    if (this.played('clink', t, volume)) return;
    const { sfx } = this.synthOut('clink');
    const base = 1900 + Math.random() * 900;
    const partials: [number, number, number][] = [[1, 1, 0.14], [2.76, 0.5, 0.09], [5.4, 0.28, 0.06], [8.93, 0.16, 0.04]];
    for (const [ratio, amp, decay] of partials) this.v.tone(sfx, 'sine', base * ratio, t, decay, 0.05 * amp * volume);
    this.v.hiss(sfx, t, 0.015, 0.05 * volume, 'bandpass', 6500);
  }

  /**
   * A coin dropping into the win tray or a side gutter: a lower, ringing clink, louder for a viewer's coin. `volume`
   * scales it, file or synth: a machine's own clink (the claw's prize door, StageSynth.tray) may ask for it softer.
   */
  tray(owned: boolean, volume = 1): void {
    if (!this.allow(8)) return;
    const t = this.now();
    const moment = owned ? 'trayOwned' : 'tray';
    if (this.played(moment, t, volume)) return;
    const { sfx } = this.synthOut(moment);
    const base = 1300 + Math.random() * 500;
    this.v.tone(sfx, 'sine', base, t, 0.3, (owned ? 0.07 : 0.035) * volume);
    this.v.tone(sfx, 'sine', base * 2.76, t, 0.16, (owned ? 0.03 : 0.015) * volume);
  }

  /**
   * A win, small, medium or big by its size (winMoment): the classic two-note coin chime; bigger wins add a sparkle
   * run. Small wins chime at most 4x a second.
   */
  win(amount: number): void {
    const t = this.now();
    const moment = winMoment(amount);
    if (moment === 'winSmall' && t - this.lastWinAt < 0.25) return;
    if (!this.allow(10)) return;
    this.lastWinAt = t;
    if (this.played(moment, t)) return;
    const { sfx } = this.synthOut(moment);
    this.v.tone(sfx, 'square', midiHz(83), t, 0.08, 0.09);
    this.v.tone(sfx, 'square', midiHz(88), t + 0.075, 0.4, 0.09);
    if (amount >= 10) [91, 95, 100, 103].forEach((n, i) => this.v.tone(sfx, 'triangle', midiHz(n), t + 0.16 + i * 0.06, 0.3, 0.08));
  }

  /** Dips the music to `depth` right away and lets it swell back over about `seconds`. */
  private duck(depth: number, seconds: number): void {
    const g = this.duckBus.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(depth, t + 0.03);
    g.setTargetAtTime(1, t + 0.25, seconds / 3);
  }

  /** A path through warm distortion, for sounds too big for the speakers. */
  private overdriven(to: AudioNode, gain: number): GainNode {
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.drive;
    shaper.oversample = '2x';
    const input = this.v.gain(gain, shaper);
    shaper.connect(to);
    return input;
  }

  /**
   * A real-sounding blast, in layers: the sharp crack of the shock front, the boom (a roar of noise closing down
   * from bright to dark, driven into distortion), a sub-bass punch you feel more than hear, a long rumble rolling
   * away, and the hall ringing with it; then debris: coins raining back down around the machine, heavier bits
   * thudding, embers crackling. The music ducks under it, and under a picked file too.
   */
  explosion(): void {
    const t = this.now();
    const v = this.v;
    this.duck(0.5, 1.5);
    if (this.played('explosion', t)) return;
    const blast = this.synthOut('explosion');
    // The whole blast at about a quarter of its old loudness (2026-10-01: you found bombs far too loud).
    const sfx = v.gain(BOMB_LEVEL, blast.sfx);
    const space = v.gain(BOMB_LEVEL, blast.space);
    const boom = this.overdriven(sfx, 1.6);
    boom.connect(this.v.gain(0.5, space));
    // The crack: a split second of bright noise.
    v.hiss(sfx, t, 0.07, 0.9, 'highpass', 1200, undefined, 0.5, 0.001);
    v.hiss(space, t, 0.07, 0.6, 'highpass', 1200, undefined, 0.5, 0.001);
    // The boom.
    v.hiss(boom, t, 1.8, 0.75, 'lowpass', 5200, 160, 0.7, 0.003);
    v.hiss(boom, t + 0.01, 0.5, 0.5, 'bandpass', 700, 180, 0.9, 0.004);
    // The punch in the chest.
    v.tone(boom, 'sine', 88, t, 0.7, 0.9, 30, 0.002);
    v.tone(boom, 'sine', 52, t + 0.015, 1.3, 0.6, 24, 0.01);
    // The rumble rolling away.
    v.hiss(sfx, t + 0.05, 3.6, 0.38, 'lowpass', 220, 60, 0.6, 0.12);
    v.hiss(space, t + 0.1, 2.5, 0.25, 'lowpass', 900, 150, 0.6, 0.1);
    // Debris coming back down: coins bouncing off glass and steel all over, and heavier thumps.
    for (let i = 0; i < 22; i++) {
      const at = t + 0.25 + Math.random() ** 1.5 * 1.8;
      const out = v.panned(Math.random() * 1.6 - 0.8, sfx);
      v.bell(out, 1700 + Math.random() * 1600, at, 0.035 * (1 - (at - t) / 2.4), 0.25);
      if (i % 3 === 0) v.bell(space, 1700 + Math.random() * 1600, at, 0.02, 0.3);
    }
    for (let i = 0; i < 6; i++) {
      const at = t + 0.35 + Math.random() * 1.1;
      const out = v.panned(Math.random() * 1.2 - 0.6, sfx);
      v.tone(out, 'sine', 110 + Math.random() * 90, at, 0.18, 0.18, 60);
      v.hiss(out, at, 0.08, 0.14, 'lowpass', 900);
    }
    // Embers crackling.
    for (let i = 0; i < 16; i++) v.hiss(sfx, t + 0.15 + Math.random() * 1.4, 0.006 + Math.random() * 0.01, 0.06 + Math.random() * 0.08, 'highpass', 2500);
  }

  /** A lit fuse: a steady fizz with crackles and spits, getting angrier as it burns down. */
  fuse(seconds: number, delay: number): void {
    const t = this.now() + Math.max(0, delay);
    if (this.played('fuse', t)) return;
    const v = this.v;
    const { sfx } = this.synthOut('fuse');
    const fizz = this.ctx.createGain();
    fizz.gain.setValueAtTime(0, t);
    fizz.gain.linearRampToValueAtTime(0.05, t + 0.08);
    fizz.gain.linearRampToValueAtTime(0.1, t + seconds);
    fizz.gain.linearRampToValueAtTime(0, t + seconds + 0.03);
    fizz.connect(sfx);
    v.hiss(fizz, t, seconds + 0.05, 1, 'bandpass', 3200, 5200, 1.2, 0.02);
    for (let i = 0; i < 70; i++) {
      // Crackles bunch up toward the end.
      const at = t + Math.sqrt(Math.random()) * seconds;
      v.hiss(sfx, at, 0.004 + Math.random() * 0.01, 0.04 + Math.random() * 0.1 * ((at - t) / seconds + 0.3), 'highpass', 1800 + Math.random() * 3000);
    }
  }

  /**
   * A gift coming in. The wind-up: a whoosh of air rising in pitch, a rising drone and, for bigger gifts, a sparkle
   * of bells climbing up. The payoff, as the drops start: a deep boom, a cash register's "cha-ching", and a shower
   * of coins pouring in, longer for bigger gifts, ringing through the hall.
   */
  donation(tier: number, windup: number): void {
    const t = this.now();
    // The music dips under it, under a picked file too.
    this.duck(0.35, 1.5 + tier * 0.5);
    if (this.played('donation', t)) return;
    const v = this.v;
    const { sfx, space } = this.synthOut('donation');
    const hit = t + windup;
    // The swell: bright rising air, and a rising, beating drone.
    const swell = this.ctx.createGain();
    swell.gain.setValueAtTime(0.0001, t);
    swell.gain.exponentialRampToValueAtTime(0.28 + tier * 0.06, hit - 0.02);
    swell.gain.linearRampToValueAtTime(0, hit + 0.02);
    swell.connect(sfx);
    swell.connect(space);
    v.hiss(swell, t, windup + 0.05, 1, 'bandpass', 350, 7000, 1.6, windup * 0.8);
    for (const detune of [0.995, 1.005]) v.tone(swell, 'sawtooth', 110 * detune, t, windup + 0.05, 0.12, 880, windup * 0.8);
    if (tier >= 2) {
      const notes = [72, 76, 79, 84, 88, 91, 96];
      const count = 3 + tier;
      for (let i = 0; i < count; i++) v.bell(space, midiHz(notes[i % notes.length]), t + (windup * 0.35) + (i / count) * windup * 0.6, 0.03, 0.5);
    }

    // The boom as it lands.
    const boom = this.overdriven(sfx, 1.2);
    v.tone(boom, 'sine', 75, hit, 0.7 + tier * 0.15, 0.4 + tier * 0.12, 32, 0.002);
    v.hiss(boom, hit, 0.4 + tier * 0.1, 0.25 + tier * 0.06, 'lowpass', 2500, 150, 0.7, 0.002);
    // Cha-ching: the drawer's mechanical clack, then the bell (struck twice, the way a register's does).
    v.hiss(sfx, hit, 0.05, 0.3, 'bandpass', 3000, undefined, 2);
    v.hiss(sfx, hit + 0.07, 0.06, 0.25, 'bandpass', 2200, undefined, 2);
    for (const [at, vol] of [[0.1, 0.09], [0.22, 0.07]]) {
      v.bell(sfx, 2093, hit + at, vol, 1.2);
      v.bell(space, 2093, hit + at, vol * 0.6, 1.2);
    }
    // Coins pouring in.
    // As long as the drops take to pour in (3 to 126 of them, 30 a second; see RULES in game.ts).
    const pour = [0.6, 1.8, 2.8, 4.2][Math.max(0, Math.min(3, tier - 1))];
    const coins = 10 + tier * 16;
    for (let i = 0; i < coins; i++) {
      const at = hit + 0.15 + Math.random() ** 1.3 * pour;
      const out = v.panned(Math.random() * 1.2 - 0.6, sfx);
      v.bell(out, 1800 + Math.random() * 1400, at, 0.03 + Math.random() * 0.02, 0.22);
      if (i % 2 === 0) v.bell(space, 1800 + Math.random() * 1400, at, 0.015, 0.3);
    }
  }

  /** A heavy gift drop landing: a thud with a metallic clang (a deep one for a giant coin). */
  impact(kind: 'gold' | 'giant' | 'bomb', delay: number): void {
    const t = this.now() + Math.max(0, delay);
    const moment = IMPACT_MOMENT[kind];
    if (this.played(moment, t)) return;
    const v = this.v;
    const { sfx, space } = this.synthOut(moment);
    if (kind === 'giant') {
      const boom = this.overdriven(sfx, 1.2);
      v.tone(boom, 'sine', 95, t, 0.45, 0.7, 38, 0.002);
      v.hiss(boom, t, 0.3, 0.35, 'lowpass', 1400, 200);
      v.bell(sfx, 420, t, 0.07, 0.9);
      v.bell(space, 420, t, 0.05, 1.2);
    } else if (kind === 'gold') {
      v.tone(sfx, 'sine', 160, t, 0.2, 0.25, 70);
      v.bell(sfx, 1320, t, 0.06, 0.8);
      v.bell(space, 1320, t, 0.04, 1);
    } else {
      v.tone(sfx, 'sine', 120, t, 0.25, 0.45, 45, 0.002);
      v.hiss(sfx, t, 0.15, 0.25, 'lowpass', 700);
    }
  }

  /** The ground heaving: a deep rolling rumble, with the whole pile of coins rattling and jingling on top. */
  quake(seconds: number): void {
    const t = this.now();
    if (this.played('quake', t)) return;
    const { sfx } = this.synthOut('quake');
    const src = this.ctx.createBufferSource();
    src.buffer = this.v.noise;
    src.loop = true;
    const low = this.ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 140;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.7, t + 0.3);
    env.gain.setValueAtTime(0.7, t + Math.max(0.3, seconds - 0.8));
    env.gain.linearRampToValueAtTime(0, t + seconds);
    const wobble = this.ctx.createOscillator();
    wobble.frequency.value = 7;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.3;
    depth.connect(env.gain);
    wobble.connect(depth);
    src.connect(low).connect(env).connect(sfx);
    src.start(t);
    src.stop(t + seconds + 0.1);
    wobble.start(t);
    wobble.stop(t + seconds + 0.1);
    this.v.tone(this.overdriven(sfx, 1), 'sine', 42, t, seconds, 0.35, 30, 0.3);
    for (let i = 0; i < seconds * 14; i++) {
      const out = this.v.panned(Math.random() * 1.6 - 0.8, sfx);
      this.v.bell(out, 1600 + Math.random() * 1800, t + Math.random() * seconds, 0.012 + Math.random() * 0.018, 0.2);
    }
  }

  /** Turbo pusher: a rising sweep plus a stepped power-up. */
  turbo(): void {
    const t = this.now();
    if (this.played('turbo', t)) return;
    const { sfx } = this.synthOut('turbo');
    this.v.tone(sfx, 'sawtooth', 180, t, 0.9, 0.08, 1400, 0.05);
    [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.v.tone(sfx, 'square', midiHz(n), t + 0.1 + i * 0.07, 0.12, 0.04));
  }

  /** A gift: a bright major fanfare. */
  fanfare(): void {
    const t = this.now();
    if (this.played('fanfare', t)) return;
    const { sfx } = this.synthOut('fanfare');
    [72, 76, 79, 84].forEach((n, i) => this.v.tone(sfx, 'square', midiHz(n), t + i * 0.09, 0.22, 0.08));
    [84, 88, 91].forEach((n) => this.v.tone(sfx, 'triangle', midiHz(n), t + 0.4, 0.9, 0.08, undefined, 0.02));
  }

  /** An alert's voice recording, fetched and decoded ahead of its turn (see preloadVoice). */
  private readonly voices = new Map<string, Promise<AudioBuffer | null>>();

  preloadVoice(url: string): void {
    if (this.voices.has(url)) return;
    const loading = fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status}`))))
      .then((data) => this.ctx.decodeAudioData(data))
      .catch((err: Error) => {
        console.warn('alert voice did not load', url, err.message);
        return null;
      });
    this.voices.set(url, loading);
    // Recordings are only played once; forget old ones.
    while (this.voices.size > 30) this.voices.delete(this.voices.keys().next().value!);
  }

  voice(url: string): void {
    this.preloadVoice(url);
    void this.voices.get(url)!.then((buffer) => {
      if (!buffer) return;
      const t = this.now();
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      // Straight to the master, above the effects volume: the voice should always be heard.
      src.connect(this.v.gain(VOICE_LEVEL, this.master));
      src.start(t);
      // The music sits well under the voice, then eases back.
      const g = this.duckBus.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.3, t + 0.15);
      g.setValueAtTime(0.3, t + buffer.duration);
      g.setTargetAtTime(1, t + buffer.duration, 0.5);
      this.voices.delete(url);
    });
  }

  /** A community milestone: a scale run up into a held chord. */
  jingle(): void {
    const t = this.now();
    if (this.played('jingle', t)) return;
    const { sfx } = this.synthOut('jingle');
    [60, 62, 64, 65, 67, 69, 71, 72].forEach((n, i) => this.v.tone(sfx, 'square', midiHz(n + 12), t + i * 0.06, 0.12, 0.07));
    [72, 76, 79, 84].forEach((n) => this.v.tone(sfx, 'triangle', midiHz(n), t + 0.5, 1.4, 0.08, undefined, 0.03));
  }
}

/** Plays the song the server's DJ picked, crossfading from the last one; generated synthwave when there are none. */
class MusicPlayer {
  private current: { id: number; el: HTMLAudioElement; gain: GainNode } | null = null;
  private generator: Synthwave | null = null;
  private generatorSong = -1;
  /** Paused from the control panel (the song stays loaded, ready to carry on). */
  private held = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {}

  resume(): void {
    if (!this.held) void this.current?.el.play().catch(() => {});
  }

  follow(state: MusicState): void {
    // Paused from the control panel: everything eases out and holds its place.
    if (state.pausedAt !== null) {
      this.pause();
      return;
    }
    if (!state.url) {
      this.fadeOut();
      this.generator ??= new Synthwave(this.ctx, this.out);
      // Each new "song" (including a skip) restarts the generator with a fresh arrangement.
      if (this.generatorSong !== state.id) {
        this.generatorSong = state.id;
        this.generator.start();
      }
      return;
    }
    if (this.generator) {
      this.generator.stop();
      this.generator = null;
      this.generatorSong = -1;
    }
    if (this.current?.id === state.id) {
      // Unpaused: carry on from where the server says the song is, and ease back in.
      if (this.current.el.paused && this.held) {
        this.held = false;
        const offset = (Date.now() - state.startedAt) / 1000;
        // A live stream (internet radio) can't seek: it starts again from now instead.
        if (!Number.isFinite(this.current.el.duration)) this.current.el.load();
        else if (offset >= 0 && offset < this.current.el.duration) this.current.el.currentTime = offset;
        const t = this.ctx.currentTime;
        this.current.gain.gain.cancelScheduledValues(t);
        this.current.gain.gain.setValueAtTime(0, t);
        this.current.gain.gain.linearRampToValueAtTime(1, t + PAUSE_FADE_SEC);
        void this.current.el.play().catch(() => {});
      }
      return; // otherwise the same song: this update only changed the volume
    }
    this.held = false;
    this.play(state);
  }

  private pause(): void {
    if (this.generator) {
      this.generator.stop();
      this.generator = null;
      this.generatorSong = -1; // starts a fresh arrangement when unpaused
    }
    const current = this.current;
    if (!current || this.held) return;
    this.held = true;
    const t = this.ctx.currentTime;
    current.gain.gain.cancelScheduledValues(t);
    current.gain.gain.setValueAtTime(current.gain.gain.value, t);
    current.gain.gain.linearRampToValueAtTime(0, t + PAUSE_FADE_SEC);
    setTimeout(() => {
      if (this.held && this.current === current) current.el.pause();
    }, PAUSE_FADE_SEC * 1000 + 50);
  }

  private play(state: MusicState): void {
    this.fadeOut();
    const el = new Audio(state.url);
    el.preload = 'auto';
    const gain = this.ctx.createGain();
    this.ctx.createMediaElementSource(el).connect(gain).connect(this.out);
    this.current = { id: state.id, el, gain };
    // A stage that connects mid-song (OBS reloading, a new preview) joins at the right spot.
    el.addEventListener(
      'loadedmetadata',
      () => {
        const offset = (Date.now() - state.startedAt) / 1000;
        // A live stream (internet radio) has no length and plays from now.
        if (Number.isFinite(el.duration) && offset > 1 && offset < el.duration - 1) el.currentTime = offset;
      },
      { once: true },
    );
    // A live stream that drops (the station blips, or isn't answering yet) connects again a few seconds later, for as
    // long as it's the music. A station that stays down is the server's to notice: it switches to the house songs.
    if (state.seconds <= 0) {
      const reconnect = () =>
        setTimeout(() => {
          if (this.current?.el !== el || this.held) return;
          el.load();
          void el.play().catch(() => {});
        }, RADIO_RETRY_MS);
      el.addEventListener('error', reconnect);
      el.addEventListener('ended', reconnect);
    }
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + CROSSFADE_SEC);
    void el.play().catch(() => {
      // Blocked until the page gets a click (normal browsers only); resume() retries.
    });
  }

  private fadeOut(): void {
    const previous = this.current;
    if (!previous) return;
    this.current = null;
    const t = this.ctx.currentTime;
    previous.gain.gain.cancelScheduledValues(t);
    previous.gain.gain.setValueAtTime(previous.gain.gain.value, t);
    previous.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_SEC);
    setTimeout(() => {
      // Release the file and its decoder: this runs 24/7, one song after another.
      previous.el.pause();
      previous.el.removeAttribute('src');
      previous.el.load();
      previous.gain.disconnect();
    }, CROSSFADE_SEC * 1000 + 200);
  }
}

/** A never-quite-repeating synthwave loop: drums, pulsing bass, pads, arpeggio and an occasional lead. */
class Synthwave {
  private readonly v: Voice;
  private readonly bus: GainNode;
  private readonly pads: GainNode;
  private readonly echo: DelayNode;
  private readonly step16: number;
  private step = 0;
  private nextTime = 0;
  private progression = 0;
  private timer = 0;
  // A minor: Am F C G, and Am Em F G, as MIDI chord tones.
  private static readonly PROGRESSIONS = [
    [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    [[57, 60, 64], [52, 55, 59], [53, 57, 60], [55, 59, 62]],
  ];
  private static readonly SCALE = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76];

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    bpm = 100,
  ) {
    this.v = new Voice(ctx, whiteNoise(ctx, 2));
    this.step16 = 60 / bpm / 4;
    this.bus = this.v.gain(GENERATED_MUSIC_LEVEL, out);
    const reverb = ctx.createConvolver();
    reverb.buffer = roomImpulse(ctx, 2.4);
    reverb.connect(this.v.gain(0.35, this.bus));
    this.pads = this.v.gain(1, this.bus);
    this.pads.connect(reverb);
    // Dotted-eighth echo, the classic synthwave arpeggio delay.
    this.echo = ctx.createDelay(2);
    this.echo.delayTime.value = this.step16 * 3;
    const feedback = this.v.gain(0.35, this.echo);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2500;
    this.echo.connect(tone).connect(feedback);
    tone.connect(this.bus);
  }

  /** Starts (or restarts, for a skip) from the top of a fresh arrangement. */
  start(): void {
    clearInterval(this.timer);
    this.step = 0;
    this.progression = Math.random() < 0.6 ? 0 : 1;
    this.nextTime = this.ctx.currentTime + 0.2;
    this.timer = window.setInterval(() => {
      while (this.nextTime < this.ctx.currentTime + 0.15) {
        this.play(this.step, this.nextTime);
        this.nextTime += this.step16;
        this.step++;
      }
    }, 25);
  }

  /** Fades out and goes quiet for good (songs were imported). */
  stop(): void {
    clearInterval(this.timer);
    this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
    setTimeout(() => this.bus.disconnect(), 3000);
  }

  private play(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const pos = step % 16;
    if (pos === 0 && bar % 8 === 0) this.progression = Math.random() < 0.6 ? 0 : 1;
    const chord = Synthwave.PROGRESSIONS[this.progression][bar % 4];
    const section = Math.floor(bar / 8) % 4; // 0 intro-ish, 1-2 full, 3 breakdown

    // Drums
    if (section !== 3 && (pos === 0 || pos === 8 || (pos === 10 && bar % 2 === 1))) this.kick(t);
    if (section !== 3 && (pos === 4 || pos === 12)) this.snare(t);
    if (section > 0 && pos % 2 === 0) this.v.hiss(this.bus, t, pos % 4 === 2 ? 0.09 : 0.03, 0.05, 'highpass', 8000);

    // Pulsing bass on eighths, alternating octaves.
    if (pos % 2 === 0 && section !== 0) this.bass(chord[0] - 24 + (pos % 4 === 2 ? 12 : 0), t);

    // Pad: one held chord per bar.
    if (pos === 0) for (const note of chord) this.pad(note, t, this.step16 * 16);

    // Arpeggio on sixteenths through the chord.
    if (section === 1 || section === 2) {
      const pattern = [0, 1, 2, 1];
      const note = chord[pattern[pos % 4]] + 12 + (pos >= 8 ? 12 : 0);
      this.v.tone(this.echo, 'square', midiHz(note), t, 0.12, 0.018);
      this.v.tone(this.bus, 'square', midiHz(note), t, 0.12, 0.022);
    }

    // A simple lead in the second full section.
    if (section === 2 && pos % 4 === 0 && Math.random() < 0.7) {
      const scale = Synthwave.SCALE;
      const note = scale[Math.floor(Math.random() * scale.length)] + 12;
      this.v.tone(this.pads, 'sawtooth', midiHz(note), t, this.step16 * 3.5, 0.03, undefined, 0.02);
    }
  }

  private kick(t: number): void {
    this.v.tone(this.bus, 'sine', 150, t, 0.35, 0.8, 42, 0.002);
    // Duck the pads on each kick: the synthwave "pump".
    this.pads.gain.cancelScheduledValues(t);
    this.pads.gain.setValueAtTime(0.35, t);
    this.pads.gain.linearRampToValueAtTime(1, t + 0.28);
  }

  private snare(t: number): void {
    this.v.hiss(this.pads, t, 0.2, 0.28, 'bandpass', 1800, undefined, 0.7);
    this.v.tone(this.bus, 'triangle', 190, t, 0.1, 0.18);
  }

  private bass(note: number, t: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiHz(note);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(220, t + 0.14);
    filter.Q.value = 4;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.16, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + this.step16 * 1.8);
    osc.connect(filter).connect(env).connect(this.bus);
    osc.start(t);
    osc.stop(t + this.step16 * 2);
  }

  private pad(note: number, t: number, dur: number): void {
    for (const cents of [-9, 0, 9]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiHz(note);
      osc.detune.value = cents;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1100;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.022, t + 0.35);
      env.gain.setValueAtTime(0.022, t + dur - 0.3);
      env.gain.linearRampToValueAtTime(0, t + dur + 0.2);
      osc.connect(filter).connect(env).connect(this.pads);
      osc.start(t);
      osc.stop(t + dur + 0.3);
    }
  }
}
