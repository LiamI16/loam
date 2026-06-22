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
  pickCompoundSecond,
  STRUCTURAL_TRANSFORMATIONS,
  sampleBetaTwoFive,
  structuralWeights,
  type Template,
  TRANSFORMATION_BASE_WEIGHTS,
  TRANSFORMATION_DIRICHLET_ALPHA,
  TRANSFORMATIONS,
  type TransformationKind,
  transformGerm,
} from './melody/index.js';

/**
 * Germ-driven melody scheduler — Phases 1-3 complete (Commits B–H).
 *
 * Each firing emits a *multi-note fragment* (or a single chord-aware
 * note in the `fresh` case), not a single per-quarter note. At each
 * fragment-start opportunity the F1 min-cap coupling formula gates a
 * Bernoulli; on fire the four-way emission rule (germ / transform /
 * buffer / fresh) is rolled, the chosen transformation applied
 * (transform + buffer branches), and a Commit F compound 2-chain may
 * apply a second transformation with per-seed `pCompound` probability.
 *
 * Buffer rule is locked to the `fragment` transformation so recent
 * material reappears as short slices rather than full-length recurrences.
 * Retrograde is gated to structural moments (chord-slot boundaries via
 * `state.structuralMomentTimes`).
 *
 * `nextQuarter` advances past the fragment's tail so we don't double-
 * fire mid-phrase. Silence between fragments emerges naturally from
 * the activity gate.
 *
 * Seed children:
 *   - `melody-template-config` / `melody-template` / `melody-germ`     (Commit B)
 *   - `melody-activity-fbm` / `melody-activity-config`                 (Commit C)
 *   - `melody-chord-coupling-fbm` / `melody-chord-coupling-config`     (Commit C)
 *   - `melody-emission` / `melody-emission-config` /
 *     `melody-buffer-config`                                           (Commit D)
 *   - `melody-transformation` / `melody-transformation-config` /
 *     `melody-transformation-param`                                    (Commit E)
 *   - `melody-compound` / `melody-compound-config`                     (Commit F)
 *   - `melody-swing-config`                                            (Commit G)
 *   - `melody-jitter`                                                  (Commit H)
 *   - root `melody` stream: per-firing fireRoll + per-note velocity
 *                           + fresh-note rolls
 *
 * Timing layers on emission: each note's time is
 * `fragmentStart + cursorBeats · spq + swingOffset + jitter` —
 * fragmentStart from `nextQuarter`, swingOffset on 8n off-beats only
 * (per-seed, fixed), jitter uniform `±7ms` per-emission.
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

/** Per-seed compound 2-chain rate is `Beta(2, 5) · this_factor` per
 * `docs/melody.md` F2 (mean ~0.143, max ~0.5). Stable for the session. */
const COMPOUND_RATE_FACTOR = 0.5;

/** Per-seed swing ratio. Drawn from `uniform[SWING_MIN, SWING_MAX]` at
 * construction; fixed for the session per `docs/melody.md` F2 (swing
 * is a performance habit, not a creative free parameter — drift would
 * read as audible rhythm wobble).
 *
 * This is an **8n swing** — applied to off-beat 8th-note positions.
 * The 8n vs 16n distinction matters: 16n swing values (Dilla pocket
 * 0.58-0.62) translate to ~half-magnitude on 8n. The chosen range is
 * canonical *lofi* 8n swing — audible per-seed character without
 * crossing into jazz 8n territory (0.60+ on 8n reads as jazz piano).
 *
 * Range history: [0.50, 0.55] (Commit G — barely perceptible because
 * drums also swing at 0.55) → [0.50, 0.60] (briefly — too jazz-y) →
 * [0.50, 0.57] (current — lofi-canonical 8n swing, ~28 ms max offset
 * at BPM 74). */
const SWING_RATIO_MIN = 0.5;
const SWING_RATIO_MAX = 0.57;

/** Tolerance for detecting 8n off-beat positions in beat-space. Germ
 * durations are computed via simple multiplication so exact equality
 * to 0.5 fractional is fine, but allow a tiny epsilon for safety. */
const OFFBEAT_EPSILON = 1e-9;

/** Per-emission timing jitter (absolute, not percentage). Each emitted
 * note gets a uniform `[-JITTER_RANGE_MS, +JITTER_RANGE_MS]` ms offset
 * applied on top of any swing offset. Per `docs/melody.md` F2: jitter
 * is "humanization level, not swing level" — small enough that no
 * single emission's offset is *intentionally felt*, but enough to
 * lose the metronome-perfect quality across many emissions. 7 ms is
 * the midpoint of the spec'd 5–10 ms range. Drums don't actually
 * have a *timing* jitter analog (they have velocity jitter + fixed
 * per-voice offsets), so this is melody's own humanization layer. */
const JITTER_RANGE_MS = 7;
const JITTER_RANGE_SEC = JITTER_RANGE_MS / 1000;

export class MelodyScheduler implements SubScheduler {
  private rng!: Rng;
  private emissionRng!: Rng;
  private nextQuarter = 1;
  private readonly secondsPerBeat: number;

