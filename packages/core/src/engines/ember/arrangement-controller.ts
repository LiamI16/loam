import { Fbm1D } from '../../noise/fbm.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState } from './ember.js';

/**
 * Arrangement controller — the layer that makes the engine *breathe*
 * (docs/arrangement.md). Instead of every instrument playing forever, a
 * per-seed Markov walk over a curated palette of arrangement states mutes
 * and unmutes whole instrument roles at 8-bar phrase boundaries. Pad (+
 * brown bed + crackle) is the always-on floor; bass / chords / melody /
 * drums are arrangement-controlled.
 *
 * Design (settled, decisions A–F + numerics in docs/arrangement.md):
 *   - 8 discrete states, single-instrument adjacency (verified connected).
 *   - Per-seed identity = a presence-bias vector reweighting the base
 *     stationary π; the transition matrix is then built by
 *     **Metropolis-Hastings** so its stationary is *exactly* that biased π'
 *     (no Dirichlet-on-matrix — that would drift the stationary; see the
 *     doc's "No Dirichlet-on-matrix layer").
 *   - Per-seed laziness λ lengthens dwell without changing the stationary.
 *   - A slow universal energy-contour fBm tilts each phrase's transition
 *     row toward a target fullness (Boltzmann tilt, same shape as
 *     `selectPattern`), so departures below FULL feel *motivated*.
 *
 * Fingerprint-safe (decision F): every seed **opens at FULL** (phrase 0),
 * all seed children are named/independent, and a FULL mask is a no-op for
 * the composition-point filter — so the 5 s `Seed.from(42n)` window is
 * byte-identical. Arrangement is a non-breaking additive change.
 */

export type Role = 'bass' | 'chords' | 'melody' | 'drums';

/** Bit order for every state's `bits` tuple: (bass, chords, melody, drums);
 * pad is implicit-always and not represented. */
export const ROLES: readonly Role[] = ['bass', 'chords', 'melody', 'drums'];

/** A phrase's active-role set. Readonly — consumers only test membership. */
export type ArrangementMask = ReadonlySet<Role>;

export interface ArrangementStateDef {
  readonly name: string;
  /** (bass, chords, melody, drums), 1 = active. */
  readonly bits: readonly [number, number, number, number];
  /** Active-instrument count / 4 — the energy-tilt input. */
  readonly fullness: number;
  /** Base stationary weight [taste] before per-seed presence bias. */
  readonly basePi: number;
}

/** The 8-state palette (docs/arrangement.md "States, fullness, base weights").
 * Index order is load-bearing: it matches ADJACENCY. */
export const STATES: readonly ArrangementStateDef[] = [
  { name: 'FULL', bits: [1, 1, 1, 1], fullness: 1.0, basePi: 0.3 },
  { name: 'no-melody', bits: [1, 1, 0, 1], fullness: 0.75, basePi: 0.14 },
  { name: 'drums-out', bits: [1, 1, 1, 0], fullness: 0.75, basePi: 0.14 },
  { name: 'pocket', bits: [1, 0, 0, 1], fullness: 0.5, basePi: 0.1 },
  { name: 'warm', bits: [1, 1, 0, 0], fullness: 0.5, basePi: 0.1 },
  { name: 'bass-breather', bits: [1, 0, 0, 0], fullness: 0.25, basePi: 0.09 },
  { name: 'lead-breather', bits: [0, 0, 1, 0], fullness: 0.25, basePi: 0.08 },
  { name: 'deep-breather', bits: [0, 0, 0, 0], fullness: 0.0, basePi: 0.05 },
];

/** Single-instrument-move adjacency (docs/arrangement.md; verified
 * connected). Row i lists the state indices reachable from state i. */
export const ADJACENCY: readonly (readonly number[])[] = [
  [1, 2], // FULL
  [0, 3, 4], // no-melody
  [0, 4], // drums-out
  [1, 5], // pocket
  [1, 2, 5], // warm
  [3, 4, 7], // bass-breather
  [7], // lead-breather
  [5, 6], // deep-breather
];

/** Grid: every mute/unmute lands on an 8-bar hypermetric downbeat
 * (decision B). Fixed, not per-seed. */
export const PHRASE_BARS = 8;

// ── Per-seed axis ranges (validated 2026-07-09; see doc "Validation
//    results"). Re-check with scripts/arrangement-validate.ts if touched. ──

/** Presence-bias half-width (multiplicative, symmetric in log). M=1.6
 * chosen by sweep: ~40 % more cross-seed spread than 1.4 while staying
 * clear of the M≥1.8 "half-time-in-one-state" degeneracy. */
const PRESENCE_BIAS_M = 1.6;
/** Melody uses a smaller downside (floor ≈ 0.83) — signature-protect
 * guardrail: never systematically hide the germ. */
const MELODY_BIAS_U_LO = -0.4;

