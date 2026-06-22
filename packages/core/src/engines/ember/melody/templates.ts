import type { Rng } from '../../../rng/rng.js';
import type { Seed } from '../../../rng/seed.js';
import { perturbDirichlet } from '../harmony/index.js';

/**
 * Melody template vocabulary + per-seed germ generation. Static data
 * lives here; the scheduler that *plays* the germ lives in
 * `melody-scheduler.ts`. See `docs/melody.md` §F2 (template vocabulary,
 * germ pitch representation, rhythm cells) for the design rationale.
 */

/** Rhythm shorthand from `docs/melody.md`. `8t` = eighth triplet. */
export type NoteDuration = '8t' | '8n' | '4n' | '2n' | '1n';

const DURATION_TO_BEATS: Readonly<Record<NoteDuration, number>> = {
  '8t': 1 / 3,
  '8n': 0.5,
  '4n': 1,
  '2n': 2,
  '1n': 4,
};

/** Beats (quarter-notes) covered by one note of the given duration. */
export function durationToBeats(d: NoteDuration): number {
  return DURATION_TO_BEATS[d];
}

export type ContourArchetype =
  | 'rising-arc'
  | 'falling-stepwise'
  | 'pivot'
  | 'leap-and-step'
  | 'held-then-fill'
  | 'symmetric-arc'
  | 'undulating'
  | 'wide-leap-sustain'
  | 'rocking'
  | 'arpeggio';

/** Interval-size bias for the contour generator's `stepSize()` helper.
 * `step-with-leap` occasionally widens to two scale degrees; `stepwise`
 * is always 1. T4 and T8 don't use this — their leap shape comes from
 * dedicated contour `case` blocks, not from interval-bias dispatch.
 *
 * NOTE — partial implementation: bias is **template-locked**, not
 * per-seed. `docs/melody.md` §F2 (line 311) lists "Pick interval-size
 * bias (some seeds tighter, some wider)" as a per-seed germ-generation
 * step, but the v1 implementation locks bias to each template's
 * default. Promoting bias to a per-seed dimension would need a new
 * `melody-interval-bias-config` seed child + a per-seed override; the
 * `IntervalBias` type was deliberately left structured (rather than
 * inlined into the contour cases) so that promotion stays cheap.
 * The original `'leap-then-resolve'` enum value was removed because
 * it was dead (T4/T8's leaps live in the contour `case` blocks); add
 * it back if a per-seed lean-into-leap dimension lands. */
export type IntervalBias = 'stepwise' | 'step-with-leap';

export type TemplateId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10';

export const TEMPLATE_IDS: readonly TemplateId[] = [
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'T6',
  'T7',
  'T8',
  'T9',
  'T10',
];

export interface Template {
  readonly id: TemplateId;
  readonly contour: ContourArchetype;
  readonly noteCount: { readonly min: number; readonly max: number };
  readonly defaultRhythmCell: readonly NoteDuration[];
  readonly intervalBias: IntervalBias;
}

