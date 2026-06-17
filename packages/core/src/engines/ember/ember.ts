import type { Engine } from '../../engine.js';
import type { EngineEvent, ParamEvent, TickEvent } from '../../events.js';
import { Fbm1D } from '../../noise/fbm.js';
import { FbmParam, type ParamStream, StaticParam } from '../../params/param-stream.js';
import { PositionStream } from '../../params/position-stream.js';
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
  /** Wall-clock playback speed multiplier. Live-mutable. 1.0 = normal;
   * 2.0 = twice as fast; 0.5 = half speed. Scales emitted timestamps and
   * durations only — pitches and sequence are unchanged. Default 1.0. */
  speedMultiplier?: number;
}

/**
 * Internal state shared by EmberEngine and its sub-schedulers. Sub-
 * schedulers hold a reference and read fresh on every tick — mutations
 * by `engine.setOption(...)` propagate immediately (no copy semantics).
 *
 * Streams (`densityStream`, `evoCutoffStream`) are time-varying. Static
 * fields (`bpm`, `vinylEnabled`) change only via setOption or rebuild.
 *
 * `speedMultiplier` lives on the engine wrapper, not here — sub-schedulers
 * see only musical (engine) time and don't need to know about playback
 * scaling.
 */
export interface EngineState {
  bpm: number;
  densityStream: ParamStream;
  evoCutoffStream: ParamStream;
  vinylEnabled: boolean;
  /** Active chord at engine-time of the most recent chord emission.
   * `ChordScheduler` writes; `MelodyScheduler` reads for its filter. */
  currentChord: ChordSymbol | null;
  /** Stage 7a substrate. Slow 2D fBm-driven walk through the seed's
   * parameter landscape. Consumers read coords per emission and map to
   * whatever musical surface they bias. */
  position: PositionStream;
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

/** Minimum speed multiplier. Below this, scheduling becomes impractical
 * (one wall-clock second produces fractional engine content) and the
 * audio essentially halts. */
const MIN_SPEED = 0.1;

/**
 * Stage 5 engine. Composes four independent sub-schedulers plus an
 * fBm-driven continuous-parameter stream that emits `ParamEvent`s for
 * adapter-side knobs (Stage 5: `fx.evoFilter.cutoff`).
 *
 * Per-seed liveliness: each fBm-driven parameter draws its depth and
 * base frequency from a dedicated `seed.child('<param>-fbm-config')`
 * stream at construction. Same seed → same liveliness fingerprint.
 *
 * Stage 6.5 adds a wall-clock `speedMultiplier`. The engine tracks two
 * cursors — `engineCursor` (musical/unscaled time the sub-schedulers
 * see) and `audioCursor` (wall-clock time the caller sees). When the
 * multiplier changes mid-stream, already-emitted events keep their old
 * scaling; subsequent emissions use the new multiplier. Sub-schedulers
 * are untouched.
 */
export class EmberEngine implements Engine {
  private engineCursor = 0;
  private audioCursor = 0;
  private speedMultiplier: number;
  private readonly state: EngineState;
  private readonly chords: ChordScheduler;
  private readonly drums: DrumScheduler;
  private readonly melody: MelodyScheduler;
  private readonly crackle: CrackleScheduler;

  constructor(seed: Seed, options: EmberOptions = {}) {
    const bpm = options.bpm ?? 74;
    const densityMean = options.density ?? 0.18;
    const vinylEnabled = options.vinylEnabled ?? true;
    this.speedMultiplier = clampSpeed(options.speedMultiplier ?? 1.0);

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

    // Stage 7a: slow 2D position. baseFreq 0.0014 Hz → slowest octave
    // period ~12 min, faster wobble layered on top via the 3 fBm
    // octaves. Tuned for study (sustained focus) as the primary use
    // case — listener should perceive maybe one drift transition per
    // 10–15 min. Travelers can crank `speedMultiplier` to taste.
    // Consumers read .evaluate(t) per emission.
    const position = new PositionStream(seed.child('position'), {
      baseFreq: 0.0014,
      octaves: 3,
    });

    this.state = {
      bpm,
      vinylEnabled,
      currentChord: null,
      position,
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
    if (until <= this.audioCursor) return [];
    const mult = this.speedMultiplier;
    const audioFrom = this.audioCursor;
    const engineFrom = this.engineCursor;
    const engineUntil = engineFrom + (until - audioFrom) * mult;

    const raw: EngineEvent[] = [
      ...this.chords.scheduleUntil(engineFrom, engineUntil),
      ...this.drums.scheduleUntil(engineFrom, engineUntil),
      ...this.melody.scheduleUntil(engineFrom, engineUntil),
      ...this.crackle.scheduleUntil(engineFrom, engineUntil),
      ...this.emitTicks(engineFrom, engineUntil),
      ...this.emitContinuousParams(engineFrom, engineUntil),
    ];

    // Map engine-time events to audio-time. `time` of an event scales
    // linearly; `durationMs` and `rampMs` scale the same way (a half-
    // speed engine produces notes that sustain twice as long in wall
    // time). At mult=1.0 this is the identity, so locked-sequence tests
    // remain valid.
    const scaled: EngineEvent[] = raw.map((ev) => {
      const audioTime = audioFrom + (ev.time - engineFrom) / mult;
      if (ev.kind === 'note') {
        return { ...ev, time: audioTime, durationMs: ev.durationMs / mult };
      }
      if (ev.kind === 'param') {
        const next: ParamEvent = { ...ev, time: audioTime };
        if (ev.rampMs !== undefined) next.rampMs = ev.rampMs / mult;
        return next;
      }
      return { ...ev, time: audioTime };
    });
    scaled.sort((a, b) => a.time - b.time);

    this.engineCursor = engineUntil;
    this.audioCursor = until;
    return scaled;
  }

  reset(): void {
    this.engineCursor = 0;
    this.audioCursor = 0;
    this.chords.reset();
    this.drums.reset();
    this.melody.reset();
    this.crackle.reset();
  }

  /**
   * Live-mutate an engine option. `density` updates the fBm centerpoint
   * without disturbing motion. `speedMultiplier` rescales wall-clock
   * playback going forward; in-flight events keep their old scaling.
   * `bpm` is intentionally not live-settable (sub-schedulers cache step
   * sizes); the demo rebuilds the engine on BPM change instead.
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
    } else if (name === 'speedMultiplier') {
      this.speedMultiplier = clampSpeed(value as number);
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
      speedMultiplier: this.speedMultiplier,
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

function clampSpeed(v: number): number {
  if (!Number.isFinite(v) || v < MIN_SPEED) return MIN_SPEED;
  return v;
}
