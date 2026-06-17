import { describe, expect, it } from 'vitest';
import {
  blendChordWeights,
  CHORD_NAMES,
  CHORDS,
  dominantModeAtPosition,
  MODE_POOLS,
  MODES_ORDER,
  modesAtPosition,
} from '../src/index.js';

// C major key signature: pcs of white keys = C(0) D(2) E(4) F(5) G(7) A(9) B(11).
const C_MAJOR_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);

describe('modes (Stage 7c.1)', () => {
  it('all modes have their tonic chord in the vocabulary', () => {
    for (const mode of MODES_ORDER) {
      const pool = MODE_POOLS[mode];
      expect(CHORDS[pool.tonicChord]).toBeDefined();
    }
  });

  it('tonicPc matches the tonic chord root', () => {
    for (const mode of MODES_ORDER) {
      const pool = MODE_POOLS[mode];
      expect(pool.tonicPc).toBe(CHORDS[pool.tonicChord].rootPc);
    }
  });

  it('all scale pcs stay within C-major key signature (no accidentals)', () => {
    // Modes-of-C framing: mode drift without key drift means no
    // sharps/flats are introduced. Every mode's scale pcs are a subset
    // of {C D E F G A B}.
    for (const mode of MODES_ORDER) {
      const pool = MODE_POOLS[mode];
      for (const pc of pool.scalePcs) {
        expect(C_MAJOR_PCS.has(pc)).toBe(true);
      }
    }
  });

  it('all chord-weight references point to existing chords', () => {
    const valid = new Set(CHORD_NAMES);
    for (const mode of MODES_ORDER) {
      const pool = MODE_POOLS[mode];
      for (const name of Object.keys(pool.chordWeights)) {
        expect(valid.has(name as (typeof CHORD_NAMES)[number])).toBe(true);
      }
    }
  });

  it('each mode gives its tonic chord weight 1.0 (highest)', () => {
    for (const mode of MODES_ORDER) {
      const pool = MODE_POOLS[mode];
      const tonicWeight = pool.chordWeights[pool.tonicChord];
      expect(tonicWeight).toBe(1.0);
      // Confirm no other chord beats the tonic.
      for (const name of Object.keys(pool.chordWeights)) {
        const w = pool.chordWeights[name as (typeof CHORD_NAMES)[number]] ?? 0;
        expect(w).toBeLessThanOrEqual(tonicWeight as number);
      }
    }
  });

  it('borrowed chords (Fm6, Bbmaj7) only appear in Aeolian', () => {
    for (const mode of MODES_ORDER) {
      const pool = MODE_POOLS[mode];
      if (mode === 'aeolian') continue;
      expect(pool.chordWeights.Fm6 ?? 0).toBe(0);
      expect(pool.chordWeights.Bbmaj7 ?? 0).toBe(0);
    }
  });

  it('modesAtPosition(0) = Aeolian-dominant (engine home)', () => {
    const active = modesAtPosition(0);
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect((active[0] as { mode: string }).mode).toBe('aeolian');
    expect((active[0] as { weight: number }).weight).toBe(1);
  });

  it('modesAtPosition(-1) = Lydian, modesAtPosition(+1) = Phrygian (edges)', () => {
    const lyd = modesAtPosition(-1);
    const phr = modesAtPosition(1);
    expect((lyd[0] as { mode: string }).mode).toBe('lydian');
    expect((phr[0] as { mode: string }).mode).toBe('phrygian');
  });

  it('modesAtPosition crossfades 2 modes mid-knot', () => {
    // x = -0.125 sits halfway between dorian (-0.25) and aeolian (0).
    const active = modesAtPosition(-0.125);
    expect(active.length).toBe(2);
    const modes = active.map((m) => m.mode).sort();
    expect(modes).toEqual(['aeolian', 'dorian']);
    const sumW = active.reduce((s, m) => s + m.weight, 0);
    expect(sumW).toBeCloseTo(1, 9);
    // Equally weighted at the midpoint.
    for (const m of active) expect(m.weight).toBeCloseTo(0.5, 9);
  });

  it('modesAtPosition clamps out-of-range inputs', () => {
    expect((modesAtPosition(-2)[0] as { mode: string }).mode).toBe('lydian');
    expect((modesAtPosition(+2)[0] as { mode: string }).mode).toBe('phrygian');
  });

  it('blendChordWeights sums per-mode weights correctly', () => {
    // Pure Aeolian: Am7 weight = 1.0.
    const aeolian = blendChordWeights([{ mode: 'aeolian', weight: 1 }]);
    expect(aeolian.Am7).toBe(1.0);

    // 50/50 Aeolian/Dorian: Am7 = 0.5 * 1.0 (aeolian) + 0.5 * 0.7 (dorian's v)
    const half = blendChordWeights([
      { mode: 'aeolian', weight: 0.5 },
      { mode: 'dorian', weight: 0.5 },
    ]);
    expect(half.Am7).toBeCloseTo(0.85, 9);
    // Borrowed chord only weighted by Aeolian's contribution.
    expect(half.Fm6).toBeCloseTo(0.125, 9); // 0.5 * 0.25 + 0.5 * 0
  });

  it('blendChordWeights omits chords with zero blended weight', () => {
    // Pure Phrygian: borrowed chords are excluded.
    const phrygian = blendChordWeights([{ mode: 'phrygian', weight: 1 }]);
    expect(phrygian.Fm6).toBeUndefined();
    expect(phrygian.Bbmaj7).toBeUndefined();
  });

  it('dominantModeAtPosition picks the mode with highest weight', () => {
    expect(dominantModeAtPosition(0)).toBe('aeolian');
    expect(dominantModeAtPosition(-1)).toBe('lydian');
    expect(dominantModeAtPosition(1)).toBe('phrygian');
    // x = -0.2 sits closer to aeolian (0) than dorian (-0.25)
    expect(dominantModeAtPosition(-0.1)).toBe('aeolian');
    // x = -0.4 sits closer to dorian (-0.25) than mixolydian (-0.5)
    expect(dominantModeAtPosition(-0.3)).toBe('dorian');
  });
});
