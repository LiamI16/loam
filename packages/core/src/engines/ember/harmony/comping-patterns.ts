import type { Rng } from '../../../rng/rng.js';
import { perturbDirichlet } from './dirichlet.js';

/**
 * Comping-pattern menu for the chord scheduler. Each pattern is a
 * declarative plan: given a slot length, return a `BarPlan` (list of
 * `HitSpec`s) for each bar in the slot. The scheduler interprets these
 * into `EngineEvent`s with the slot's archetype voicing applied at
 * each hit's specified thinness.
 *
 * Calm-lofi convention (Lofi Girl / chillhop / Idealism / Tomppabeats /
 * j'san reference) leans heavily on sustained holds with occasional
 * soft re-articulation; rhythmic comping (Nujabes / J Dilla flavor) is
 * a valid but rare mode. Base weights are calibrated accordingly —
 * `pure-hold` and `hold-with-refresh` dominate; `active-comping` is a
 * 5% accent. Per-seed Dirichlet perturbation (α=20) lets some seeds
 * lean more rhythmic without becoming categorically Nujabes.
 *
 * The fBm-driven `chord-activity` stream tilts the per-slot pattern
 * roll: in calm stretches (activity low) patterns are biased toward
 * `pure-hold`; in active stretches (activity high) patterns are biased
 * toward `light-comping` / `active-comping`. Tilt is gentle so seed
 * identity isn't washed out by the activity drift — see
 * `docs/seed-identity.md` §3 (couplings).
 */

export type SlotPattern =
  | 'pure-hold'
  | 'hold-with-refresh'
  | 'call-response'
  | 'light-comping'
  | 'active-comping';

export const SLOT_PATTERNS: readonly SlotPattern[] = [
  'pure-hold',
  'hold-with-refresh',
  'call-response',
  'light-comping',
  'active-comping',
];

/** Calm-lofi-anchored base weights, used for the *first* slot only
 * (no prior pattern). Dirichlet-perturbed per seed. After slot 0,
 * patterns are drawn from `PATTERN_TRANSITION_MATRIX` indexed by the
 * previous pattern (Markov walk). The base weights here match the
 * stationary distribution of the transition matrix so first-slot
 * behaviour is consistent with long-run behaviour. */
export const SLOT_PATTERN_BASE_WEIGHTS: readonly number[] = [0.55, 0.28, 0.1, 0.05, 0.02];

/**
 * Markov transition matrix on patterns. Rows are indexed by the
 * *current* pattern; each row is the probability distribution over
 * the *next* pattern. Constructed via detailed balance to make the
 * stationary distribution exactly equal `SLOT_PATTERN_BASE_WEIGHTS`,
 * so the long-run frequency of each pattern matches the calm-lofi
 * target without depending on the activity stream tilt to enforce it.
 *
 * Row order = `SLOT_PATTERNS` order = [PH, HwR, CR, LC, AC].
 *
 * Key properties:
 *   - **Calm gravity** (asymmetric): backward (toward calmer) transitions
 *     are more likely than forward (toward busier). Encodes genre bias
 *     at the architectural level.
 *   - **Endpoint stickiness**: PH self-loop is highest (0.785, dwell
 *     ~42 s at 74 BPM); CR is the lowest (0.478, ~17 s) — the middle
 *     pattern is transitional, not committed.
 *   - **AC exits broadly**: when active-comping ends, outflow is
 *     distributed evenly across the four other patterns. Avoids the
 *     "AC always decays to LC" artefact of forcing the AC dwell short
 *     via heavy AC↔LC coupling alone.
 *   - **AC dwell ~15 s, ~5 entries/hour**: brief Nujabes-flavoured
 *     bursts as a rare accent, not a sustained section.
 *
 * Verified via power-iteration of pi · P = pi during development.
 * Per-seed Dirichlet perturbation (α=20) keeps every seed close to
 * this matrix while letting some seeds drift slightly stickier or
 * looser.
 */
export const PATTERN_TRANSITION_MATRIX: ReadonlyArray<readonly number[]> = [
  // From pure-hold
  [0.785, 0.18, 0.025, 0.005, 0.005],
  // From hold-with-refresh
  [0.354, 0.54, 0.08, 0.015, 0.011],
  // From call-response
  [0.138, 0.224, 0.478, 0.13, 0.03],
  // From light-comping
  [0.055, 0.084, 0.26, 0.541, 0.06],
  // From active-comping
  [0.15, 0.15, 0.15, 0.15, 0.4],
];

/** Per-pattern activity score in [0, 1]. Tilting input for
 * `selectPattern`. Pure hold = 0 (lowest activity); active comping =
 * 1 (highest). */
