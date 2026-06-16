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
