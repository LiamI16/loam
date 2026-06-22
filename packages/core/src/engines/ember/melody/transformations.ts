import type { Rng } from '../../../rng/rng.js';
import type { Germ, GermNote } from './templates.js';

/**
 * Germ transformations for Phase 2 Commit E. Each transformation is a
 * pure function `(Germ, Rng) → Germ` — pluggable building blocks for
 * the per-firing emission rules and for the Commit F compound 2-chain.
 *
 * Design follows `docs/melody.md` §F2 transformation menu:
 *   transpose (0.27) | fragment (0.27) | ornament (0.16) |
 *   augment (0.13)   | invert (0.10)   | diminish (0.07)
 * Retrograde (~0.15) joins the menu only at structural moments
 * (chord changes / slot ends); the other six scale to 0.85 there to
 * keep the distribution normalised.
 */

export type TransformationKind =
  | 'transpose'
  | 'fragment'
  | 'augment'
  | 'diminish'
  | 'invert'
  | 'ornament'
  | 'retrograde';

/** Non-structural menu — six transformations always available. */
export const TRANSFORMATIONS: readonly TransformationKind[] = [
  'transpose',
  'fragment',
  'augment',
  'diminish',
  'invert',
  'ornament',
];

/** Structural-moment menu — adds retrograde at the end. */
export const STRUCTURAL_TRANSFORMATIONS: readonly TransformationKind[] = [
  'transpose',
  'fragment',
  'augment',
  'diminish',
  'invert',
  'ornament',
  'retrograde',
];

/** Base weights for the non-structural six. Sum = 1.00.
 *
 * Re-tuned post-Commit-E ear test: of the six, only `fragment` and
 * `ornament` actually disguise the germ's contour-shape — the other
 * four preserve rhythm + interval pattern (transpose shifts pitch;
 * invert mirrors; augment/diminish stretch durations). Original
 * weights `[0.27, 0.27, 0.13, 0.07, 0.10, 0.16]` were too kind to
 * shape-preserving transforms, so listeners caught the underlying
 * germ across many "different" firings. Shifted toward fragment +
 * ornament. */
export const TRANSFORMATION_BASE_WEIGHTS: readonly number[] = [
  0.18, // transpose
  0.4, // fragment
  0.09, // augment
  0.05, // diminish
  0.06, // invert
  0.22, // ornament
];

/** Retrograde's weight at structural moments. The other six are scaled
 * by `(1 - this)` to keep the structural distribution normalised. */
export const RETROGRADE_STRUCTURAL_WEIGHT = 0.15;

/** Per-seed Dirichlet α — mirrors the engine-wide α=20 mild perturbation. */
export const TRANSFORMATION_DIRICHLET_ALPHA = 20;

/** Transpose offsets in scale-degree space. No-op (0) excluded so the
 * transformation always actually transforms. */
const TRANSPOSE_OFFSETS: readonly number[] = [-3, -2, -1, 1, 2, 3];

/** Apply a transformation to a germ (or a buffer fragment treated as
 * germ-like). Pure function. Empty input returns empty. */
export function transformGerm(kind: TransformationKind, source: Germ, rng: Rng): Germ {
  if (source.length === 0) return source;
  switch (kind) {
    case 'transpose':
      return transpose(source, rng);
    case 'fragment':
      return fragment(source, rng);
    case 'augment':
      return scaleDurations(source, 2);
    case 'diminish':
      return scaleDurations(source, 0.5);
    case 'invert':
      return invert(source);
    case 'ornament':
      return ornament(source, rng);
    case 'retrograde':
      return retrograde(source);
  }
}

/** Build per-seed structural-menu weights from the non-structural ones.
 * Retrograde lands at `RETROGRADE_STRUCTURAL_WEIGHT`; the other six
 * scale proportionally to `1 - that`. Length 7. */
export function structuralWeights(nonStructural: readonly number[]): number[] {
  const scale = 1 - RETROGRADE_STRUCTURAL_WEIGHT;
  return [...nonStructural.map((w) => w * scale), RETROGRADE_STRUCTURAL_WEIGHT];
}

function transpose(source: Germ, rng: Rng): Germ {
  const offset = rng.pick(TRANSPOSE_OFFSETS);
  return source.map((n) => ({
    scaleDegreeOffset: n.scaleDegreeOffset + offset,
    durationBeats: n.durationBeats,
  }));
}

/** Pick a contiguous slice of the source. Minimum length 2 (single-note
 * fragments degenerate into the `fresh` rule's territory). Sources of
 * length 1 are returned unchanged.
 *
 * Length distribution is biased toward 2-note slices (70%), with 3
 * notes (25%) and "full possible length" (5%) as the long tail. A
 * uniform draw made fragments too long on average — listeners caught
 * the underlying germ shape in 3-4 note slices. Two consecutive notes
 * carry enough motivic signal without re-stating the contour. */
function fragment(source: Germ, rng: Rng): Germ {
  if (source.length <= 2) return source;
  const maxStart = source.length - 2;
  const start = rng.nextInt(0, maxStart);
  const maxLen = source.length - start;
  const lengthRoll = rng.nextFloat();
  let len: number;
  if (lengthRoll < 0.7) len = 2;
  else if (lengthRoll < 0.95) len = Math.min(3, maxLen);
  else len = maxLen;
  return source.slice(start, start + len);
}

function scaleDurations(source: Germ, factor: number): Germ {
  return source.map((n) => ({
    scaleDegreeOffset: n.scaleDegreeOffset,
    durationBeats: n.durationBeats * factor,
  }));
}

/** Mirror around the first note's offset. `o[i] → 2 * o[0] - o[i]`. */
function invert(source: Germ): Germ {
  const anchor = (source[0] as GermNote).scaleDegreeOffset;
  return source.map((n) => ({
    scaleDegreeOffset: 2 * anchor - n.scaleDegreeOffset,
    durationBeats: n.durationBeats,
  }));
}

/** Insert one passing-tone between two adjacent germ notes. The passing
 * note's offset is the midpoint (rounded toward the gap's direction);
 * its duration steals half from the predecessor. */
function ornament(source: Germ, rng: Rng): Germ {
  if (source.length < 2) return source;
  const gapIdx = rng.nextInt(0, source.length - 2);
  const a = source[gapIdx] as GermNote;
  const b = source[gapIdx + 1] as GermNote;
  const aOffset = a.scaleDegreeOffset;
  const bOffset = b.scaleDegreeOffset;
  // Passing tone halfway between, biased toward `b` (rounded that way).
  const passOffset =
    aOffset === bOffset
      ? aOffset
      : aOffset +
        Math.sign(bOffset - aOffset) * Math.max(1, Math.floor(Math.abs(bOffset - aOffset) / 2));
  const splitDuration = a.durationBeats / 2;
  const out: GermNote[] = [];
  for (let i = 0; i < source.length; i++) {
    if (i === gapIdx) {
      out.push({ scaleDegreeOffset: aOffset, durationBeats: splitDuration });
      out.push({ scaleDegreeOffset: passOffset, durationBeats: splitDuration });
    } else {
      out.push(source[i] as GermNote);
    }
  }
  return out;
}

function retrograde(source: Germ): Germ {
  return [...source].reverse();
}
