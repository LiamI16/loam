import type { Engine } from '../../engine.js';
import type { EngineEvent, ParamEvent, TickEvent } from '../../events.js';
import { Fbm1D } from '../../noise/fbm.js';
import { FbmParam, type ParamStream, StaticParam } from '../../params/param-stream.js';
import type { Seed } from '../../rng/seed.js';
import { ChordScheduler } from './chord-scheduler.js';
import { CrackleScheduler } from './crackle-scheduler.js';
import { DrumScheduler } from './drum-scheduler.js';
import type { ChordSymbol } from './harmony/index.js';
import { MelodyScheduler } from './melody-scheduler.js';

/**
 * User-facing options for `EmberEngine`. `density` is the mean of an
 * fBm-driven stream — the actual instantaneous density wanders around it.
 * Depth and base frequency of the wander are seed-derived, not exposed.
 */
export interface EmberOptions {
  /** Tempo in beats per minute. Default 74. Not live-mutable; changing
   * BPM requires rebuilding the engine. */
  bpm?: number;
  /** Centerpoint of the melody-firing-density fBm walk. 0..1. Default 0.18. */
  density?: number;
  /** Whether to fire vinyl crackle events. Default true. */
  vinylEnabled?: boolean;
}

/**
 * Internal state shared by EmberEngine and its sub-schedulers. Sub-
 * schedulers hold a reference and read fresh on every tick — mutations
 * by `engine.setOption(...)` propagate immediately (no copy semantics).
 *
 * Streams (`densityStream`, `evoCutoffStream`) are time-varying. Static
 * fields (`bpm`, `vinylEnabled`) change only via setOption or rebuild.
 */
export interface EngineState {
  bpm: number;
  densityStream: ParamStream;
  evoCutoffStream: ParamStream;
  vinylEnabled: boolean;
  /** Active chord at engine-time of the most recent chord emission.
   * `ChordScheduler` writes; `MelodyScheduler` reads for its filter. */
  currentChord: ChordSymbol | null;
}

/** What sub-schedulers do — emit events in `[from, to)`. */
export interface SubScheduler {
  scheduleUntil(from: number, to: number): EngineEvent[];
  reset(): void;
}

/** How often the engine emits a `ParamEvent` for continuous parameters
 * like `fx.evoFilter.cutoff`. Each emission ramps over the same interval
 * for smooth motion between samples. 250 ms = 4 Hz update rate, well
 * below audio rate and well above visible LFO-step granularity. */
const PARAM_TICK_SEC = 0.25;

/**
 * Stage 5 engine. Composes four independent sub-schedulers plus an
 * fBm-driven continuous-parameter stream that emits `ParamEvent`s for
 * adapter-side knobs (Stage 5: `fx.evoFilter.cutoff`).
 *
 * Per-seed liveliness: each fBm-driven parameter draws its depth and
 * base frequency from a dedicated `seed.child('<param>-fbm-config')`
 * stream at construction. Same seed → same liveliness fingerprint.
 */
export class EmberEngine implements Engine {
  private cursor = 0;
  private readonly state: EngineState;
  private readonly chords: ChordScheduler;
  private readonly drums: DrumScheduler;
  private readonly melody: MelodyScheduler;
  private readonly crackle: CrackleScheduler;

