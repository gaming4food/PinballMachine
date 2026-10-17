// The stage's sound files (picked on the soundboard, see sounds.ts), and a machine's own: each fetched and decoded once,
// and played only once it has decoded. A moment whose file isn't ready, or never will be, plays its synth instead.

/**
 * A moment's sound files and how loud they play: 1 plays a file as it is, and the synth at its usual level. Several
 * files take turns; none keeps the synth, at this volume.
 */
export interface Pick {
  readonly files: readonly string[];
  readonly volume: number;
}

/**
 * Sound files, each loaded once (fetched and decoded, by `load`) and started by `start`. It never loads anything as it
 * plays. `B` is a decoded file (the stage's AudioBuffer), so the bank can be tried without a browser.
 */
export class SampleBank<B> {
  /** Every file asked for, loaded or not, so none is fetched twice. */
  private readonly asked = new Set<string>();
  private readonly decoded = new Map<string, B>();
  /** The file each set of files played last, so the next turn goes to another. */
  private readonly last = new Map<string, string>();

  constructor(
    private readonly load: (url: string) => Promise<B>,
    private readonly start: (b: B, at: number, volume: number, rate: number, pan: number) => void,
    private readonly random: () => number = Math.random,
  ) {}

  /** Starts loading each file not asked for before. One that fails is never played (`load` says why). */
  preload(urls: readonly string[]): void {
    for (const url of urls) {
      if (this.asked.has(url)) continue;
      this.asked.add(url);
      this.load(url).then(
        (b) => this.decoded.set(url, b),
        () => {},
      );
    }
  }

  /**
   * Starts one of `files` at `at`, and says so; false, starting nothing, while none has decoded. The files take turns,
   * never the same one twice in a row when two or more have decoded, each at a pitch up to `jitter` (by default 4%)
   * off its own.
   */
  play(files: readonly string[], o: { at: number; volume: number; pan?: number; jitter?: number }): boolean {
    // Each file once, though a list may name one twice.
    const ready = [...new Set(files)].filter((file) => this.decoded.has(file));
    if (!ready.length) return false;
    const set = files.join('\n');
    const last = this.last.get(set);
    const choices = ready.length > 1 ? ready.filter((file) => file !== last) : ready;
    // Math.random is always under 1, but a stand-in for it may give 1 itself.
    const file = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    this.last.set(set, file);
    const rate = 1 + (this.random() * 2 - 1) * (o.jitter ?? 0.04);
    this.start(this.decoded.get(file)!, o.at, o.volume, rate, o.pan ?? 0);
    return true;
  }
}