export const TEMPLATES: Readonly<Record<TemplateId, Template>> = {
  T1: {
    id: 'T1',
    contour: 'rising-arc',
    noteCount: { min: 4, max: 4 },
    defaultRhythmCell: ['8n', '8n', '4n', '2n'],
    intervalBias: 'stepwise',
  },
  T2: {
    id: 'T2',
    contour: 'falling-stepwise',
    noteCount: { min: 4, max: 5 },
    defaultRhythmCell: ['4n', '8n', '8n', '8n', '4n'],
    intervalBias: 'stepwise',
  },
  T3: {
    id: 'T3',
    contour: 'pivot',
    noteCount: { min: 3, max: 3 },
    defaultRhythmCell: ['4n', '4n', '2n'],
    intervalBias: 'stepwise',
  },
  T4: {
    id: 'T4',
    contour: 'leap-and-step',
    noteCount: { min: 4, max: 4 },
    defaultRhythmCell: ['4n', '8n', '8n', '2n'],
    intervalBias: 'stepwise',
  },
  T5: {
    id: 'T5',
    contour: 'held-then-fill',
    noteCount: { min: 3, max: 4 },
    defaultRhythmCell: ['1n', '8n', '8n', '4n'],
    intervalBias: 'stepwise',
  },
  T6: {
    id: 'T6',
    contour: 'symmetric-arc',
    noteCount: { min: 5, max: 5 },
    defaultRhythmCell: ['8n', '8n', '4n', '8n', '8n'],
    intervalBias: 'stepwise',
  },
  T7: {
    id: 'T7',
    contour: 'undulating',
    noteCount: { min: 5, max: 7 },
    defaultRhythmCell: ['8t', '8t', '8t', '4n', '4n'],
    intervalBias: 'stepwise',
  },
  T8: {
    id: 'T8',
    contour: 'wide-leap-sustain',
    noteCount: { min: 3, max: 4 },
    defaultRhythmCell: ['8n', '1n', '8n', '4n'],
    intervalBias: 'stepwise',
  },
  T9: {
    id: 'T9',
    contour: 'rocking',
    noteCount: { min: 4, max: 5 },
    defaultRhythmCell: ['4n', '4n', '4n', '4n'],
    intervalBias: 'stepwise',
  },
  T10: {
    id: 'T10',
    contour: 'arpeggio',
    noteCount: { min: 3, max: 4 },
    defaultRhythmCell: ['8n', '8n', '8n', '4n'],
    intervalBias: 'step-with-leap',
  },
};

/** Base template weights (sum = 1.00). Calm-core ~83%, Ghibli ~11%,
 * arpeggio 6% — per `docs/melody.md` §F2 template vocabulary. Order
 * matches `TEMPLATE_IDS`. */
export const TEMPLATE_BASE_WEIGHTS: readonly number[] = [
  0.17, // T1
  0.17, // T2
  0.13, // T3
  0.08, // T4
  0.1, // T5
  0.08, // T6
  0.06, // T7
  0.05, // T8
  0.1, // T9
  0.06, // T10
];

/** Per-seed Dirichlet α for template-weight perturbation. Matches the
 * archetype / pattern α used by the chord layer. */
export const TEMPLATE_DIRICHLET_ALPHA = 20;

/**
 * One germ note, stored as a scale-degree offset (not raw MIDI). The
 * offset is in scale degrees from the home key center (A in A-minor /
 * C-major pentatonic), positive = above. Storing scale-degree-relative
 * keeps a future chord-aware reference-frame shift cheap — see
 * `docs/melody.md` §F2 "Germ pitch representation" sub-decision.
 */
export interface GermNote {
  readonly scaleDegreeOffset: number;
  readonly durationBeats: number;
}

export type Germ = readonly GermNote[];

/** Pick an index from a weights vector, given a uniform `[0, 1)` roll. */
function selectIndex(weights: readonly number[], roll: number): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] ?? 0;
    if (roll < acc) return i;
  }
  return weights.length - 1;
}

/** Generate the contour as scale-degree offsets, length `n`. Each
 * contour archetype has a deterministic shape with small per-seed
 * perturbation drawn from `rng`. Intentionally lightweight — the
 * musical-quality bar for v1 is "recognisable shape," not "polished
 * composition." */
