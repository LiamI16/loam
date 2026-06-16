import type { Engine } from '../../engine.js';
import type { EngineEvent, TickEvent } from '../../events.js';
import type { Seed } from '../../rng/seed.js';
import { ChordScheduler } from './chord-scheduler.js';
import { CrackleScheduler } from './crackle-scheduler.js';
import { DrumScheduler } from './drum-scheduler.js';
import { MelodyScheduler } from './melody-scheduler.js';

/** User-tunable options for `EmberEngine`. All are live-mutable via
 * `engine.setOption(name, value)`; sub-schedulers read the shared options
 * object each tick. */
export interface EmberOptions {
  /** Tempo in beats per minute. Default 74 (matches prototype). */
  bpm?: number;
  /** Per-quarter-note melody-firing probability, 0..1. Default 0.18. */
  density?: number;
  /** Whether to fire vinyl crackle ornaments. Default true. */
  vinylEnabled?: boolean;
}

/** Resolved (no-undefined) options. Shared mutable ref across sub-schedulers. */
export interface ResolvedEmberOptions {
  bpm: number;
  density: number;
  vinylEnabled: boolean;
}

/** What sub-schedulers do — emit events in the engine-time window
 * `[from, to)`. Engine guarantees monotonic forward calls; `from` is the
 * engine's previous cursor and `to` is the new one. */
export interface SubScheduler {
  scheduleUntil(from: number, to: number): EngineEvent[];
  reset(): void;
}

/**
 * The Stage-4 engine. Composes four independent sub-schedulers, each
 * pulling from its own named child seed so adding a new layer never
 * perturbs an existing one (per `docs/seed-format.md` §3).
 *
 * Behavior is the prototype's, ported note-for-note — chord vamp every
 * 2 bars with light random voicing, boom-bap drums with ghost hats,
 * sparse pentatonic melody, vinyl crackle. The only behavioral difference
 * vs. the HTML prototype is that all randomness comes from the seeded
 * `Rng`, so a fixed seed produces a fixed soundscape.
 */
export class EmberEngine implements Engine {
  private cursor = 0;
  private readonly options: ResolvedEmberOptions;
  private readonly chords: ChordScheduler;
  private readonly drums: DrumScheduler;
  private readonly melody: MelodyScheduler;
  private readonly crackle: CrackleScheduler;

  constructor(seed: Seed, options: EmberOptions = {}) {
    this.options = {
      bpm: options.bpm ?? 74,
      density: options.density ?? 0.18,
      vinylEnabled: options.vinylEnabled ?? true,
    };
    this.chords = new ChordScheduler(seed.child('chords'), this.options);
    this.drums = new DrumScheduler(seed.child('drums'), this.options);
    this.melody = new MelodyScheduler(seed.child('melody'), this.options);
    this.crackle = new CrackleScheduler(seed.child('crackle'), this.options);
  }

  scheduleUntil(until: number): EngineEvent[] {
    if (until <= this.cursor) return [];
    const events: EngineEvent[] = [
      ...this.chords.scheduleUntil(this.cursor, until),
      ...this.drums.scheduleUntil(this.cursor, until),
      ...this.melody.scheduleUntil(this.cursor, until),
      ...this.crackle.scheduleUntil(this.cursor, until),
      ...this.emitTicks(this.cursor, until),
    ];
    events.sort((a, b) => a.time - b.time);
    this.cursor = until;
    return events;
  }

  reset(): void {
    this.cursor = 0;
    this.chords.reset();
    this.drums.reset();
    this.melody.reset();
    this.crackle.reset();
  }

  /**
   * Live-mutate an engine option. Sub-schedulers read the shared options
   * object each tick, so changes take effect on the next pump.
   * Note: `bpm` change mid-session is not currently supported safely
   * (sub-schedulers cache their step sizes); UI should not expose it.
   */
  setOption<K extends keyof ResolvedEmberOptions>(name: K, value: ResolvedEmberOptions[K]): void {
    this.options[name] = value;
  }

  /** Snapshot current options (for UI display, tests). */
  getOptions(): Readonly<ResolvedEmberOptions> {
    return { ...this.options };
  }

  private emitTicks(from: number, to: number): TickEvent[] {
    const events: TickEvent[] = [];
    const secondsPerBeat = 60 / this.options.bpm;
    const firstBeat = Math.max(0, Math.ceil(from / secondsPerBeat - 1e-9));
    let beatIdx = firstBeat;
    let beatTime = beatIdx * secondsPerBeat;
    while (beatTime < to) {
      events.push({
        kind: 'tick',
        bar: Math.floor(beatIdx / 4),
        beat: beatIdx % 4,
        time: beatTime,
      });
      beatIdx++;
      beatTime = beatIdx * secondsPerBeat;
    }
    return events;
  }
}