/** Laziness λ range → dwell ≈ 65 s … 4 min (restless → stable seed). */
const LAMBDA_LO = 0.5;
const LAMBDA_HI = 0.86;

/** Energy-contour fBm: slowest octave ~4 min. Universal range — only the
 * per-seed *phase* differs (C.3: contour is timing, not per-seed amount). */
const ENERGY_BASE_FREQ = 1 / 240;
/** Boltzmann tilt strength toward the contour's target fullness. Gentle
 * (cf. chord-comping K=3) [taste]. */
const ENERGY_TILT_K = 2;

/**
 * Depth coupling (mild, §3): busy seeds hug fuller. Deliberately weak and
 * shipped at 0 for v1 (the doc allows k=0; the melody-activity mean it
 * would read isn't plumbed into the controller). Kept as a named dial so a
 * later refinement can wire it. [taste]
 */
const DEPTH_COUPLING_K = 0;

/** Build a mask (active-role set) from a state's bits. */
function maskFromBits(bits: readonly [number, number, number, number]): ArrangementMask {
  const set = new Set<Role>();
  for (let i = 0; i < ROLES.length; i++) {
    if (bits[i]) set.add(ROLES[i] as Role);
  }
  return set;
}

const STATE_MASKS: readonly ArrangementMask[] = STATES.map((s) => maskFromBits(s.bits));

/** The FULL mask (all roles) — the always-open default. */
export const FULL_MASK: ArrangementMask = STATE_MASKS[0] as ArrangementMask;

/**
 * Per-seed presence-bias vector `b = (bass, chords, melody, drums)`. Each
 * component drawn log-uniform, multiplicatively symmetric around 1.0:
 * `b = exp(u·ln M)`, `u ~ uniform[−1, 1]` (melody uses `[−0.4, 1]`). Applied
 * as a *soft reweight* of π, never a clamp — every state stays reachable.
 */
export function drawPresenceBias(seed: Seed): number[] {
  const rng = seed.child('arrangement-presence-bias').rng();
  const lnM = Math.log(PRESENCE_BIAS_M);
  return ROLES.map((_, i) => {
    const u = i === 2 ? rng.nextRange(MELODY_BIAS_U_LO, 1) : rng.nextRange(-1, 1);
    return Math.exp(u * lnM);
  });
}

/**
 * Presence-biased stationary π': `π'_s = π_s · Π_{inst active in s} b_inst`,
 * renormalised. This is carried *exactly* into the transition matrix by MH,
 * so it is each seed's exact long-run time-distribution over states.
 */
export function biasedStationary(bias: readonly number[]): number[] {
  const raw = STATES.map((s) => {
    let w = s.basePi;
    for (let i = 0; i < ROLES.length; i++) if (s.bits[i]) w *= bias[i] as number;
    return w;
  });
  const sum = raw.reduce((a, c) => a + c, 0);
  return raw.map((w) => w / sum);
}

/**
 * Metropolis-Hastings transition matrix on the adjacency graph whose
 * stationary distribution is exactly `pi` (detailed balance by
 * construction — no hand-tuned 8×8, no power-iteration needed):
 *   proposal q_ij = 1/deg(i); acceptance a_ij = min(1, (π_j·deg(i))/(π_i·deg(j)));
 *   P_ij = q_ij·a_ij (j≠i); P_ii = 1 − Σ_{j≠i} P_ij.
 */
export function buildMHMatrix(pi: readonly number[]): number[][] {
  const n = STATES.length;
  const P: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const neighbours = ADJACENCY[i] as readonly number[];
    const degI = neighbours.length;
    let off = 0;
    for (const j of neighbours) {
      const degJ = (ADJACENCY[j] as readonly number[]).length;
      const a = Math.min(1, ((pi[j] as number) * degI) / ((pi[i] as number) * degJ));
      const p = (1 / degI) * a;
      (P[i] as number[])[j] = p;
      off += p;
    }
    (P[i] as number[])[i] = 1 - off;
  }
  return P;
}

/** Per-seed laziness: `P' = λ·I + (1−λ)·P`. Same stationary π, longer dwell.
 * Dwell in state i = 1/((1−λ)(1−P_ii)). */
export function applyLaziness(P: readonly (readonly number[])[], lambda: number): number[][] {
  return P.map((row, i) =>
    row.map((p, j) => (i === j ? lambda + (1 - lambda) * p : (1 - lambda) * p)),
  );
}

/** Power-iteration stationary of a row-stochastic matrix (test / diagnostic
 * helper; the runtime walk never needs it — MH gives the stationary for
 * free). */
export function powerIterationStationary(P: readonly (readonly number[])[]): number[] {
  const n = P.length;
  let x = new Array<number>(n).fill(1 / n);
  for (let it = 0; it < 8000; it++) {
    const y = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        y[j] = (y[j] as number) + (x[i] as number) * ((P[i] as readonly number[])[j] as number);
      }
    }
    x = y;
  }
  return x;
}

