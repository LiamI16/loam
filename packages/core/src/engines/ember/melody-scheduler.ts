import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import { Fbm1D } from '../../noise/fbm.js';
import { FbmParam } from '../../params/param-stream.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import { dominantModeAtPosition, modeMidiBag } from './harmony/index.js';
import { type Germ, type GermNote, generateGerm, type Template } from './melody/index.js';

/**
 * Germ-driven melody scheduler. Phase 1 of three (see
 * `docs/melody-implementation-plan.md`).
 *
 * At each quarter-note position the F1 min-cap coupling formula
 * computes an effective firing probability:
 *
 *   effective = (1 - c) · melody + c · min(melody, 1 - chord)
 *
 * Bernoulli draw against `effective`; when it fires, the next germ note
 * is emitted (germ cycles indefinitely). Pitches come from the per-seed
 * germ (scale-degree offsets) projected onto the dominant mode bag at
 * the current position. Transformations / buffer / four-way emission
 * rules / swing + jitter all land in Phases 2-3.
 *
 * Seed children:
 *   - `melody-template-config`         — Dirichlet template weights
 *   - `melody-template`                — template-selection roll
 *   - `melody-germ`                    — germ pitch + length rolls
 *   - `melody-activity-fbm`            — melody's own activity fBm
 *   - `melody-activity-config`         — per-seed mean / depth shape
 *   - `melody-chord-coupling-fbm`      — coupling-strength fBm
 *   - `melody-chord-coupling-config`   — per-seed mean / depth
 *   - root `melody` stream             — per-emission Bernoulli + velocity
 */

/** Per-seed melody-activity fBm. Mirrors the chord-activity shape so
 * the two streams breathe on comparable scales — important because the
 * min-cap formula mixes them additively. */
const MELODY_ACTIVITY_MEAN = 0.35;
const MELODY_ACTIVITY_MIN = 0.1;
const MELODY_ACTIVITY_MAX = 0.7;
const MELODY_ACTIVITY_BASE_FREQ = 1 / 90;
const MELODY_ACTIVITY_MEAN_SHAPE_RANGE = 0.1;
const MELODY_ACTIVITY_DEPTH_SHAPE_RANGE: [number, number] = [0.15, 0.35];

/** Coupling stream per `docs/melody.md` F1: per-seed mean in [0.2, 0.8],
 * depth in [0.05, 0.12], slowest octave ~4 min (slower than activity
 * itself — coupling is a higher-level character trait). */
const COUPLING_MEAN_RANGE: [number, number] = [0.2, 0.8];
const COUPLING_DEPTH_RANGE: [number, number] = [0.05, 0.12];
const COUPLING_BASE_FREQ = 1 / 240;
const COUPLING_MIN = 0;
const COUPLING_MAX = 1;

/** Index into the mode bag where germ offset 0 anchors. The dominant
 * mode bag spans ~A4..C6 (6 notes); index 2 lands around the middle. */
const GERM_ANCHOR_INDEX = 2;

/** Melody velocity range (carried over from the prior density-driven
 * scheduler). Soft so the lead sits behind chord/pad despite the −9 dB
 * channel offset. */
const VEL_MIN = 0.22;
const VEL_JITTER = 0.12;

export class MelodyScheduler implements SubScheduler {
  private rng!: Rng;
  private nextQuarter = 1;
  private germIdx = 0;
  private readonly secondsPerBeat: number;
  /** Per-seed motivic axiom + the template that generated it. Germ is
   * fixed for the session per F2; Phase 2 transformations will derive
   * variations from this constant skeleton. */
  readonly template: Template;
  readonly germ: Germ;
  private readonly activityStream: FbmParam;
  private readonly couplingStream: FbmParam;

