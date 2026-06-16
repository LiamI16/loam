import { describe, expect, it } from 'vitest';
import { Seed } from '../src/index.js';

describe('seed determinism contract', () => {
  it('same seed produces the same uint32 sequence', () => {
    const a = Seed.from(42n).rng();
    const b = Seed.from(42n).rng();
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds produce different sequences', () => {
    const a = Seed.from(42n).rng();
    const b = Seed.from(43n).rng();
    expect(a.next()).not.toBe(b.next());
  });

  it('child seeds with different labels diverge', () => {
    const root = Seed.from(42n);
    const a = root.child('melody').rng();
    const b = root.child('drums').rng();
    expect(a.next()).not.toBe(b.next());
  });

  it('child seeds with the same label are identical', () => {
    const root = Seed.from(42n);
    const a = root.child('melody').rng();
    const b = root.child('melody').rng();
    expect(a.next()).toBe(b.next());
  });

  it("sibling .child() calls don't perturb each other", () => {
    // Adding a new subsystem (calling root.child('b')) must not change what
    // root.child('a').rng().next() returns. This is the whole point of named
    // children.
    const root = Seed.from(42n);
    const aFirst = root.child('a').rng().next();
    root.child('b').rng().next();
    const aAgain = root.child('a').rng().next();
    expect(aFirst).toBe(aAgain);
  });

  it('produces a known sequence for seed 42n — locks the contract', () => {
    const rng = Seed.from(42n).rng();
    const got = Array.from({ length: 8 }, () => rng.next());
    // These values lock the PRNG implementation. If they change, every saved
    // seed is invalidated. Never relax this test without a versioning plan.
    expect(got).toEqual([
      565663470, 3244226384, 2504567229, 903561869, 4026996297, 2722332799, 3032858066, 272411090,
    ]);
  });
});
