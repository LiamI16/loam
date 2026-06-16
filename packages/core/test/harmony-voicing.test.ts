import { describe, expect, it } from 'vitest';
import { CHORDS, DEFAULT_REGISTER, voiceChord } from '../src/index.js';

describe('voiceChord', () => {
  it('with no previous voicing, seeds with the first N intervals in register', () => {
    const v = voiceChord(null, CHORDS.Cmaj7);
    // Cmaj7 = C E G B, MIDI pitch-classes 0 4 7 11. In E3–E5 register
    // (52–76), the seeding rule lifts each interval into the mid range.
    expect(v).toEqual([59, 60, 64, 67]); // B3 C4 E4 G4
  });

  it('all output pitches lie within the register', () => {
    for (const name of Object.keys(CHORDS) as (keyof typeof CHORDS)[]) {
      const v = voiceChord(null, CHORDS[name]);
      for (const p of v) {
        expect(p).toBeGreaterThanOrEqual(DEFAULT_REGISTER.low);
        expect(p).toBeLessThanOrEqual(DEFAULT_REGISTER.high);
      }
    }
  });

  it('common-tone retention: pitches in both chords stay put', () => {
    // Am7 (A C E G) → Cmaj7 (C E G B). Common tones: C E G. Only the A
    // moves — by minimum motion to B (1 semitone down).
    const prev = [57, 60, 64, 67]; // A3 C4 E4 G4
    const next = voiceChord(prev, CHORDS.Cmaj7);
    const motion = next.map((p, i) => p - (prev[i] as number));
    // After sorting `next`, pitches that match exactly contribute 0 motion.
    // Three of the four prev pitches should have a same-pitch match.
    const exactRetained = prev.filter((p) => next.includes(p)).length;
    expect(exactRetained).toBeGreaterThanOrEqual(3);
    // Total absolute motion should be tiny (≤ 2 semitones).
    expect(motion.reduce((s, d) => s + Math.abs(d), 0)).toBeLessThanOrEqual(2);
  });

  it('greedy nearest-pitch finds octave-adjacent chord tones', () => {
    // Cmaj7 → Fmaj7 (F A C E). Prev pitches 60 64 67 71. C and E are common
    // tones; G(67) and B(71) move to the nearest F/A. Total motion ≤ a few
    // semitones (no octave leaps).
    const prev = [60, 64, 67, 71];
    const next = voiceChord(prev, CHORDS.Fmaj7);
    const totalMotion = next.reduce((s, p, i) => s + Math.abs(p - (prev[i] as number)), 0);
    expect(totalMotion).toBeLessThanOrEqual(6);
    // Every pitch in the new voicing must be an F/A/C/E (pitch class 5/9/0/4).
    const fmaj7Pcs = new Set([5, 9, 0, 4]);
    for (const p of next) expect(fmaj7Pcs.has(p % 12)).toBe(true);
  });

  it('output is sorted ascending and matches prev voice count', () => {
    const prev = [55, 60, 64, 69];
    const next = voiceChord(prev, CHORDS.Dm9);
    expect(next).toHaveLength(prev.length);
    for (let i = 1; i < next.length; i++) {
      expect(next[i] as number).toBeGreaterThanOrEqual(next[i - 1] as number);
    }
  });
});
