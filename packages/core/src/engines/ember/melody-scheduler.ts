import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import { Fbm1D } from '../../noise/fbm.js';
import { FbmParam } from '../../params/param-stream.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import {
  type ChordSymbol,
  chordPitchClasses,
  dominantModeAtPosition,
  modeMidiBag,
  perturbDirichlet,
} from './harmony/index.js';
import { type Germ, type GermNote, generateGerm, type Template } from './melody/index.js';

/**
 * Germ-driven melody scheduler — Phase 2 Commit D.
 *
 * Each firing emits a *multi-note fragment*, not a single note. The
 * four-way per-firing decision (germ / transform / buffer / fresh)
 * is rolled at every fragment-start opportunity. In this commit only
 * the `germ` and `fresh` branches produce distinct output — `transform`
 * and `buffer` fall back to germ verbatim until Commit E lands the
 * transformation library. The buffer is still maintained so the buffer
 * branch has material to draw from when E flips it on.
 *
 * Fragment cadence: on fire, all germ notes (or one fresh note) emit
 * relative to the firing quarter, and `nextQuarter` advances past the
 * fragment's tail so we don't double-fire mid-phrase. Silence between
 * fragments emerges naturally from the activity gate.
 *
 * Seed children:
 *   - (Commit B) `melody-template-config/-` / `melody-germ`
 *   - (Commit C) `melody-activity-fbm/-config`,
 *                `melody-chord-coupling-fbm/-config`
 *   - (Commit D) `melody-emission`, `melody-emission-config`,
 *                `melody-buffer-config`
 *   - root `melody` stream: per-firing `fireRoll` + per-note velocity
 *                           + fresh-note rolls
 */

const MELODY_ACTIVITY_MEAN = 0.35;
const MELODY_ACTIVITY_MIN = 0.1;
const MELODY_ACTIVITY_MAX = 0.7;
const MELODY_ACTIVITY_BASE_FREQ = 1 / 90;
const MELODY_ACTIVITY_MEAN_SHAPE_RANGE = 0.1;
const MELODY_ACTIVITY_DEPTH_SHAPE_RANGE: [number, number] = [0.15, 0.35];

const COUPLING_MEAN_RANGE: [number, number] = [0.2, 0.8];
const COUPLING_DEPTH_RANGE: [number, number] = [0.05, 0.12];
const COUPLING_BASE_FREQ = 1 / 240;
const COUPLING_MIN = 0;
const COUPLING_MAX = 1;

const GERM_ANCHOR_INDEX = 2;

const VEL_MIN = 0.22;
const VEL_JITTER = 0.12;

/** Per-seed buffer size — last N emitted scale-degree-offset notes. */
const BUFFER_SIZE_MIN = 4;
const BUFFER_SIZE_MAX = 12;

/** Four-way emission rule. `germ` = germ verbatim; `transform` =
 * transformation of germ (lands in E); `buffer` = transformation of a
 * recent-buffer window (lands in E); `fresh` = single chord-aware
 * pitch outside the germ. */
export type EmissionRule = 'germ' | 'transform' | 'buffer' | 'fresh';

const EMISSION_RULES: readonly EmissionRule[] = ['germ', 'transform', 'buffer', 'fresh'];

/** Base weights for the four-way rule. Germ-anchored so per-seed
 * identity (the germ itself) is heard often; the other three branches
 * carry variety + local coherence + chord-aware breakouts. Per-seed
 * Dirichlet α=20 nudges each seed away from the central tendency. */
const EMISSION_BASE_WEIGHTS: readonly number[] = [0.35, 0.3, 0.2, 0.15];

const EMISSION_DIRICHLET_ALPHA = 20;

/** Fresh-note duration choices (matches the pre-Commit-C melody
 * scheduler's 50/50 4n/8n behaviour). */
const FRESH_DURATIONS_BEATS: readonly number[] = [1, 0.5];

export class MelodyScheduler implements SubScheduler {
  private rng!: Rng;
  private emissionRng!: Rng;
  private nextQuarter = 1;
  private readonly secondsPerBeat: number;

  readonly template: Template;
  readonly germ: Germ;
  /** Rolling window of last N emitted notes (scale-degree-offset form).
   * Phase 2 Commit E will sample windows from this for the `buffer`
   * branch; for now it just accumulates. */
  private buffer: GermNote[] = [];
  private readonly bufferSize: number;

  private readonly activityStream: FbmParam;
  private readonly couplingStream: FbmParam;
  private readonly emissionWeights: number[];

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

    this.bufferSize = seed
      .child('melody-buffer-config')
      .rng()
      .nextInt(BUFFER_SIZE_MIN, BUFFER_SIZE_MAX);

    this.emissionWeights = perturbDirichlet(
      EMISSION_BASE_WEIGHTS,
      seed.child('melody-emission-config').rng(),
      EMISSION_DIRICHLET_ALPHA,
    );