export class ArrangementController {
  private readonly matrix: number[][];
  private readonly energyFbm: Fbm1D;
  private readonly energyPhase: number;
  private readonly barDuration: number;
  private readonly phraseDuration: number;
  private walkRng: ReturnType<Seed['rng']>;

  /** Cached per-phrase state indices, computed lazily in order. Phrase 0 is
   * always FULL (index 0) — the fingerprint-preserving open. */
  private readonly phraseStates: number[] = [0];

  constructor(
    private readonly seed: Seed,
    private readonly state: EngineState,
    secondsPerBeat: number,
  ) {
    this.barDuration = 4 * secondsPerBeat;
    this.phraseDuration = PHRASE_BARS * this.barDuration;

    const bias = drawPresenceBias(seed);
    const pi = biasedStationary(bias);
    const lambda = seed.child('arrangement-frequency').rng().nextRange(LAMBDA_LO, LAMBDA_HI);
    this.matrix = applyLaziness(buildMHMatrix(pi), lambda);

    // Energy contour: one universal fBm (per-seed identity = phase only).
    this.energyFbm = new Fbm1D(seed.child('arrangement-energy-fbm'));
    this.energyPhase = seed.child('arrangement-energy-config').rng().nextRange(0, 10000);

    this.walkRng = seed.child('arrangement-walk').rng();

    // Wire the query into shared state; schedulers read it per emission.
    state.arrangementMaskAt = (t: number) => this.maskAt(t);
    state.phraseBar = 0;
  }

  /** Runs first in `EmberEngine.scheduleUntil`. Maintains the phrase-bar
   * clock and pre-warms phrase decisions up to `engineUntil` (so the mask
   * query never lazily computes a walk step out of RNG order). */
  advance(_engineFrom: number, engineUntil: number): void {
    const k = Math.max(0, Math.floor(engineUntil / this.phraseDuration));
    this.ensurePhrase(k);
    this.state.phraseBar = Math.floor(engineUntil / this.barDuration) % PHRASE_BARS;
  }

  /** Active-role mask at engine-time `time`. Phrase-accurate regardless of
   * call order (decisions are cached by phrase index, computed once each). */
  maskAt(time: number): ArrangementMask {
    const k = time <= 0 ? 0 : Math.floor(time / this.phraseDuration);
    this.ensurePhrase(k);
    return STATE_MASKS[this.phraseStates[k] as number] as ArrangementMask;
  }

  reset(): void {
    this.phraseStates.length = 1;
    this.phraseStates[0] = 0;
    this.state.phraseBar = 0;
    // Re-derive the walk stream from scratch so reset() replays identically.
    this.walkRng = this.seed.child('arrangement-walk').rng();
  }

  /** Extend the cached phrase-state list up to and including index `k`,
   * walking one transition per new phrase (each consumes exactly one roll
   * from `walkRng`, in order). */
  private ensurePhrase(k: number): void {
    while (this.phraseStates.length <= k) {
      const idx = this.phraseStates.length;
      const prev = this.phraseStates[idx - 1] as number;
      const boundaryTime = idx * this.phraseDuration;
      this.phraseStates.push(this.walkNext(prev, boundaryTime));
    }
  }

  /** Sample the next state from the current transition row, tilted toward
   * the energy contour's target fullness at `boundaryTime`. */
  private walkNext(current: number, boundaryTime: number): number {
    const target = this.energyTarget(boundaryTime);
    const row = this.matrix[current] as number[];
    const tilted: number[] = new Array(row.length).fill(0);
    let sum = 0;
    for (let j = 0; j < row.length; j++) {
      const p = row[j] as number;
      if (p <= 0) continue;
      const fullness = (STATES[j] as ArrangementStateDef).fullness;
      const w = p * Math.exp(-ENERGY_TILT_K * Math.abs(fullness - target));
      tilted[j] = w;
      sum += w;
    }
    if (sum <= 0) return current;
    const roll = this.walkRng.nextFloat();
    let acc = 0;
    for (let j = 0; j < tilted.length; j++) {
      acc += (tilted[j] as number) / sum;
      if (roll < acc) return j;
    }
    return current;
  }

  /** Map the slow energy fBm → target fullness ∈ [0, 1]. */
  private energyTarget(time: number): number {
    const noise = this.energyFbm.sample((time + this.energyPhase) * ENERGY_BASE_FREQ);
    let target = 0.5 + 0.5 * noise;
    // Depth coupling (mild, §3) — k=0 for v1; see DEPTH_COUPLING_K.
    target += DEPTH_COUPLING_K;
    return target < 0 ? 0 : target > 1 ? 1 : target;
  }
}
