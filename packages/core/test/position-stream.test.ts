import { describe, expect, it } from 'vitest';
import { PositionStream, Seed } from '../src/index.js';

describe('PositionStream', () => {
  it('produces both coords in roughly [-1, 1]', () => {
    const ps = new PositionStream(Seed.from(42n), { baseFreq: 0.002 });
    for (let i = 0; i < 200; i++) {
      const { x, y } = ps.evaluate(i * 5);
      expect(x).toBeGreaterThanOrEqual(-1.05);
      expect(x).toBeLessThanOrEqual(1.05);
      expect(y).toBeGreaterThanOrEqual(-1.05);
      expect(y).toBeLessThanOrEqual(1.05);
    }
  });

  it('same seed produces identical trajectories', () => {
    const a = new PositionStream(Seed.from(42n), { baseFreq: 0.002 });
    const b = new PositionStream(Seed.from(42n), { baseFreq: 0.002 });
    for (let i = 0; i < 50; i++) {
      const t = i * 7;
      expect(b.evaluate(t)).toEqual(a.evaluate(t));
    }
  });

  it('different seeds produce different trajectories', () => {
    const a = new PositionStream(Seed.from(42n), { baseFreq: 0.002 });
    const b = new PositionStream(Seed.from(43n), { baseFreq: 0.002 });
    // Sample at a handful of times; at least one should differ on each axis.
    let xDiffer = false;
    let yDiffer = false;
    for (let i = 1; i < 20; i++) {
      const pa = a.evaluate(i * 10);
      const pb = b.evaluate(i * 10);
      if (Math.abs(pa.x - pb.x) > 1e-6) xDiffer = true;
      if (Math.abs(pa.y - pb.y) > 1e-6) yDiffer = true;
    }
    expect(xDiffer).toBe(true);
    expect(yDiffer).toBe(true);
  });

  it('determinism contract — locked sequence for Seed(42n)', () => {
    const ps = new PositionStream(Seed.from(42n), { baseFreq: 0.002 });
    // Lock the first three (x, y) samples at t = 0, 60, 120. If this
    // changes, every saved seed's register/mode trajectories shift —
    // treat as a deliberate compat break and bump the seed format
    // version.
    const samples = [0, 60, 120].map((t) => {
      const p = ps.evaluate(t);
      return `${p.x.toFixed(6)}/${p.y.toFixed(6)}`;
    });
    expect(samples).toEqual(['-0.758392/0.677256', '-0.641453/0.492423', '-0.438349/0.171396']);
  });
});
