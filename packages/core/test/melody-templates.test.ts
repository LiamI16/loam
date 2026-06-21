import { describe, expect, it } from 'vitest';
import {
  generateGerm,
  TEMPLATE_BASE_WEIGHTS,
  TEMPLATE_IDS,
  TEMPLATES,
} from '../src/engines/ember/melody/index.js';
import { Seed } from '../src/index.js';

describe('melody templates + germ generation', () => {
  it('all ten templates are present and well-formed', () => {
    for (const id of TEMPLATE_IDS) {
      const t = TEMPLATES[id];
      expect(t.id).toBe(id);
      expect(t.defaultRhythmCell.length).toBeGreaterThan(0);
      expect(t.noteCount.min).toBeGreaterThanOrEqual(3);
      expect(t.noteCount.max).toBeGreaterThanOrEqual(t.noteCount.min);
    }
  });

  it('base weights sum to ~1.00', () => {
    const sum = TEMPLATE_BASE_WEIGHTS.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('germ generation is deterministic per seed', () => {
    const a = generateGerm(Seed.from(42n).child('melody'));
    const b = generateGerm(Seed.from(42n).child('melody'));
    expect(b.template.id).toBe(a.template.id);
    expect(b.germ).toEqual(a.germ);
  });

  it('different seeds usually produce different germs', () => {
    const a = generateGerm(Seed.from(1n).child('melody'));
    const b = generateGerm(Seed.from(2n).child('melody'));
    // Either the template or the note offsets/rhythm differ.
    const same =
      a.template.id === b.template.id &&
      a.germ.length === b.germ.length &&
      a.germ.every(
        (n, i) =>
          n.scaleDegreeOffset === b.germ[i]?.scaleDegreeOffset &&
          n.durationBeats === b.germ[i]?.durationBeats,
      );
    expect(same).toBe(false);
  });

  it('germ note count falls within the chosen template range', () => {
    const { template, germ } = generateGerm(Seed.from(42n).child('melody'));
    expect(germ.length).toBeGreaterThanOrEqual(template.noteCount.min);
    expect(germ.length).toBeLessThanOrEqual(template.noteCount.max);
  });
});