  constructor(
    private readonly seed: Seed,
    private readonly state: EngineState,
  ) {
    this.secondsPerBeat = 60 / state.bpm;

    const { template, germ } = generateGerm(seed);
    this.template = template;
    this.germ = germ;

    const actCfgRng = seed.child('melody-activity-config').rng();
    const actMeanOffset = actCfgRng.nextRange(
      -MELODY_ACTIVITY_MEAN_SHAPE_RANGE,
      MELODY_ACTIVITY_MEAN_SHAPE_RANGE,
    );
    const actDepth = actCfgRng.nextRange(
      MELODY_ACTIVITY_DEPTH_SHAPE_RANGE[0],
      MELODY_ACTIVITY_DEPTH_SHAPE_RANGE[1],
    );
    this.activityStream = new FbmParam(new Fbm1D(seed.child('melody-activity-fbm')), {
      mean: MELODY_ACTIVITY_MEAN + actMeanOffset,
      depth: actDepth,
      baseFreq: MELODY_ACTIVITY_BASE_FREQ,
      minValue: MELODY_ACTIVITY_MIN,
      maxValue: MELODY_ACTIVITY_MAX,
    });

    const couplingCfgRng = seed.child('melody-chord-coupling-config').rng();
    const couplingMean = couplingCfgRng.nextRange(COUPLING_MEAN_RANGE[0], COUPLING_MEAN_RANGE[1]);
    const couplingDepth = couplingCfgRng.nextRange(
      COUPLING_DEPTH_RANGE[0],
      COUPLING_DEPTH_RANGE[1],
    );
    this.couplingStream = new FbmParam(new Fbm1D(seed.child('melody-chord-coupling-fbm')), {
      mean: couplingMean,
      depth: couplingDepth,
      baseFreq: COUPLING_BASE_FREQ,
      minValue: COUPLING_MIN,
      maxValue: COUPLING_MAX,
    });

    this.reset();
  }

  reset(): void {
    this.nextQuarter = 1;
    this.germIdx = 0;
    this.rng = this.seed.rng();
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    while (this.nextQuarter * this.secondsPerBeat < to) {
      const time = this.nextQuarter * this.secondsPerBeat;
      const effective = this.effectiveActivity(time);
      // Always draw both rolls so that determinism is invariant to
      // whether emission fires.
      const fireRoll = this.rng.nextFloat();
      const velRoll = this.rng.nextFloat();
      if (fireRoll < effective) {
        const note = this.germ[this.germIdx % this.germ.length] as GermNote;
        this.germIdx++;
        const pitch = this.pickGermPitch(note, time);
        const durationMs = note.durationBeats * this.secondsPerBeat * 1000;
        const velocity = VEL_MIN + velRoll * VEL_JITTER;
        events.push({
          kind: 'note',
          channel: Channels.RHODES_MELODY,
          pitch,
          velocity,
          durationMs,
          time,
        });
      }
      this.nextQuarter++;
    }
    return events;
  }

  /** F1 min-cap coupling: melody plays as its own activity dictates,
   * UNLESS the chord layer doesn't leave acoustic space. Preserves
   * per-seed density character at every coupling value. */
  private effectiveActivity(time: number): number {
    const melody = this.activityStream.evaluate(time);
    const chord = this.state.chordActivityStream.evaluate(time);
    const coupling = this.couplingStream.evaluate(time);
    return (1 - coupling) * melody + coupling * Math.min(melody, 1 - chord);
  }

  /** Project a germ note's scale-degree offset onto the active mode's
   * MIDI bag. Clamped to the bag's index range (germs occasionally
   * exceed ±anchor — clamping keeps the emission inside the melody
   * register without distorting the contour silhouette). */
  private pickGermPitch(note: GermNote, time: number): number {
    const dominantMode = dominantModeAtPosition(this.state.position.evaluate(time).x);
    const bag = modeMidiBag(dominantMode);
    const idx = clampInt(GERM_ANCHOR_INDEX + note.scaleDegreeOffset, 0, bag.length - 1);
    return bag[idx] as number;
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return Math.round(v);
}
