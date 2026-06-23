import { describe, expect, it } from 'vitest';
import {
  pickCompoundSecond,
  RETROGRADE_STRUCTURAL_WEIGHT,
  STRUCTURAL_TRANSFORMATIONS,
  sampleBetaTwoFive,
  structuralWeights,
  TRANSFORMATION_BASE_WEIGHTS,
  TRANSFORMATIONS,
  transformGerm,
} from '../src/engines/ember/melody/index.js';
import { Seed } from '../src/index.js';

const sampleGerm = [
  { scaleDegreeOffset: 0, durationBeats: 0.5 },
  { scaleDegreeOffset: 2, durationBeats: 0.5 },
  { scaleDegreeOffset: 3, durationBeats: 1 },
  { scaleDegreeOffset: 2, durationBeats: 0.5 },
  { scaleDegreeOffset: 0, durationBeats: 1 },
] as const;

describe('melody transformations', () => {
  it('exposes the six non-structural transformations + retrograde at structural moments', () => {
    expect(TRANSFORMATIONS).toHaveLength(6);
    expect(STRUCTURAL_TRANSFORMATIONS).toHaveLength(7);
    expect(STRUCTURAL_TRANSFORMATIONS).toContain('retrograde');
    expect(TRANSFORMATIONS).not.toContain('retrograde');
  });

  it('base weights sum to 1.00', () => {
    const sum = TRANSFORMATION_BASE_WEIGHTS.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('structural weights add retrograde at the fixed weight and renormalise the rest', () => {
    const ws = structuralWeights(TRANSFORMATION_BASE_WEIGHTS);
    expect(ws).toHaveLength(7);
    expect(ws[6]).toBeCloseTo(RETROGRADE_STRUCTURAL_WEIGHT, 9);
    const sum = ws.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('transpose shifts every offset by the same amount', () => {
    const rng = Seed.from(1n).rng();
    const out = transformGerm('transpose', sampleGerm, rng);
    expect(out).toHaveLength(sampleGerm.length);
    const delta = out[0]!.scaleDegreeOffset - sampleGerm[0]!.scaleDegreeOffset;
    expect(delta).not.toBe(0);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]!.scaleDegreeOffset).toBe(sampleGerm[i]!.scaleDegreeOffset + delta);
      expect(out[i]!.durationBeats).toBe(sampleGerm[i]!.durationBeats);
    }
  });

  it('fragment returns a contiguous slice of length ≥ 2', () => {
    const rng = Seed.from(1n).rng();
    const out = transformGerm('fragment', sampleGerm, rng);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThanOrEqual(sampleGerm.length);
    // Must match some contiguous slice of the source (the source has
    // duplicate offsets so we scan for any valid starting index).
    const matches = (start: number): boolean => {
      for (let i = 0; i < out.length; i++) {
        const a = out[i];
        const b = sampleGerm[start + i];
        if (
          !a ||
          !b ||
          a.scaleDegreeOffset !== b.scaleDegreeOffset ||
          a.durationBeats !== b.durationBeats
        ) {
          return false;
        }
      }
      return true;
    };
    let foundStart = -1;
    for (let s = 0; s <= sampleGerm.length - out.length; s++) {
      if (matches(s)) {
        foundStart = s;
        break;
      }
    }
    expect(foundStart).toBeGreaterThanOrEqual(0);
  });

  it('augment doubles all durations; diminish halves them', () => {
    const rng = Seed.from(1n).rng();
    const aug = transformGerm('augment', sampleGerm, rng);
    const dim = transformGerm('diminish', sampleGerm, rng);
    for (let i = 0; i < sampleGerm.length; i++) {
      expect(aug[i]!.durationBeats).toBeCloseTo(sampleGerm[i]!.durationBeats * 2, 9);
      expect(dim[i]!.durationBeats).toBeCloseTo(sampleGerm[i]!.durationBeats * 0.5, 9);
      expect(aug[i]!.scaleDegreeOffset).toBe(sampleGerm[i]!.scaleDegreeOffset);
    }
  });

  it('invert mirrors offsets around the first note', () => {
    const rng = Seed.from(1n).rng();
    const out = transformGerm('invert', sampleGerm, rng);
    const anchor = sampleGerm[0].scaleDegreeOffset;
    for (let i = 0; i < out.length; i++) {
      expect(out[i]!.scaleDegreeOffset).toBe(2 * anchor - sampleGerm[i]!.scaleDegreeOffset);
    }
  });

  it('retrograde reverses the sequence', () => {
    const rng = Seed.from(1n).rng();
    const out = transformGerm('retrograde', sampleGerm, rng);
    expect(out).toHaveLength(sampleGerm.length);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toEqual(sampleGerm[sampleGerm.length - 1 - i]);
    }
  });

  it('ornament inserts one passing tone (length grows by 1)', () => {
    const rng = Seed.from(1n).rng();
    const out = transformGerm('ornament', sampleGerm, rng);
    expect(out).toHaveLength(sampleGerm.length + 1);
  });

  it('empty germ passes through every transformation unchanged', () => {
    const rng = Seed.from(1n).rng();
    for (const kind of STRUCTURAL_TRANSFORMATIONS) {
      const out = transformGerm(kind, [], rng);
      expect(out).toEqual([]);
    }
  });

  it('transformations are deterministic for the same rng seed', () => {
    const a = transformGerm('transpose', sampleGerm, Seed.from(99n).rng());
    const b = transformGerm('transpose', sampleGerm, Seed.from(99n).rng());
    expect(b).toEqual(a);
  });

  it('pickCompoundSecond never returns the excluded kind', () => {
    // Sweep many rolls across many exclusions; assert exclusion always
    // holds. With Dirichlet α=20 the weight redistribution is mild.
    const rng = Seed.from(1n).rng();
    for (let trial = 0; trial < 200; trial++) {
      const exclude = TRANSFORMATIONS[trial % TRANSFORMATIONS.length] as
        | 'transpose'
        | 'fragment'
        | 'augment'
        | 'diminish'
        | 'invert'
        | 'ornament';
      const second = pickCompoundSecond(
        TRANSFORMATIONS,
        TRANSFORMATION_BASE_WEIGHTS,
        exclude,
        rng.nextFloat(),
      );
      expect(second).not.toBe(exclude);
    }
  });

  it('pickCompoundSecond at structural moments can return retrograde', () => {
    // Should be reachable when retrograde is not the excluded kind.
    const rng = Seed.from(1n).rng();
    const sWeights = structuralWeights(TRANSFORMATION_BASE_WEIGHTS);
    let sawRetrograde = false;
    for (let i = 0; i < 200; i++) {
      const second = pickCompoundSecond(
        STRUCTURAL_TRANSFORMATIONS,
        sWeights,
        'transpose',
        rng.nextFloat(),
      );
      if (second === 'retrograde') {
        sawRetrograde = true;
        break;
      }
    }
    expect(sawRetrograde).toBe(true);
  });

  it('sampleBetaTwoFive lies in [0, 1] and has the expected mean ~2/7', () => {
    const rng = Seed.from(1n).rng();
    const N = 10000;
    let sum = 0;
    let max = 0;
    let min = 1;
    for (let i = 0; i < N; i++) {
      const v = sampleBetaTwoFive(rng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      sum += v;
      if (v > max) max = v;
      if (v < min) min = v;
    }
    const mean = sum / N;
    // Beta(2, 5) mean = 2/(2+5) = 2/7 ≈ 0.2857.
    expect(mean).toBeGreaterThan(0.25);
    expect(mean).toBeLessThan(0.32);
  });
});
