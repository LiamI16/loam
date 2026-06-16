/**
 * Melody pitch material. Chord vocabulary and progressions moved to
 * `harmony/` in Stage 6 (Markov walk over a wider vocabulary + voice-leading
 * solver replaced the hand-picked 4-progression set). This module is now
 * just the pentatonic melody bag, kept here until Stage 9 (L-system
 * melody) rewrites it.
 */

/** A-minor pentatonic spread over two octaves. MIDI. A4 C5 D5 E5 G5 A5 C6. */
export const PENT_MIDI: readonly number[] = [69, 72, 74, 76, 79, 81, 84];
