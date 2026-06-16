import { describe, expect, it } from 'vitest';
import {
  type ChordName,
  HAND_MATRIX,
  perturbMatrix,
  Seed,
  type TransitionMatrix,
} from '../src/index.js';

describe('perturbMatrix (Dirichlet)', () => {
  it('same seed produces identical perturbation', () => {
    const a = perturbMatrix(HAND_MATRIX, Seed.from(42n).child('harmony/markov-config').rng(), {
      alpha: 20,
    });
    const b = perturbMatrix(HAND_MATRIX, Seed.from(42n).child('harmony/markov-config').rng(), {
      alpha: 20,
    });
    expect(b).toEqual(a);
  });

  it('rows sum to ~1', () => {
    const m = perturbMatrix(HAND_MATRIX, Seed.from(7n).child('harmony/markov-config').rng(), {
      alpha: 20,
    });
    for (const from of Object.keys(m) as ChordName[]) {
      const total = Object.values(m[from]).reduce((s, v) => s + (v ?? 0), 0);
      expect(total).toBeGreaterThan(0.999);
      expect(total).toBeLessThan(1.001);
    }
  });

  it('preserves the support of the prior (no new edges)', () => {
    const m = perturbMatrix(HAND_MATRIX, Seed.from(7n).child('harmony/markov-config').rng(), {
      alpha: 20,
    });
    for (const from of Object.keys(m) as ChordName[]) {
      const priorKeys = new Set(Object.keys(HAND_MATRIX[from]));
      for (const to of Object.keys(m[from])) {
        expect(priorKeys.has(to)).toBe(true);
      }
    }
  });

  it('higher alpha stays closer to the prior than lower alpha', () => {
    // Crude check: total L1 distance from the (normalized) prior shrinks as
    // alpha grows. Compares two seeds at α=5 vs α=200.
    const rngLo = Seed.from(123n).child('cfg').rng();
    const rngHi = Seed.from(123n).child('cfg').rng();
    const lo = perturbMatrix(HAND_MATRIX, rngLo, { alpha: 5 });
    const hi = perturbMatrix(HAND_MATRIX, rngHi, { alpha: 200 });
    expect(rowDistance(hi, HAND_MATRIX)).toBeLessThan(rowDistance(lo, HAND_MATRIX));
  });

  it('determinism contract — locked Am7 row at Seed.from(42n), alpha=20', () => {
    // Locks: gamma sampler + Box–Muller + Dirichlet ratio formula. A failure
    // here with the Markov + PRNG contracts intact means the sampling math
    // changed.
    const m = perturbMatrix(HAND_MATRIX, Seed.from(42n).child('harmony/markov-config').rng(), {
      alpha: 20,
    });
    const row = m.Am7;
    const formatted: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      formatted[k] = (v ?? 0).toFixed(6);
    }
    expect(formatted).toEqual({
      Dm7: '0.197449',
      Fmaj7: '0.341797',
      Cmaj7: '0.179877',
      Em7: '0.071871',
      Am9: '0.056802',
      Am11: '0.018732',
      G7: '0.057016',
      Bbmaj7: '0.076455',
    });
  });
});

function rowDistance(m: TransitionMatrix, prior: TransitionMatrix): number {
  let total = 0;
  for (const from of Object.keys(m) as ChordName[]) {
    const priorRow = prior[from];
    const priorTotal = Object.values(priorRow).reduce((s, v) => s + (v ?? 0), 0);
    for (const to of Object.keys(priorRow) as ChordName[]) {
      const priorP = (priorRow[to] ?? 0) / priorTotal;
      const postP = m[from][to] ?? 0;
      total += Math.abs(postP - priorP);
    }
  }
  return total;
}
