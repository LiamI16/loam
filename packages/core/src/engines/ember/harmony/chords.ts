/**
 * Stage 6 chord vocabulary. Diatonic to C major / A minor (the engine's
 * current home key — modes/keys come in a later stage) plus a couple of
 * borrowed colors for variety.
 *
 * Each chord is `{ rootPc, intervals, quality }` — the voicing solver in
 * `voicing.ts` builds actual MIDI pitches. Pitch-class + intervals (rather
 * than absolute MIDI lists) so future transposition / mode work doesn't
 * require rewriting the vocabulary.
 *
 * See `docs/lofi-study.md` §2 for the broader chord-quality survey.
 */

export type ChordName =
  | 'Cmaj7'
  | 'Cmaj9'
  | 'Cmaj7s11'
  | 'Dm7'
  | 'Dm9'
  | 'Em7'
  | 'Fmaj7'
  | 'Fmaj9'
  | 'G7'
  | 'G9'
  | 'Am7'
  | 'Am9'
  | 'Am11'
  | 'Fm6'
  | 'Bbmaj7';

export type Quality =
  | 'maj7'
  | 'maj9'
  | 'maj7s11'
  | 'min7'
  | 'min9'
  | 'min11'
  | 'min6'
  | 'dom7'
  | 'dom9';

export interface ChordSymbol {
  readonly name: ChordName;
  /** 0–11, C = 0. */
  readonly rootPc: number;
  readonly quality: Quality;
  /** Intervals above the root, in semitones. Includes the root (0). */
  readonly intervals: readonly number[];
}

/** Interval recipes per quality. Stage 6 keeps voicings ≤5 tones. */
const INTERVALS: Readonly<Record<Quality, readonly number[]>> = {
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  maj7s11: [0, 4, 7, 11, 18],
  min7: [0, 3, 7, 10],
  min9: [0, 3, 7, 10, 14],
  min11: [0, 3, 7, 10, 14, 17],
  min6: [0, 3, 7, 9],
  dom7: [0, 4, 7, 10],
  dom9: [0, 4, 7, 10, 14],
};

function chord(name: ChordName, rootPc: number, quality: Quality): ChordSymbol {
  return { name, rootPc, quality, intervals: INTERVALS[quality] };
}

export const CHORDS: Readonly<Record<ChordName, ChordSymbol>> = {
  Cmaj7: chord('Cmaj7', 0, 'maj7'),
  Cmaj9: chord('Cmaj9', 0, 'maj9'),
  Cmaj7s11: chord('Cmaj7s11', 0, 'maj7s11'),
  Dm7: chord('Dm7', 2, 'min7'),
  Dm9: chord('Dm9', 2, 'min9'),
  Em7: chord('Em7', 4, 'min7'),
  Fmaj7: chord('Fmaj7', 5, 'maj7'),
  Fmaj9: chord('Fmaj9', 5, 'maj9'),
  G7: chord('G7', 7, 'dom7'),
  G9: chord('G9', 7, 'dom9'),
  Am7: chord('Am7', 9, 'min7'),
  Am9: chord('Am9', 9, 'min9'),
  Am11: chord('Am11', 9, 'min11'),
  Fm6: chord('Fm6', 5, 'min6'),
  Bbmaj7: chord('Bbmaj7', 10, 'maj7'),
};

export const CHORD_NAMES: readonly ChordName[] = Object.keys(CHORDS) as ChordName[];

/** Pitch classes (0–11) in the chord. Order matches `intervals`. */
export function chordPitchClasses(c: ChordSymbol): number[] {
  return c.intervals.map((i) => (c.rootPc + i) % 12);
}
