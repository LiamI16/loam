import { describe, expect, it } from 'vitest';
import { Seed, ValueNoise1D } from '../src/index.js';

describe('ValueNoise1D', () => {
  it('same seed produces the same sample at the same x', () => {
    const a = new ValueNoise1D(Seed.from(42n));
    const b = new ValueNoise1D(Seed.from(42n));
    for (const x of [0, 1.5, -3.7, 100.25, -1000.5]) {
      expect(b.sample(x)).toBe(a.sample(x));
    }
  });

  it('different seeds diverge at the same x', () => {
    const a = new ValueNoise1D(Seed.from(42n));
    const b = new ValueNoise1D(Seed.from(43n));
    // Should differ at most positions — checking a handful
    let diffs = 0;
    for (const x of [1.2, 2.5, 3.8, 4.1, 5.9]) {
      if (a.sample(x) !== b.sample(x)) diffs++;
    }
    expect(diffs).toBeGreaterThanOrEqual(4);
  });

  it('output stays in [-1, 1]', () => {
    const n = new ValueNoise1D(Seed.from(7n));
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37 - 50;
      const v = n.sample(x);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is smooth — small dx → small dy', () => {
    const n = new ValueNoise1D(Seed.from(7n));
    let maxJump = 0;
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.01;
      const jump = Math.abs(n.sample(x + 0.01) - n.sample(x));
      if (jump > maxJump) maxJump = jump;
    }
    // For a 0.01 step, the value should never jump more than ~0.5 (it's
    // interpolated between gradients in [-1, 1] at integer spacings).
    expect(maxJump).toBeLessThan(0.5);
  });

  it('known-sequence determinism contract', () => {
    const n = new ValueNoise1D(Seed.from(42n));
    const got = [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5].map((x) => n.sample(x));
    // Locks the hashing + smoothstep formula. If this drifts, every
    // saved seed's fBm trajectory shifts. Treat any change as a v2 seed
    // format break.
    expect(got).toEqual([
      -0.6256276866480772, -0.3968769631952459, 0.106374628400983, 0.609626219997212,
      0.8383769434500432, -0.031471216359983956, -0.9013193761700111, -0.28959117184616423,
    ]);
  });
});
