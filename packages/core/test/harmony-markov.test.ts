import { describe, expect, it } from 'vitest';
import type { ChordName } from '../src/index.js';
import { HAND_MATRIX, MarkovChordWalk, Seed } from '../src/index.js';

describe('MarkovChordWalk', () => {
  it('same seed produces identical walks', () => {
    const a = new MarkovChordWalk(HAND_MATRIX, Seed.from(42n).child('harmony/markov').rng());
    const b = new MarkovChordWalk(HAND_MATRIX, Seed.from(42n).child('harmony/markov').rng());
    const seqA: ChordName[] = [];
    const seqB: ChordName[] = [];
    for (let i = 0; i < 16; i++) {
      seqA.push(a.next());
      seqB.push(b.next());
    }
    expect(seqB).toEqual(seqA);
  });

  it('starts at the configured chord', () => {
    const w = new MarkovChordWalk(
      HAND_MATRIX,
      Seed.from(42n).child('harmony/markov').rng(),
      'Cmaj7',
    );
    expect(w.peek()).toBe('Cmaj7');
  });

  it('only emits chords reachable per the matrix', () => {
    const w = new MarkovChordWalk(HAND_MATRIX, Seed.from(7n).child('harmony/markov').rng(), 'Am7');
    let prev: ChordName = 'Am7';
    for (let i = 0; i < 200; i++) {
      const next = w.next();
      const reachable = Object.keys(HAND_MATRIX[prev]).filter(
        (k) => (HAND_MATRIX[prev][k as ChordName] ?? 0) > 0,
      );
      expect(reachable).toContain(next);
      prev = next;
    }
  });

  it('next(modeWeights) biases the walk toward the mode chord pool', () => {
    // Pure Lydian mode weights (Fmaj9 tonic, F-pool chords). The walk
    // started at Am7 should pick a chord that's *in* the Lydian pool
    // (Am7's neighbors in HAND_MATRIX intersected with Lydian's pool).
    // Lydian excludes Am11 and the borrowed Bbmaj7; from Am7's row
    // those are filtered out, leaving Dm7/Fmaj7/Cmaj7/Em7/Am9/G7.
    const w = new MarkovChordWalk(HAND_MATRIX, Seed.from(99n).child('harmony/markov').rng(), 'Am7');
    const lydianWeights: Partial<Record<ChordName, number>> = {
      Fmaj7: 0.9,
      Fmaj9: 1.0,
      Cmaj7: 0.7,
      Cmaj7s11: 0.95,
      Dm7: 0.55,
    };
    for (let i = 0; i < 20; i++) {
      const next = w.next(lydianWeights);
      expect(lydianWeights[next] ?? 0).toBeGreaterThan(0);
    }
  });

  it('next(modeWeights) with all-zero weights falls back gracefully', () => {
    // Mode that excludes every reachable chord from Am7's row.
    const w = new MarkovChordWalk(HAND_MATRIX, Seed.from(7n).child('harmony/markov').rng(), 'Am7');
    const onlyBbmaj7 = { Bbmaj7: 1.0 }; // Am7's row has Bbmaj7 with weight 0.02
    const next = w.next(onlyBbmaj7);
    // Should land on Bbmaj7 (only reachable + only mode-allowed).
    expect(next).toBe('Bbmaj7');
  });

  it('determinism contract — locked 16-chord walk from Am7 with Seed.from(42n)', () => {
    // Locks: HAND_MATRIX edge weights + walk's CDF-roll formula + the
    // PRNG/Seed.child contract. If any link in this chain changes, every
    // saved seed shifts harmonically.
    const w = new MarkovChordWalk(HAND_MATRIX, Seed.from(42n).child('harmony/markov').rng(), 'Am7');
    const seq: ChordName[] = [];
    for (let i = 0; i < 16; i++) seq.push(w.next());
    expect(seq).toEqual([
      'Em7',
      'Cmaj7',
      'Am7',
      'Fmaj7',
      'Dm7',
      'Cmaj7',
      'Am7',
      'Dm7',
      'Cmaj7',
      'Fmaj7',
      'Dm7',
      'Cmaj7',
      'Am7',
      'Am9',
      'Dm9',
      'Dm7',
    ]);
  });
});
