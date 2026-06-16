import { type ChordSymbol, chordPitchClasses } from './chords.js';

/**
 * Pure voice-leading solver: given a previous voicing (or none) and a
 * target chord, build the next voicing by moving each voice the
 * minimum semitone distance to a tone of the new chord.
 *
 * Algorithm:
 *   1. Common-tone retention is automatic: if a previous pitch's pitch
 *      class is in the new chord, distance is 0 and it stays.
 *   2. Otherwise, each previous voice greedily picks the nearest chord
 *      tone — searching all candidate octaves within the register.
 *
 * Constraints:
 *   - All output pitches lie in `register.low..register.high`.
 *   - Output is sorted ascending. Voice count matches `prev`.
 *
 * Initial voicing (no previous): pick the first 4 intervals of the chord
 * starting from `register.low + 7` (a Rhodes-friendly mid range). This
 * matches the prototype's seeding behavior.
 *
 * Extension thinning: when a chord has more intervals than the voicing
 * can hold, `trimIntervals` drops the 5 first, then 9, then 13 — per the
 * §4 priority — so color extensions (♯11, 11, 9) are actually heard.
 *
 * Not yet implemented (Stage 7+ refinement):
 *   - Top-voice continuity (currently emerges from min-motion but
 *     isn't enforced).
 *   - Drop-2 / drop-3 spread voicings.
 */

export interface Register {
  /** Inclusive low MIDI pitch. */
  readonly low: number;
  /** Inclusive high MIDI pitch. */
  readonly high: number;
}

/** Default Rhodes-ish mid register: E3–E5. */
export const DEFAULT_REGISTER: Register = { low: 52, high: 76 };

export interface VoiceOptions {
  /** Target voice count when no previous voicing is supplied. Defaults to 4. */
  readonly targetVoices?: number;
  readonly register?: Register;
}

/**
 * Voice the chord. Returns MIDI pitches, sorted ascending.
 */
export function voiceChord(
  prev: readonly number[] | null,
  chord: ChordSymbol,
  opts: VoiceOptions = {},
): number[] {
  const register = opts.register ?? DEFAULT_REGISTER;
  const targetVoices = opts.targetVoices ?? prev?.length ?? 4;
  // Trim the chord to `targetVoices` intervals using the §4 priority (drop
  // 5 first, then 9, then 13). Both the seed-voicing path and the greedy
  // assignment use the trimmed pitch classes so the color extensions
  // (♯11, 11, 9) are actually heard, not lost to the 5 they're competing
  // with on minimum-motion grounds.
  const trimmed = trimIntervals(chord.intervals, targetVoices);
  const trimmedChord: ChordSymbol = { ...chord, intervals: trimmed };
  const pcs = chordPitchClasses(trimmedChord);

  if (!prev || prev.length === 0) {
    return seedVoicing(trimmedChord, register, targetVoices);
  }

  const voicing: number[] = [];
  for (const p of prev) {
    voicing.push(nearestPitchInPcs(p, pcs, register));
  }
  return voicing.sort((a, b) => a - b);
}

/**
 * Trim a chord's intervals down to `target` voices using the lofi voicing
 * priority from `docs/lofi-study.md` §4:
 *   - Always keep the root, 3rd (3 or 4), 7th (10 or 11), and the highest
 *     extension if any.
 *   - Drop the 5 (interval 7) first.
 *   - Then drop the 9 (interval 14), then the 13 (interval 21).
 *
 * If the chord has ≤ target intervals already, returns it unchanged.
 */
function trimIntervals(intervals: readonly number[], target: number): number[] {
  const kept = intervals.slice();
  const dropOrder = [7, 14, 21];
  for (const d of dropOrder) {
    if (kept.length <= target) break;
    const i = kept.indexOf(d);
    if (i >= 0) kept.splice(i, 1);
  }
  // Safety: if still too many (shouldn't happen with the current vocab),
  // drop from the middle to preserve root and topmost extension.
  while (kept.length > target) kept.splice(Math.floor(kept.length / 2), 1);
  return kept;
}

/** Find the pitch with `pc ∈ pcs` closest to `target`, constrained to `register`. */
function nearestPitchInPcs(target: number, pcs: readonly number[], register: Register): number {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const pc of pcs) {
    // Project `pc` into octaves spanning the register and pick the closest
    // to `target`. Allow one octave above the register top / below the
    // bottom in the search, then clamp by re-projecting if needed.
    const lowOct = Math.floor((register.low - pc) / 12);
    const highOct = Math.ceil((register.high - pc) / 12);
    for (let oct = lowOct; oct <= highOct; oct++) {
      const candidate = pc + 12 * oct;
      if (candidate < register.low || candidate > register.high) continue;
      const dist = Math.abs(candidate - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  if (best < 0) {
    // No in-register candidate (register narrower than 12 semitones and
    // no pc lands inside). Fall back to the closest pc in any octave.
    for (const pc of pcs) {
      const candidate = pc + 12 * Math.round((target - pc) / 12);
      const dist = Math.abs(candidate - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return best;
}

function seedVoicing(chord: ChordSymbol, register: Register, voices: number): number[] {
  const startPitch = register.low + 7;
  const intervals = chord.intervals.slice(0, voices);
  const out: number[] = [];
  for (const i of intervals) {
    let p = chord.rootPc + i;
    while (p < startPitch) p += 12;
    while (p > register.high) p -= 12;
    out.push(p);
  }
  return out.sort((a, b) => a - b);
}
