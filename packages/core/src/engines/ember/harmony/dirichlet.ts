import type { Rng } from '../../../rng/rng.js';
import { CHORD_NAMES, type ChordName } from './chords.js';
import type { TransitionMatrix, TransitionRow } from './markov.js';

/**
 * Deterministic per-seed perturbation of a Markov transition matrix.
 *
 * For each row, the new probabilities are drawn from a Dirichlet
 * distribution `Dir(α · p_1, …, α · p_K)` where `p_i` are the hand-tuned
 * weights (normalized) and `α` is the concentration knob:
 *
 *   - High α (e.g. 50–100): rows barely move from the prior; seeds feel
 *     similar harmonically.
 *   - Low α (e.g. 1–5): rows scatter widely; seeds feel like different
 *     pieces.
 *   - Stage-6 default α = 20 (a "subtle but audible" middle ground
 *     mirroring the Stage-5 liveliness ranges; tune by listening test).
 *
 * Implementation: Dirichlet via normalized independent Gamma draws.
 *   - Gamma(α, 1) for α ≥ 1: Marsaglia & Tsang (2000) — rejection
 *     using a transformed standard-normal proposal. ~1 normal + 1
 *     uniform per accepted draw on average; well-behaved.
 *   - Gamma(α, 1) for α < 1: Gamma(α, 1) = Gamma(α+1, 1) · U^(1/α)
 *     (Stuart's reduction).
 *   - Standard normals: Box–Muller from two uniforms (only one normal
 *     is used per call, but Box–Muller produces them in pairs cheaply).
 *
 * All randomness comes from the passed `Rng`, so the perturbed matrix
 * is fully seed-deterministic. Locked-sequence test in `dirichlet.test.ts`.
 */

export interface DirichletOptions {
  /** Concentration parameter. Higher = closer to the prior. */
  alpha: number;
}

export function perturbMatrix(
  base: TransitionMatrix,
  rng: Rng,
  opts: DirichletOptions,
): TransitionMatrix {
  const out: Partial<Record<ChordName, TransitionRow>> = {};
  for (const from of CHORD_NAMES) {
    out[from] = perturbRow(base[from], rng, opts.alpha);
  }
  return out as TransitionMatrix;
}

function perturbRow(row: TransitionRow, rng: Rng, alpha: number): TransitionRow {
  const entries = Object.entries(row) as [ChordName, number][];
  // Normalize prior so α applies to a true probability distribution.
  const priorTotal = entries.reduce((s, [, w]) => s + w, 0);
  if (priorTotal <= 0) return {};
  const draws: [ChordName, number][] = [];
  let sum = 0;
  for (const [name, w] of entries) {
    const a = alpha * (w / priorTotal);
    const g = sampleGamma(a, rng);
    draws.push([name, g]);
    sum += g;
  }
  const out: TransitionRow = {};
  if (sum <= 0) {
    // Fallback: collapse to prior. Astronomically unlikely with α ≥ 1.
    for (const [name, w] of entries) out[name] = w / priorTotal;
    return out;
  }
  for (const [name, g] of draws) out[name] = g / sum;
  return out;
}

/** Standard normal via Box–Muller. One uniform pair → one normal. */
function sampleStandardNormal(rng: Rng): number {
  // Avoid log(0).
  let u1 = rng.nextFloat();
  if (u1 < 1e-300) u1 = 1e-300;
  const u2 = rng.nextFloat();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Gamma(shape, 1). Shape α can be < 1 or ≥ 1. */
function sampleGamma(alpha: number, rng: Rng): number {
  if (alpha < 1) {
    // Stuart's reduction: Gamma(α) = Gamma(α + 1) · U^(1/α).
    const g = sampleGammaAtLeastOne(alpha + 1, rng);
    let u = rng.nextFloat();
    if (u < 1e-300) u = 1e-300;
    return g * u ** (1 / alpha);
  }
  return sampleGammaAtLeastOne(alpha, rng);
}

/** Marsaglia–Tsang for α ≥ 1. */
function sampleGammaAtLeastOne(alpha: number, rng: Rng): number {
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 256; i++) {
    let x: number;
    let v: number;
    do {
      x = sampleStandardNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.nextFloat();
    const x2 = x * x;
    if (u < 1 - 0.0331 * x2 * x2) return d * v;
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v;
  }
  // Safety: extremely unlikely to reach (acceptance > 95% per iter).
  return d;
}
