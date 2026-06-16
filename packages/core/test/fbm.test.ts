import { describe, expect, it } from 'vitest';
import { Fbm1D, Seed } from '../src/index.js';

describe('Fbm1D', () => {
  it('same seed produces the same trajectory', () => {
    const a = new Fbm1D(Seed.from(42n));
    const b = new Fbm1D(Seed.from(42n));
    for (let i = 0; i < 20; i++) {
      const x = i * 0.13;
      expect(b.sample(x)).toBe(a.sample(x));
    }
  });

  it('output stays roughly in [-1, 1]', () => {
    const f = new Fbm1D(Seed.from(7n));
    for (let i = 0; i < 500; i++) {
      const x = i * 0.07 - 20;
      const v = f.sample(x);
      // fBm with normalized amplitudes — value-noise gradients in [-1,1]
      // can stack constructively. Allow a small overshoot for safety.
      expect(v).toBeGreaterThanOrEqual(-1.001);
      expect(v).toBeLessThanOrEqual(1.001);
    }
  });

  it('different octave counts produce different output but both bounded', () => {
    const f4 = new Fbm1D(Seed.from(7n), { octaves: 4 });
    const f6 = new Fbm1D(Seed.from(7n), { octaves: 6 });
    let diffs = 0;
    for (let i = 0; i < 100; i++) {
      const x = i * 0.25;
      if (Math.abs(f4.sample(x) - f6.sample(x)) > 1e-9) diffs++;
    }
    expect(diffs).toBeGreaterThan(50);
  });

  it('different seeds diverge', () => {
    const a = new Fbm1D(Seed.from(42n));
    const b = new Fbm1D(Seed.from(43n));
    let diffs = 0;
    for (let i = 0; i < 20; i++) {
      const x = i * 0.31;
      if (a.sample(x) !== b.sample(x)) diffs++;
    }
    expect(diffs).toBeGreaterThanOrEqual(18);
  });

  it('known-sequence determinism contract', () => {
    const f = new Fbm1D(Seed.from(42n));
    const got = [0, 1, 2, 3, 4, 5].map((x) => f.sample(x));
    // Locks fBm formula (octaves=4, persistence=0.5, lacunarity=2).
    expect(got).toEqual([
      -0.6256276866480772, 0.1682917648231669, -0.5326681724592737, -0.1747315901893653,
      -0.09854126073541301, -0.05884428952328027,
    ]);
  });
});
