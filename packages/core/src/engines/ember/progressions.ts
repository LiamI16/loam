/**
 * Chord vocabulary and progressions ported verbatim from
 * `ember-generative-study.html`. All diatonic to C major / A-minor —
 * smooth in any order. Pitch values are MIDI note numbers.
 *
 * See `docs/lofi-study.md` for the broader chord/progression survey.
 * These four progressions are the Stage-4 seed set; Stage 5 will replace
 * the picker with a Markov walk over a wider palette.
 */

export type ChordName = 'Cmaj7' | 'Am7' | 'Dm7' | 'Fmaj7' | 'Em7' | 'G7';

/** MIDI-pitch voicings, root-position. */
export const CHORDS: Readonly<Record<ChordName, readonly number[]>> = {
  Cmaj7: [60, 64, 67, 71], //  C4  E4  G4  B4
  Am7: [57, 60, 64, 67], //  A3  C4  E4  G4
  Dm7: [62, 65, 69, 72], //  D4  F4  A4  C5
  Fmaj7: [53, 57, 60, 64], //  F3  A3  C4  E4
  Em7: [52, 55, 59, 62], //  E3  G3  B3  D4
  G7: [55, 59, 62, 65], //  G3  B3  D4  F4
};

export const PROGRESSIONS: ReadonlyArray<readonly ChordName[]> = [
  ['Cmaj7', 'Am7', 'Dm7', 'G7'],
  ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7'],
  ['Am7', 'Dm7', 'G7', 'Cmaj7'],
  ['Dm7', 'G7', 'Em7', 'Am7'],
];

/** A-minor pentatonic spread over two octaves. MIDI. A4 C5 D5 E5 G5 A5 C6. */
export const PENT_MIDI: readonly number[] = [69, 72, 74, 76, 79, 81, 84];