function contourOffsets(
  contour: ContourArchetype,
  bias: IntervalBias,
  n: number,
  rng: Rng,
): number[] {
  const stepSize = (): number => {
    if (bias === 'step-with-leap') return rng.bernoulli(0.3) ? 2 : 1;
    return 1;
  };
  const out: number[] = [];
  switch (contour) {
    case 'rising-arc': {
      const peakIdx = Math.max(1, Math.floor((n - 1) * 0.66));
      let cur = 0;
      out.push(cur);
      for (let i = 1; i <= peakIdx; i++) {
        cur += stepSize();
        out.push(cur);
      }
      for (let i = peakIdx + 1; i < n; i++) {
        cur -= stepSize();
        out.push(cur);
      }
      break;
    }
    case 'falling-stepwise': {
      let cur = n - 1;
      for (let i = 0; i < n; i++) {
        out.push(cur);
        cur -= stepSize();
      }
      break;
    }
    case 'pivot': {
      // ABA — small motion around a center tone.
      const dir = rng.bernoulli(0.5) ? 1 : -1;
      out.push(0, dir * stepSize(), 0);
      for (let i = 3; i < n; i++) out.push(0);
      break;
    }
    case 'leap-and-step': {
      const leap = rng.nextInt(2, 4);
      out.push(0, leap);
      let cur = leap;
      for (let i = 2; i < n; i++) {
        cur -= 1;
        out.push(cur);
      }
      break;
    }
    case 'held-then-fill': {
      out.push(0);
      let cur = 0;
      for (let i = 1; i < n; i++) {
        cur += rng.bernoulli(0.5) ? 1 : -1;
        out.push(cur);
      }
      break;
    }
    case 'symmetric-arc': {
      const peak = Math.floor(n / 2);
      for (let i = 0; i < n; i++) {
        out.push(i <= peak ? i : 2 * peak - i);
      }
      break;
    }
    case 'undulating': {
      // Multiple peaks/valleys — sinusoidal-ish via alternating runs.
      let cur = 0;
      let dir = 1;
      out.push(cur);
      for (let i = 1; i < n; i++) {
        cur += dir * stepSize();
        out.push(cur);
        if (i % 2 === 0) dir = -dir;
      }
      break;
    }
    case 'wide-leap-sustain': {
      const leap = rng.nextInt(3, 5);
      out.push(0, leap);
      for (let i = 2; i < n; i++) out.push(leap + (i - 2));
      break;
    }
    case 'rocking': {
      // AB-AB oscillation between two adjacent pitches.
      const a = 0;
      const b = rng.bernoulli(0.5) ? 1 : -1;
      for (let i = 0; i < n; i++) out.push(i % 2 === 0 ? a : b);
      break;
    }
    case 'arpeggio': {
      // Skip-motion through chord tones (modelled as third-skips in
      // scale-degree space; chord-aware variant is a later pass).
      let cur = 0;
      const up = rng.bernoulli(0.6);
      for (let i = 0; i < n; i++) {
        out.push(cur);
        cur += up ? 2 : -2;
      }
      break;
    }
  }
  return out;
}

/** Build the per-seed germ. Consumes three seed children:
 *   - `melody-template-config` — per-seed Dirichlet template weights
 *   - `melody-template`        — single template-selection roll
 *   - `melody-germ`            — germ pitch + length rolls
 *
 * Returns the chosen template id alongside the germ note list so
 * downstream code (scheduler) can reference the template's start
 * constraint / termination / rhythm cell at emission time.
 */
export function generateGerm(seed: Seed): { template: Template; germ: Germ } {
  const weights = perturbDirichlet(
    TEMPLATE_BASE_WEIGHTS,
    seed.child('melody-template-config').rng(),
    TEMPLATE_DIRICHLET_ALPHA,
  );
  const tplRng = seed.child('melody-template').rng();
  const idx = selectIndex(weights, tplRng.nextFloat());
  const tplId = TEMPLATE_IDS[idx] ?? 'T1';
  const template = TEMPLATES[tplId];

  const germRng = seed.child('melody-germ').rng();
  const length = germRng.nextInt(template.noteCount.min, template.noteCount.max);
  const offsets = contourOffsets(template.contour, template.intervalBias, length, germRng);
  const cell = template.defaultRhythmCell;
  const germ: Germ = offsets.map((scaleDegreeOffset, i) => ({
    scaleDegreeOffset,
    durationBeats: durationToBeats(cell[i % cell.length] ?? '4n'),
  }));
  return { template, germ };
}