    this.reset();
  }

  reset(): void {
    this.nextQuarter = 1;
    this.buffer = [];
    this.rng = this.seed.rng();
    this.emissionRng = this.seed.child('melody-emission').rng();
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    while (this.nextQuarter * this.secondsPerBeat < to) {
      const time = this.nextQuarter * this.secondsPerBeat;
      const effective = this.effectiveActivity(time);
      // Determinism discipline: always consume the fire + rule rolls
      // regardless of fire outcome; per-note velocity and fresh rolls
      // are only consumed inside the fire branch (their count varies
      // with fragment length so they can't be pre-rolled uniformly).
      const fireRoll = this.rng.nextFloat();
      const ruleRoll = this.emissionRng.nextFloat();
      if (fireRoll < effective) {
        const rule = this.pickRule(ruleRoll);
        const advanceBeats = this.emitFragment(events, time, rule);
        this.nextQuarter += Math.max(1, Math.ceil(advanceBeats));
      } else {
        this.nextQuarter++;
      }
    }
    return events;
  }

  /** F1 min-cap coupling. */
  private effectiveActivity(time: number): number {
    const melody = this.activityStream.evaluate(time);
    const chord = this.state.chordActivityStream.evaluate(time);
    const coupling = this.couplingStream.evaluate(time);
    return (1 - coupling) * melody + coupling * Math.min(melody, 1 - chord);
  }

  private pickRule(roll: number): EmissionRule {
    let acc = 0;
    for (let i = 0; i < EMISSION_RULES.length; i++) {
      acc += this.emissionWeights[i] ?? 0;
      if (roll < acc) return EMISSION_RULES[i] as EmissionRule;
    }
    return EMISSION_RULES[EMISSION_RULES.length - 1] as EmissionRule;
  }

  /** Emit a fragment starting at `time`. Returns the fragment's total
   * beat-length so the caller can advance `nextQuarter` past it. */
  private emitFragment(events: EngineEvent[], time: number, rule: EmissionRule): number {
    if (rule === 'fresh') {
      return this.emitFresh(events, time);
    }
    // germ / transform / buffer: all fall back to germ verbatim in
    // Commit D. Commit E will branch transform + buffer into real
    // transformations.
    return this.emitGerm(events, time, this.germ);
  }

  private emitGerm(events: EngineEvent[], startTime: number, source: Germ): number {
    let cursorBeats = 0;
    for (const note of source) {
      const noteTime = startTime + cursorBeats * this.secondsPerBeat;
      const pitch = this.pickGermPitch(note, noteTime);
      const durationMs = note.durationBeats * this.secondsPerBeat * 1000;
      const velocity = VEL_MIN + this.rng.nextFloat() * VEL_JITTER;
      events.push({
        kind: 'note',
        channel: Channels.RHODES_MELODY,
        pitch,
        velocity,
        durationMs,
        time: noteTime,
      });
      this.pushBuffer(note);
      cursorBeats += note.durationBeats;
    }
    return cursorBeats;
  }

  /** Single chord-aware note (the `fresh` branch). Rolls inside the
   * fire branch only — fresh-firing draws one duration roll and one
   * pitch-pick roll. */
  private emitFresh(events: EngineEvent[], time: number): number {
    const chord = this.state.currentChord;
    const dominantMode = dominantModeAtPosition(this.state.position.evaluate(time).x);
    const bag = modeMidiBag(dominantMode);
    const durationRoll = this.rng.nextFloat();
    const durationBeats = FRESH_DURATIONS_BEATS[
      Math.floor(durationRoll * FRESH_DURATIONS_BEATS.length)
    ] as number;
    const pitch = this.pickFreshPitch(chord, bag);
    const durationMs = durationBeats * this.secondsPerBeat * 1000;
    const velocity = VEL_MIN + this.rng.nextFloat() * VEL_JITTER;
    events.push({
      kind: 'note',
      channel: Channels.RHODES_MELODY,
      pitch,
      velocity,
      durationMs,
      time,
    });
    // Push the fresh note onto the buffer as a synthetic GermNote so
    // future buffer transformations can consume it. Approximate the
    // scale-degree offset by mapping the chosen pitch back to its
    // bag-index relative to anchor — good enough for buffer fragmenting.
    const bagIdx = bag.indexOf(pitch);
    const offset = bagIdx >= 0 ? bagIdx - GERM_ANCHOR_INDEX : 0;
    this.pushBuffer({ scaleDegreeOffset: offset, durationBeats });
    return durationBeats;
  }

  private pickGermPitch(note: GermNote, time: number): number {
    const dominantMode = dominantModeAtPosition(this.state.position.evaluate(time).x);
    const bag = modeMidiBag(dominantMode);
    const idx = clampInt(GERM_ANCHOR_INDEX + note.scaleDegreeOffset, 0, bag.length - 1);
    return bag[idx] as number;
  }

  /** Pre-Commit-C chord-aware single-pitch picker, lifted unchanged.
   * Chord tones always allowed; otherwise filter out half-step clashes.
   * Falls back to a chord tone projected into the melody register if
   * the scale fully clashes. */
  private pickFreshPitch(chord: ChordSymbol | null, bag: readonly number[]): number {
    if (!chord) return this.rng.pick(bag);
    const chordPcs = chordPitchClasses(chord);
    const chordPcSet = new Set(chordPcs);
    const allowed = bag.filter((p) => chordPcSet.has(p % 12) || !semitoneClash(p % 12, chordPcs));
    if (allowed.length > 0) return this.rng.pick(allowed);
    const fallback: number[] = [];
    for (const pc of chordPcs) {
      let p = pc;
      while (p < 69) p += 12;
      if (p <= 84) fallback.push(p);
    }
    return fallback.length > 0 ? this.rng.pick(fallback) : this.rng.pick(bag);
  }

  private pushBuffer(note: GermNote): void {
    this.buffer.push(note);
    while (this.buffer.length > this.bufferSize) this.buffer.shift();
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return Math.round(v);
}

function semitoneClash(pc: number, chordPcs: readonly number[]): boolean {
  for (const c of chordPcs) {
    const d = (((pc - c) % 12) + 12) % 12;
    if (d === 1 || d === 11) return true;
  }
  return false;
}
