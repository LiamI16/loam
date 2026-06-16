import type { Seed } from '../rng/seed.js';
import { splitmix64 } from '../rng/splitmix64.js';

const MASK64 = 0xffffffffffffffffn;
const MASK32 = 0xffffffffn;

/**
 * Deterministic 1D value noise. Smooth interpolation between hash-derived
 * gradient values at integer positions — continuous output that *feels*
 * random. No period: each integer position's gradient is freshly hashed
 * from the seed via splitmix64, so the noise pattern is unique for any
 * absolute x, no matter how large.
 *
 * Output range: ~[-1, 1].
 *
 * Used as the building block for fBm. See docs/dynamics-brainstorm.md §1.3.
 */
export class ValueNoise1D {
  private readonly seedHash: bigint;

  constructor(seed: Seed) {
    this.seedHash = seed.value;
  }

  /** Sample at position x (any real). Continuous and bounded. */
  sample(x: number): number {
    const x0 = Math.floor(x);
    const t = x - x0;
    const g0 = this.gradient(x0);
    const g1 = this.gradient(x0 + 1);
    const ts = smoothstep(t);
    return g0 + (g1 - g0) * ts;
  }

  private gradient(x: number): number {
    // Wrap negative ints into unsigned 64-bit for clean XOR mixing.
    const xWrapped = BigInt(x) & MASK64;
    const mixed = splitmix64(this.seedHash ^ xWrapped);
    return (Number(mixed & MASK32) / 0xffffffff) * 2 - 1;
  }
}

/** Hermite smoothstep: 3t² − 2t³. C¹-continuous, avoids the kinks of
 * linear interpolation between gradient values. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
