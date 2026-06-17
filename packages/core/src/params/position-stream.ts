import { Fbm1D } from '../noise/fbm.js';
import type { Seed } from '../rng/seed.js';

/** A 2D position sampled from two independent slow fBm streams. The
 * macro "where are we in the seed's landscape" vector — Stage 7's
 * substrate (`docs/dynamics-brainstorm.md` §3, position-space framing).
 *
 * Both coords are roughly in `[-1, 1]` (the Fbm1D output range).
 * Consumers map each coord to whatever musical parameter they bias
 * (Stage 7a: y → voicing register center; future stages: x → mode,
 * etc.). The seed children driving x and y are independent, so motion
 * on one axis is uncorrelated with motion on the other.
 */
export interface PositionStreamOptions {
  /** Frequency multiplier applied to engine-time before sampling each
   * underlying fBm. Picks the slowest octave's period — with 3 octaves
   * and lacunarity 2, base 0.002 Hz gives the slowest motion an ~8-min
   * period, faster wobble layered on top. */
  baseFreq: number;
  /** How many fBm octaves per axis. Default 3 — gives multi-scale
   * motion (slow drift + faster wobble) without becoming noise. */
  octaves?: number;
}

export interface Position {
  x: number;
  y: number;
}

export class PositionStream {
  private readonly fbmX: Fbm1D;
  private readonly fbmY: Fbm1D;
  private readonly baseFreq: number;

  constructor(seed: Seed, opts: PositionStreamOptions) {
    const octaves = opts.octaves ?? 3;
    this.fbmX = new Fbm1D(seed.child('position-x'), { octaves });
    this.fbmY = new Fbm1D(seed.child('position-y'), { octaves });
    this.baseFreq = opts.baseFreq;
  }

  evaluate(time: number): Position {
    const t = time * this.baseFreq;
    return { x: this.fbmX.sample(t), y: this.fbmY.sample(t) };
  }
}
