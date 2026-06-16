import { describe, expect, it } from 'vitest';
import { Fbm1D, FbmParam, Seed, StaticParam } from '../src/index.js';

describe('StaticParam', () => {
  it('returns its value regardless of time', () => {
    const p = new StaticParam(0.42);
    expect(p.evaluate(0)).toBe(0.42);
    expect(p.evaluate(100)).toBe(0.42);
    expect(p.evaluate(-50)).toBe(0.42);
  });

  it('value is mutable', () => {
    const p = new StaticParam(0.1);
    p.value = 0.9;
    expect(p.evaluate(0)).toBe(0.9);
  });
});

describe('FbmParam', () => {
  const makeFbm = (seedNum: bigint) => new Fbm1D(Seed.from(seedNum));

  it('output stays in [mean - depth, mean + depth] for unbounded params', () => {
    const p = new FbmParam(makeFbm(42n), {
      mean: 0.5,
      depth: 0.2,
      baseFreq: 0.1,
    });
    for (let t = 0; t < 200; t++) {
      const v = p.evaluate(t);
      // Allow tiny overshoot for fBm normalization edge cases.
      expect(v).toBeGreaterThanOrEqual(0.5 - 0.2 - 0.001);
      expect(v).toBeLessThanOrEqual(0.5 + 0.2 + 0.001);
    }
  });

  it('respects min/max clamps', () => {
    const p = new FbmParam(makeFbm(42n), {
      mean: 0.5,
      depth: 10, // would otherwise blow past [0, 1]
      baseFreq: 0.1,
      minValue: 0,
      maxValue: 1,
    });
    for (let t = 0; t < 100; t++) {
      const v = p.evaluate(t * 0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('mean is mutable and shifts the centerpoint', () => {
    const p = new FbmParam(makeFbm(42n), {
      mean: 0.5,
      depth: 0.1,
      baseFreq: 0.1,
    });
    const v1 = p.evaluate(5);
    p.mean = 0.5 + 0.3;
    const v2 = p.evaluate(5);
    expect(v2 - v1).toBeCloseTo(0.3, 6);
  });

  it('same seed produces the same trajectory', () => {
    const a = new FbmParam(makeFbm(42n), { mean: 0, depth: 1, baseFreq: 0.1 });
    const b = new FbmParam(makeFbm(42n), { mean: 0, depth: 1, baseFreq: 0.1 });
    for (let t = 0; t < 50; t++) {
      expect(b.evaluate(t)).toBe(a.evaluate(t));
    }
  });
});