  readonly template: Template;
  readonly germ: Germ;
  /** Rolling window of last N emitted notes (scale-degree-offset form).
   * The `buffer` rule samples a recent slice and runs it through the
   * fragment transformation. */
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
  /** Per-seed compound-chain rate, fixed at construction. */
  private readonly pCompound: number;
  private compoundRng!: Rng;
  /** Per-seed swing offset in seconds — added to 8n off-beat melody
   * notes only. Zero on a perfectly-straight seed. */
  private readonly swingOffsetSec: number;
  /** Public for diagnostic tooling (`scripts/analyze-seed.ts`). */
  readonly swingRatio: number;
  /** Per-emission timing jitter rng. Drawn from `melody-jitter` seed
   * child so jitter doesn't perturb other rng streams' sequences. */
  private jitterRng!: Rng;

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

    this.pCompound =
      sampleBetaTwoFive(seed.child('melody-compound-config').rng()) * COMPOUND_RATE_FACTOR;

    // Swing is sampled once per seed and reused for the whole session.
    // The pre-computed offset is `(swing - 0.5) · eighth-duration` —
    // see `applyNoteSwing` for the per-note dispatch.
    this.swingRatio = seed
      .child('melody-swing-config')
      .rng()
      .nextRange(SWING_RATIO_MIN, SWING_RATIO_MAX);
    this.swingOffsetSec = (this.swingRatio - 0.5) * 0.5 * this.secondsPerBeat;

    this.reset();
  }

  reset(): void {
    this.nextQuarter = 1;
    this.buffer = [];
    this.rng = this.seed.rng();
    this.emissionRng = this.seed.child('melody-emission').rng();
    this.transformationRng = this.seed.child('melody-transformation').rng();
    this.transformationParamRng = this.seed.child('melody-transformation-param').rng();
    this.compoundRng = this.seed.child('melody-compound').rng();
    this.jitterRng = this.seed.child('melody-jitter').rng();
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
        // Always-consume both selection rolls (transform + compound)
        // inside the fire branch, even for germ/fresh rules that don't
        // chain anything — keeps determinism stable across rule
        // selection. Parameter rolls (incl. the second-transformation
        // selection roll, when compound fires) are consumed inside
        // the helpers as needed.
        const transformRoll = this.transformationRng.nextFloat();
        const compoundRoll = this.compoundRng.nextFloat();
        const advanceBeats = this.emitFragment(events, time, rule, transformRoll, compoundRoll);
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
    compoundRoll: number,
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
    let firstKind = transformKind;
    if (rule === 'buffer') {
      const window = this.bufferWindow();
      source = window.length >= 2 ? window : this.germ;
      firstKind = 'fragment';
    } else {
      source = this.germ;
    }
    let result = transformGerm(firstKind, source, this.transformationParamRng);

    // Commit F compound 2-chain: with per-seed `pCompound` probability,
    // pick a second transformation (excluding the first to avoid
    // degenerate same-kind chaining) and apply left-to-right. Second-
    // kind selection rolls from the compound stream so determinism
    // stays scoped. Retrograde joins the menu at structural moments
    // per `docs/melody.md` F2 ("Retrograde allowed in compound chains
    // at structural moments").
    if (compoundRoll < this.pCompound && result.length >= 2) {
      const secondKind = this.pickCompoundSecond(firstKind, time);
      result = transformGerm(secondKind, result, this.transformationParamRng);
    }

    return this.emitGerm(events, time, result);
  }

  private pickCompoundSecond(firstKind: TransformationKind, time: number): TransformationKind {
    const roll = this.compoundRng.nextFloat();
    if (this.isStructuralMoment(time)) {
      const weights = structuralWeights(this.transformationWeights);
      return pickCompoundSecond(STRUCTURAL_TRANSFORMATIONS, weights, firstKind, roll);
    }
    return pickCompoundSecond(TRANSFORMATIONS, this.transformationWeights, firstKind, roll);
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
      // Swing nudges 8n off-beats forward by the per-seed offset.
      // Fragment-start always lands on an integer beat (nextQuarter is
      // integer-valued), so the fractional position is just
      // cursorBeats mod 1. 8n off-beat ⇔ fractional == 0.5. Triplet
      // positions (1/3, 2/3) are unaffected, as intended for T7.
      const frac = cursorBeats - Math.floor(cursorBeats);
      const swing = Math.abs(frac - 0.5) < OFFBEAT_EPSILON ? this.swingOffsetSec : 0;
      const jitter = (this.jitterRng.nextFloat() * 2 - 1) * JITTER_RANGE_SEC;
      const noteTime = startTime + cursorBeats * this.secondsPerBeat + swing + jitter;
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
    // Per-emission timing jitter applied to fresh notes too, so they
    // don't sit metronome-perfect on the quarter while germ notes
    // around them are humanised.
    const jitter = (this.jitterRng.nextFloat() * 2 - 1) * JITTER_RANGE_SEC;
    events.push({
      kind: 'note',
      channel: Channels.RHODES_MELODY,
      pitch,
      velocity,
      durationMs,
      time: time + jitter,
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