  constructor(seed: Seed, options: EmberOptions = {}) {
    const bpm = options.bpm ?? 74;
    const densityMean = options.density ?? 0.18;
    const vinylEnabled = options.vinylEnabled ?? true;

    // Per-seed liveliness fingerprint for density: draw depth & base freq
    // from a dedicated child stream so adding a new param later doesn't
    // shift density's character. Ranges deliberately wide so two seeds
    // produce audibly different breathing characters.
    const densityCfgRng = seed.child('density-fbm-config').rng();
    const densityDepth = densityCfgRng.nextRange(0.05, 0.3);
    const densityBaseFreq = densityCfgRng.nextRange(0.005, 0.025);

    // Evo-filter sweep: depth range chosen to comfortably exceed the
    // prototype's static LFO swing (±750 Hz) at the high end, so the
    // motion is unmistakable. Low end keeps some seeds calmer.
    const evoCfgRng = seed.child('evofilter-fbm-config').rng();
    const evoDepth = evoCfgRng.nextRange(600, 1400);
    const evoBaseFreq = evoCfgRng.nextRange(0.015, 0.04);

    const densityFbm = new Fbm1D(seed.child('density-fbm'));
    const evoFbm = new Fbm1D(seed.child('evofilter-fbm'));

    this.state = {
      bpm,
      vinylEnabled,
      currentChord: null,
      densityStream: new FbmParam(densityFbm, {
        mean: densityMean,
        depth: densityDepth,
        baseFreq: densityBaseFreq,
        minValue: 0,
        maxValue: 1,
      }),
      // Evo-filter cutoff mean matches the prototype's static initial
      // value (1800 Hz). Range guards against the filter ever going
      // negative or above a reasonable cutoff.
      evoCutoffStream: new FbmParam(evoFbm, {
        mean: 1800,
        depth: evoDepth,
        baseFreq: evoBaseFreq,
        minValue: 200,
        maxValue: 4000,
      }),
    };

    this.chords = new ChordScheduler(seed.child('chords'), this.state);
    this.drums = new DrumScheduler(seed.child('drums'), this.state);
    this.melody = new MelodyScheduler(seed.child('melody'), this.state);
    this.crackle = new CrackleScheduler(seed.child('crackle'), this.state);
  }

  scheduleUntil(until: number): EngineEvent[] {
    if (until <= this.cursor) return [];
    const events: EngineEvent[] = [
      ...this.chords.scheduleUntil(this.cursor, until),
      ...this.drums.scheduleUntil(this.cursor, until),
      ...this.melody.scheduleUntil(this.cursor, until),
      ...this.crackle.scheduleUntil(this.cursor, until),
      ...this.emitTicks(this.cursor, until),
      ...this.emitContinuousParams(this.cursor, until),
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
   * Live-mutate an engine option. `density` updates the fBm centerpoint
   * without disturbing motion. `bpm` is intentionally not live-settable
   * (sub-schedulers cache step sizes); the demo rebuilds the engine on
   * BPM change instead.
   */
  setOption<K extends keyof EmberOptions>(name: K, value: NonNullable<EmberOptions[K]>): void {
    if (name === 'density') {
      const stream = this.state.densityStream;
      if (stream instanceof FbmParam) {
        stream.mean = value as number;
      } else if (stream instanceof StaticParam) {
        stream.value = value as number;
      }
    } else if (name === 'vinylEnabled') {
      this.state.vinylEnabled = value as boolean;
    }
    // bpm: ignored intentionally
  }

  /** Snapshot of current option setpoints (for UI / tests). */
  getOptions(): Required<EmberOptions> {
    const ds = this.state.densityStream;
    const densityMean =
      ds instanceof FbmParam ? ds.mean : ds instanceof StaticParam ? ds.value : ds.evaluate(0);
    return {
      bpm: this.state.bpm,
      density: densityMean,
      vinylEnabled: this.state.vinylEnabled,
    };
  }

  private emitTicks(from: number, to: number): TickEvent[] {
    const events: TickEvent[] = [];
    const secondsPerBeat = 60 / this.state.bpm;
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

  /** Sample the continuous-parameter streams at a regular cadence and
   * emit `ParamEvent`s with a `rampMs` matching the cadence — the adapter
   * smoothly interpolates between sampled values, hiding the
   * discretization. */
  private emitContinuousParams(from: number, to: number): ParamEvent[] {
    const events: ParamEvent[] = [];
    const firstTick = Math.max(0, Math.ceil(from / PARAM_TICK_SEC - 1e-9));
    let tickIdx = firstTick;
    let tickTime = tickIdx * PARAM_TICK_SEC;
    const rampMs = PARAM_TICK_SEC * 1000;
    while (tickTime < to) {
      events.push({
        kind: 'param',
        target: 'fx.evoFilter.cutoff',
        value: this.state.evoCutoffStream.evaluate(tickTime),
        rampMs,
        time: tickTime,
      });
      tickIdx++;
      tickTime = tickIdx * PARAM_TICK_SEC;
    }
    return events;
  }
}
