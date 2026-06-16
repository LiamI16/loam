import type { Pcg32 } from './pcg32.js';

/** High-level Rng API on top of `Pcg32`. See docs/seed-format.md §2. */
export class Rng {
  constructor(private readonly pcg: Pcg32) {}

  /** Next uniform 32-bit unsigned integer. */
  next(): number {
    return this.pcg.nextUint32();
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.pcg.nextUint32() / 0x100000000;
  }

  /** Uniform float in [a, b). */
  nextRange(a: number, b: number): number {
    return a + this.nextFloat() * (b - a);
  }

  /** Uniform integer in [min, max], inclusive on both ends. */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  /** Uniform pick from a non-empty array. */
  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error('Rng.pick: empty array');
    return xs[this.nextInt(0, xs.length - 1)] as T;
  }

  /** True with probability p ∈ [0, 1]. */
  bernoulli(p: number): boolean {
    return this.nextFloat() < p;
  }
}
