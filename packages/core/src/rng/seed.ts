import { hash64String } from './hash64.js';
import { Pcg32 } from './pcg32.js';
import { Rng } from './rng.js';
import { splitmix64 } from './splitmix64.js';

const MASK64 = 0xffffffffffffffffn;

/**
 * An immutable 64-bit seed. Spawns named child seeds via `.child(label)` so
 * every subsystem gets an independent PRNG stream — adding a new subsystem
 * doesn't perturb any existing one's stream. See docs/seed-format.md §3.
 */
export class Seed {
  readonly value: bigint;

  constructor(value: bigint) {
    this.value = value & MASK64;
  }

  /** Construct a Seed from a bigint, a number, or a decimal-integer string. */
  static from(input: bigint | number | string): Seed {
    if (typeof input === 'bigint') return new Seed(input);
    if (typeof input === 'number') return new Seed(BigInt(Math.floor(input)));
    return new Seed(BigInt(input));
  }

  /** Derive a deterministic child seed from a stable label. */
  child(label: string): Seed {
    return new Seed(splitmix64(this.value ^ hash64String(label)));
  }

  /** Construct a fresh PRNG from this seed (optional stream selector). */
  rng(sequence: bigint = 0n): Rng {
    return new Rng(new Pcg32(this.value, sequence));
  }

  toString(): string {
    return this.value.toString();
  }
}