export const PATTERN_ACTIVITY: Readonly<Record<SlotPattern, number>> = {
  'pure-hold': 0,
  'hold-with-refresh': 0.25,
  'call-response': 0.5,
  'light-comping': 0.75,
  'active-comping': 1,
};

/** Tilt strength used by `selectPattern`. Higher = stronger response
 * to the activity stream. K=3 gives a modest 2-3× weight ratio
 * between the extreme patterns at activity ∈ {0, 1}. */
const ACTIVITY_TILT_STRENGTH = 3;

/** Voicing thinness applied per hit. The scheduler's voicing helper
 * (`applyThinness`) interprets these. */
export type VoicingThinness = 'full' | 'rootless' | 'top-voices';

/** Velocity character per hit. The scheduler maps these to numeric
 * velocities (strong ≈ 0.55, soft ≈ 0.4) with the existing jitter. */
export type HitVelocity = 'strong' | 'soft';

/** A single chord articulation within a bar. */
export interface HitSpec {
  /** Beat position within the bar. 0 = beat 1; 2 = beat 3; 3.5 = and of 4. */
  readonly beatOffset: number;
  readonly velocity: HitVelocity;
  readonly thinness: VoicingThinness;
  /** Note-on duration in beats. Pattern-specific; sustained patterns
   * emit long durations on the slot-start hit so the chord rings
   * audibly for the whole slot. */
  readonly durationBeats: number;
}

/** Per-bar plan: 0..N hits for that bar. Empty array = sustain
 * (no new articulation; the prior bar's ringing hit carries the bar). */
export type BarPlan = readonly HitSpec[];

/**
 * Return the per-bar plan for a pattern over a slot of `slotBars`
 * bars. Length of the returned array equals `slotBars`.
 *
 * Patterns are deterministic — same `(pattern, slotBars)` always
 * returns the same plan. Bar-to-bar variation within a pattern is
 * baked into the plan, not rolled.
 */
export function planSlot(pattern: SlotPattern, slotBars: number): BarPlan[] {
  switch (pattern) {
    case 'pure-hold':
      return planPureHold(slotBars);
    case 'hold-with-refresh':
      return planHoldWithRefresh(slotBars);
    case 'call-response':
      return planCallResponse(slotBars);
    case 'light-comping':
      return planLightComping(slotBars);
    case 'active-comping':
      return planActiveComping(slotBars);
  }
}

/** Pure hold: one strong hit on bar 1 beat 1, ringing for the whole
 * slot. No further articulations. */
function planPureHold(slotBars: number): BarPlan[] {
  const plans: BarPlan[] = [];
  plans.push([
    {
      beatOffset: 0,
      velocity: 'strong',
      thinness: 'full',
      durationBeats: slotBars * 4 - 0.5,
    },
  ]);
  for (let i = 1; i < slotBars; i++) plans.push([]);
  return plans;
}

/** Hold + soft refresh: strong slot-start hit (long), alternating soft
 * taps at beat 3 of even bars and beat 1 of odd bars (relative to slot
 * start) keep the chord alive without re-asserting it. */
function planHoldWithRefresh(slotBars: number): BarPlan[] {
  const plans: BarPlan[] = [];
  plans.push([
    {
      beatOffset: 0,
      velocity: 'strong',
      thinness: 'full',
      durationBeats: slotBars * 4 - 0.5,
    },
  ]);
  for (let i = 1; i < slotBars; i++) {
    const beatOffset = i % 2 === 1 ? 2 : 0; // bar 2: beat 3; bar 3: beat 1; bar 4: beat 3
    plans.push([
      {
        beatOffset,
        velocity: 'soft',
        thinness: 'top-voices',
        durationBeats: 1.5,
      },
    ]);
  }
  return plans;
}

/** Call and response: every bar gets a strong call on beat 1 and a
 * soft thinned response on beat 3. Bar 1 of slot is the loudest; later
 * bars use soft-call to keep things from feeling re-asserted. */
function planCallResponse(slotBars: number): BarPlan[] {
  const plans: BarPlan[] = [];
  for (let i = 0; i < slotBars; i++) {
    const isFirst = i === 0;
    plans.push([
      {
        beatOffset: 0,
        velocity: isFirst ? 'strong' : 'soft',
        thinness: 'full',
        durationBeats: 1.5,
      },
      {
        beatOffset: 2,
        velocity: 'soft',
        thinness: 'top-voices',
        durationBeats: 1,
      },
    ]);
  }
  return plans;
}

/** Light comping: every bar beat 1; beat 3 on alternating bars. Halfway
 * between sustained and full comping — the calmest of the active modes. */
