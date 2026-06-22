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
import {
  type Germ,
  type GermNote,
  generateGerm,
  STRUCTURAL_TRANSFORMATIONS,
  structuralWeights,
  type Template,
  TRANSFORMATION_BASE_WEIGHTS,
  TRANSFORMATION_DIRICHLET_ALPHA,
  TRANSFORMATIONS,
  type TransformationKind,
  transformGerm,
} from './melody/index.js';

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

/** Mean per-quarter fire probability. Re-tuned post-Commit-E ear test
 * (seed 42 / "main melody firing so often"): the original 0.35 mean
 * was inherited from the chord-activity stream, where each "fire" is a
 * pattern hit — but melody fires are now multi-note fragments, so the
 * effective note density is 3-5× higher than the chord layer. Pulled
 * down to 0.22 — slightly above the pre-rewrite density default of
 * 0.18 to acknowledge that fragments are richer events than the old
 * one-note pings, but not so high that the melody feels constantly
 * speaking. Range tightened to [0.08, 0.50] for the same reason —
 * caps busy seeds at moderate-activity, not high-activity. */
const MELODY_ACTIVITY_MEAN = 0.22;
const MELODY_ACTIVITY_MIN = 0.08;
const MELODY_ACTIVITY_MAX = 0.5;
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

/** Base weights for the four-way rule. Re-tuned post-Commit-E ear test
 * (seed 42 / T10 arpeggio): verbatim germ at 0.35 was making the
 * underlying shape too identifiable across repetitions, even with
 * transformations in the mix. Cut to 0.25; transform absorbs the
 * delta to 0.40 so shape-disguising routings dominate. Per-seed
 * Dirichlet α=20 nudges each seed away from the central tendency. */
const EMISSION_BASE_WEIGHTS: readonly number[] = [0.25, 0.4, 0.2, 0.15];

const EMISSION_DIRICHLET_ALPHA = 20;

/** Fresh-note duration choices (matches the pre-Commit-C melody
 * scheduler's 50/50 4n/8n behaviour). */
const FRESH_DURATIONS_BEATS: readonly number[] = [1, 0.5];

/** A fragment-start is "structural" if it falls within this many beats
 * of any chord-slot boundary in `state.structuralMomentTimes`. Half a
 * quarter is loose enough to catch fragments anchored to chord changes
 * without dragging in mid-slot firings. */
const STRUCTURAL_PROXIMITY_BEATS = 0.5;

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
  /** Per-seed Dirichlet-perturbed transformation weights (non-structural
   * six). Structural-moment weights (seven, retrograde appended) are
   * derived at use-time from these. */
  private readonly transformationWeights: number[];
  private transformationRng!: Rng;
  private transformationParamRng!: Rng;

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

    this.transformationWeights = perturbDirichlet(
      TRANSFORMATION_BASE_WEIGHTS,
      seed.child('melody-transformation-config').rng(),
      TRANSFORMATION_DIRICHLET_ALPHA,
    );

    this.reset();
  }

  reset(): void {
    this.nextQuarter = 1;
    this.buffer = [];
    this.rng = this.seed.rng();
    this.emissionRng = this.seed.child('melody-emission').rng();
    this.transformationRng = this.seed.child('melody-transformation').rng();
    this.transformationParamRng = this.seed.child('melody-transformation-param').rng();
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
        // Always-consume the transformation selection roll inside the
        // fire branch, even for germ/fresh rules that don't apply a
        // transformation — keeps determinism stable across rule
        // selection. Parameter rolls are consumed inside the transform
        // helpers as needed.
        const transformRoll = this.transformationRng.nextFloat();
        const advanceBeats = this.emitFragment(events, time, rule, transformRoll);
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
   * beat-length so the caller can advance `nextQuarter` past it.
   *
   * Rule routing:
   *   germ      → germ verbatim
   *   transform → `transformGerm(kind, germ, param-rng)`
   *   buffer    → `transformGerm(kind, buffer-window, param-rng)`,
   *               or germ verbatim if buffer too short
   *   fresh     → single chord-aware pitch
   *
   * At structural moments (fragment-start within
   * `STRUCTURAL_PROXIMITY_BEATS` of any `state.structuralMomentTimes`
   * entry), retrograde is added to the transformation menu at its
   * fixed structural weight. */
  private emitFragment(
    events: EngineEvent[],
    time: number,
    rule: EmissionRule,
    transformRoll: number,
  ): number {
    if (rule === 'fresh') {
      return this.emitFresh(events, time);
    }
    if (rule === 'germ') {
      return this.emitGerm(events, time, this.germ);
    }
    // transform / buffer: pick transformation, apply, emit.
    // Buffer rule is *locked* to the fragment transformation — its job
    // is to ensure recent material reappears as **short slices** rather
    // than full-length recurrences (which would just re-state the germ
    // shape). transformRoll is still consumed for determinism stability;
    // its outcome is overridden for the buffer branch.
    const transformKind = this.pickTransformation(transformRoll, time);
    let source: Germ;
    let kind = transformKind;
    if (rule === 'buffer') {
      const window = this.bufferWindow();
      source = window.length >= 2 ? window : this.germ;
      kind = 'fragment';
    } else {
      source = this.germ;
    }
    const transformed = transformGerm(kind, source, this.transformationParamRng);
    return this.emitGerm(events, time, transformed);
  }

  /** Pick a transformation from per-seed Dirichlet weights. At
   * structural moments the menu includes retrograde at the fixed
   * structural weight; elsewhere the six-item menu is used. */
  private pickTransformation(roll: number, time: number): TransformationKind {
    if (this.isStructuralMoment(time)) {
      const weights = structuralWeights(this.transformationWeights);
      return selectKind(STRUCTURAL_TRANSFORMATIONS, weights, roll);
    }
    return selectKind(TRANSFORMATIONS, this.transformationWeights, roll);
  }

  private isStructuralMoment(time: number): boolean {
    const proximity = STRUCTURAL_PROXIMITY_BEATS * this.secondsPerBeat;
    for (const t of this.state.structuralMomentTimes) {
      if (Math.abs(t - time) <= proximity) return true;
    }
    return false;
  }

  /** Take the most-recent window of buffer notes, length capped at the
   * germ's length so transformed fragments stay phrase-shaped. */
  private bufferWindow(): Germ {
    const len = Math.min(this.germ.length, this.buffer.length);
    if (len === 0) return [];
    return this.buffer.slice(this.buffer.length - len);
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

function selectKind<T>(items: readonly T[], weights: readonly number[], roll: number): T {
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weights[i] ?? 0;
    if (roll < acc) return items[i] as T;
  }
  return items[items.length - 1] as T;
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
