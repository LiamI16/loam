import type { Seed } from '../rng/seed.js';
import { ValueNoise1D } from './value-noise.js';

export interface FbmOptions {
  /** How many octaves to sum. More = more textural detail. Default 4. */
  octaves?: number;
  /** Amplitude multiplier per octave (< 1 = higher octaves quieter).
   * Classic value 0.5 yields a 1/f-ish spectrum. */
  persistence?: number;
  /** Frequency multiplier per octave. Classic value 2.0 (each octave is
   * twice as fast as the previous). */
  lacunarity?: number;
}

/**
 * Fractional Brownian motion in 1D — sum of multiple `ValueNoise1D`
 * octaves. The result approximates the 1/f spectrum that
 * `docs/dynamics-brainstorm.md` §1.4 calls out as the target for
 * "musical-feeling" parameter motion.
 *
 * Output is normalized so the sum of amplitudes is 1, keeping the range
 * roughly in [-1, 1] regardless of `octaves` / `persistence`.
 */
export class Fbm1D {
  private readonly noise: ValueNoise1D;
  private readonly octaves: number;
  private readonly persistence: number;
  private readonly lacunarity: number;
  private readonly normalizer: number;

  constructor(seed: Seed, opts: FbmOptions = {}) {
    this.octaves = opts.octaves ?? 4;
    this.persistence = opts.persistence ?? 0.5;
    this.lacunarity = opts.lacunarity ?? 2.0;
    this.noise = new ValueNoise1D(seed);

    let s = 0;
    let amp = 1;
    for (let i = 0; i < this.octaves; i++) {
      s += amp;
      amp *= this.persistence;
    }
    this.normalizer = 1 / s;
  }

  /** Sample fBm at position x. Returns ~[-1, 1]. */
  sample(x: number): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    for (let i = 0; i < this.octaves; i++) {
      sum += this.noise.sample(x * freq) * amp;
      amp *= this.persistence;
      freq *= this.lacunarity;
    }
    return sum * this.normalizer;
  }
}