function planLightComping(slotBars: number): BarPlan[] {
  const plans: BarPlan[] = [];
  for (let i = 0; i < slotBars; i++) {
    const hits: HitSpec[] = [
      {
        beatOffset: 0,
        velocity: i === 0 ? 'strong' : 'soft',
        thinness: 'full',
        durationBeats: 1,
      },
    ];
    if (i % 2 === 0) {
      hits.push({
        beatOffset: 2,
        velocity: 'soft',
        thinness: 'rootless',
        durationBeats: 0.75,
      });
    }
    plans.push(hits);
  }
  return plans;
}

/** Active comping: every bar beat 1 + beat 3 at strong velocity. Nujabes-
 * style. Rare in calm-lofi (5% base weight) but valid as an accent
 * pattern. */
function planActiveComping(slotBars: number): BarPlan[] {
  const plans: BarPlan[] = [];
  for (let i = 0; i < slotBars; i++) {
    plans.push([
      {
        beatOffset: 0,
        velocity: 'strong',
        thinness: 'full',
        durationBeats: 1,
      },
      {
        beatOffset: 2,
        velocity: 'strong',
        thinness: 'full',
        durationBeats: 0.75,
      },
    ]);
  }
  return plans;
}

/**
 * Pick a pattern from `weights` tilted by `activityBias`. Used for the
 * first slot (no prior pattern) and as the underlying mechanism shared
 * with `selectNextPattern` (which delegates to this on a single row of
 * the transition matrix).
 *
 * Soft Boltzmann tilt: each pattern's weight is multiplied by
 * `exp(K · (activityBias − 0.5) · (PATTERN_ACTIVITY[p] − 0.5))`, then
 * renormalized. At `activityBias = 0.5` the tilt is the identity. At
 * extremes, low-activity patterns are favored when bias is low and
 * vice versa. K kept gentle (3) so per-seed Dirichlet shape still
 * dominates seed identity.
 */
export function selectPattern(
  weights: readonly number[],
  activityBias: number,
  rng: Rng,
): SlotPattern {
  if (weights.length !== SLOT_PATTERNS.length) {
    throw new Error(
      `selectPattern: expected ${SLOT_PATTERNS.length} weights, got ${weights.length}`,
    );
  }
  const tilted: number[] = [];
  let sum = 0;
  for (let i = 0; i < SLOT_PATTERNS.length; i++) {
    const p = SLOT_PATTERNS[i] as SlotPattern;
    const tilt = Math.exp(
      ACTIVITY_TILT_STRENGTH * (activityBias - 0.5) * (PATTERN_ACTIVITY[p] - 0.5),
    );
    const w = (weights[i] as number) * tilt;
    tilted.push(w);
    sum += w;
  }
  if (sum <= 0) return SLOT_PATTERNS[0] as SlotPattern;
  const roll = rng.nextFloat();
  let acc = 0;
  for (let i = 0; i < SLOT_PATTERNS.length; i++) {
    acc += (tilted[i] as number) / sum;
    if (roll < acc) return SLOT_PATTERNS[i] as SlotPattern;
  }
  return SLOT_PATTERNS[SLOT_PATTERNS.length - 1] as SlotPattern;
}

/**
 * Pick the next pattern given the current pattern via Markov walk on
 * `matrix`. The matrix's row for `currentPattern` is the weight vector;
 * activity tilt is applied identically to `selectPattern`. Per-seed
 * Dirichlet perturbation is applied to the matrix at construction
 * (see `perturbPatternMatrix`).
 */
export function selectNextPattern(
  matrix: ReadonlyArray<readonly number[]>,
  currentPattern: SlotPattern,
  activityBias: number,
  rng: Rng,
): SlotPattern {
  const rowIdx = SLOT_PATTERNS.indexOf(currentPattern);
  if (rowIdx < 0) {
    throw new Error(`selectNextPattern: unknown pattern ${currentPattern}`);
  }
  const row = matrix[rowIdx];
  if (row === undefined || row.length !== SLOT_PATTERNS.length) {
    throw new Error(`selectNextPattern: malformed matrix row at ${rowIdx}`);
  }
  return selectPattern(row, activityBias, rng);
}

/**
 * Per-seed Dirichlet perturbation of the pattern-transition matrix.
 * Each row is perturbed independently using the same `perturbDirichlet`
 * machinery as the chord Markov matrix; α=20 (mild) keeps every seed
 * close to the base matrix.
 */
export function perturbPatternMatrix(
  matrix: ReadonlyArray<readonly number[]>,
  rng: Rng,
  alpha: number,
): number[][] {
  const out: number[][] = [];
  for (const row of matrix) {
    out.push(perturbDirichlet(row, rng, alpha));
  }
  return out;
}
