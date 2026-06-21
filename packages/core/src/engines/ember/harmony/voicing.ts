import { type ChordSymbol, chordPitchClasses, type Quality } from './chords.js';

/**
 * Voicing strategies (archetypes) for chord comping. Four flavors, all
 * built from the chord's pitch-class membership and the supplied
 * register:
 *
 *   - `close`    — current Phase-1 behavior. Greedy min-motion voice
 *                  leading from `prev`. Tightly clustered voicings near
 *                  the previous voicing's register.
 *   - `spread`   — close voicing with drop-2 or drop-3 applied (the
 *                  2nd-from-top or 3rd-from-top voice dropped one
 *                  octave). Standard jazz-piano openness.
 *   - `rootless` — chord intervals minus the root and the 5. Adds the
 *                  9 if not already present so the voicing has ≥ 3
 *                  voices. The downbeat instrument (pad / bass) covers
 *                  the root, so the chord voicing carries colour only.
 *   - `quartal`  — three voices stacked in 4ths from a chord-tone seed.
 *                  Sparse, open, modal flavour. Voice count = 3 (not 4)
 *                  on purpose; quartal voicings are airier when thin.
 *
 * Voice-leading: only `close` smooths from `prev`. Other archetypes
 * build deterministically (same chord → same voicing within an
 * archetype), so consecutive same-archetype slots stay register-stable
 * without explicit smoothing. Archetype transitions reset voicing
 * (see scheduler — `prev` is passed as null on archetype change).
 *
 * Extension-thinning (`trimIntervals`) applies only to the `close`
 * archetype where the close-voicing 4-voice target is meaningful.
 * Spread inherits trimming via close. Rootless and quartal compute
 * their voicings from scratch.
 */

export interface Register {
  /** Inclusive low MIDI pitch. */
  readonly low: number;
  /** Inclusive high MIDI pitch. */
  readonly high: number;
}

/** Default Rhodes-ish mid register: E3–E5. */
export const DEFAULT_REGISTER: Register = { low: 52, high: 76 };

export type Archetype = 'close' | 'spread' | 'rootless' | 'quartal';

export const ARCHETYPES: readonly Archetype[] = ['close', 'spread', 'rootless', 'quartal'];

export interface VoiceOptions {
  /** Voicing strategy. Defaults to `'close'` (back-compat). */
  readonly archetype?: Archetype;
  /** Target voice count for `close` (and `spread`-derived). Defaults
   * to `prev.length` if `prev` non-null, else 4. Rootless and quartal
   * ignore this (they have natural voice counts). */
  readonly targetVoices?: number;
  readonly register?: Register;
  /** Spread variant: drop-2 (default) or drop-3. */
  readonly spreadDrop?: 2 | 3;
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
  const archetype = opts.archetype ?? 'close';
  const targetVoices = opts.targetVoices ?? prev?.length ?? 4;
  switch (archetype) {
    case 'close':
      return voiceClose(prev, chord, register, targetVoices);
    case 'spread':
      return voiceSpread(prev, chord, register, targetVoices, opts.spreadDrop ?? 2);
    case 'rootless':
      return voiceRootless(chord, register);
    case 'quartal':
      return voiceQuartal(chord, register);
  }
}

/** Close-position voice-leading (the prototype's default). */
function voiceClose(
  prev: readonly number[] | null,
  chord: ChordSymbol,
  register: Register,
  targetVoices: number,
): number[] {
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

/** Spread voicing = close voicing with one voice dropped an octave.
 * If the dropped voice would fall below the register's low bound, the
 * voice immediately above it is dropped instead (graceful fallback). */
function voiceSpread(
  prev: readonly number[] | null,
  chord: ChordSymbol,
  register: Register,
  targetVoices: number,
  drop: 2 | 3,
): number[] {
  const close = voiceClose(prev, chord, register, targetVoices);
  if (close.length < drop + 1) return close.slice().sort((a, b) => a - b);
  const out = close.slice();
  // Drop the Nth-from-top voice (drop-2 = 2nd from top, drop-3 = 3rd).
  let idx = out.length - drop;
  let candidate = (out[idx] as number) - 12;
  if (candidate < register.low) {
    // Try the next-from-top voice instead.
    idx = out.length - drop - 1;
    if (idx < 0) return close.slice().sort((a, b) => a - b);
    candidate = (out[idx] as number) - 12;
    if (candidate < register.low) return close.slice().sort((a, b) => a - b);
  }
  out[idx] = candidate;
  return out.sort((a, b) => a - b);
}

/** Rootless voicing: drop root + 5, add 9 if not present, build from
 * scratch centred on the register. Three voices minimum. */
function voiceRootless(chord: ChordSymbol, register: Register): number[] {
  const intervals = rootlessIntervals(chord);
  return placeFromScratch(chord.rootPc, intervals, register);
}

/** Quartal voicing: three voices stacked in perfect 4ths, starting
 * from a chord-tone seed determined by quality. The "modal" archetype. */
function voiceQuartal(chord: ChordSymbol, register: Register): number[] {
  const startInterval = quartalStartInterval(chord.quality);
  const intervals = [startInterval, startInterval + 5, startInterval + 10];
  return placeFromScratch(chord.rootPc, intervals, register);
}

/** Quality-specific starting interval for quartal stacking. Chosen
 * so the resulting voicing stays inside the chord's natural tones
 * (consonant rather than tritone-substitution flavour):
 *   - min*  / dom*: start at the 4 (5 semitones). Stack: 4, b7, b3.
 *   - maj*       : start at the 7 (11 semitones). Stack: 7, 3, 6. */
function quartalStartInterval(quality: Quality): number {
  switch (quality) {
    case 'maj7':
    case 'maj9':
    case 'maj7s11':
      return 11;
    default:
      return 5;
  }
}

/** Derive rootless intervals from a chord: drop root (0) and 5 (7),
 * ensure 9 (14) is present so the voicing has ≥ 3 voices. */
function rootlessIntervals(chord: ChordSymbol): number[] {
  const kept = chord.intervals.filter((i) => i !== 0 && i !== 7);
  if (!kept.includes(14)) kept.push(14);
  return kept.sort((a, b) => a - b);
}

/** Convert an intervals-from-root spec into actual MIDI pitches placed
 * near the centre of the register. Same chord → same pitches. */
function placeFromScratch(
  rootPc: number,
  intervals: readonly number[],
  register: Register,
): number[] {
  const center = Math.floor((register.low + register.high) / 2);
  const out: number[] = [];
  for (const i of intervals) {
    const pc = (((rootPc + i) % 12) + 12) % 12;
    // Nearest pitch to `center` with this pitch class, within register.
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let p = register.low; p <= register.high; p++) {
      if (((p % 12) + 12) % 12 !== pc) continue;
      const d = Math.abs(p - center);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (best >= 0) out.push(best);
  }
  return out.sort((a, b) => a - b);
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
  while (kept.length > target) kept.splice(Math.floor(kept.length / 2), 1);
  return kept;
}

/** Find the pitch with `pc ∈ pcs` closest to `target`, constrained to `register`. */
function nearestPitchInPcs(target: number, pcs: readonly number[], register: Register): number {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const pc of pcs) {
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

/**
 * Public utility: drop one random inner voice from a voicing. Used by
 * the chord scheduler for per-bar micro-variation. Picks uniformly
 * from indices [1, length-2] (exclusive of top and bottom). For
 * voicings with < 3 voices, returns the input unchanged.
 *
 * The caller supplies the index (computed from a deterministic Rng) to
 * keep this function pure.
 */
export function dropOneVoice(voicing: readonly number[], innerIndex: number): number[] {
  if (voicing.length < 3) return voicing.slice();
  const safeIdx = Math.max(1, Math.min(voicing.length - 2, innerIndex));
  const out = voicing.slice();
  out.splice(safeIdx, 1);
  return out;
}

/**
 * Public utility: rootless preview voicing for a chord, used by the
 * pickup hit. Drops the bottom voice (root in close/spread, third in
 * rootless, fourth in quartal). Caller passes the next slot's first-
 * hit voicing already computed in the right archetype + register;
 * this just slices off the bottom.
 */
export function rootlessVoicing(voicing: readonly number[]): number[] {
  if (voicing.length <= 1) return voicing.slice();
  return voicing.slice(1);
}

/**
 * Apply a `VoicingThinness` to a voicing. Maps the declarative spec
 * from `comping-patterns.ts` onto pitch arrays:
 *   - `full`       → unchanged
 *   - `rootless`   → drops the bottom voice
 *   - `top-voices` → keeps only the highest 2 (3 if the voicing has 5+)
 *
 * Used by the chord scheduler to interpret per-hit thinness without
 * recomputing voicings. Always returns a sorted ascending array.
 */
export function applyThinness(
  voicing: readonly number[],
  thinness: 'full' | 'rootless' | 'top-voices',
): number[] {
  if (thinness === 'full') return voicing.slice();
  if (thinness === 'rootless') return rootlessVoicing(voicing);
  const keep = voicing.length >= 5 ? 3 : 2;
  return voicing.slice(Math.max(0, voicing.length - keep));
}
