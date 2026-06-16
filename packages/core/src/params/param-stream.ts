import type { Fbm1D } from '../noise/fbm.js';

/**
 * A time-varying parameter that the engine and sub-schedulers can sample
 * at any engine-time. See `docs/dynamics-brainstorm.md` for the motivation.
 *
 * Implementations:
 *  - `StaticParam` — constant; used for params that don't move yet
 *  - `FbmParam`    — fBm-driven motion around a (mutable) mean, with
 *                    seed-derived depth / base frequency
 */
export interface ParamStream {
  /** Sample the value at the given engine-time (seconds since play start). */
  evaluate(time: number): number;
}

/** A parameter that doesn't move. Returns `value` regardless of time. */
export class StaticParam implements ParamStream {
  constructor(public value: number) {}
  evaluate(): number {
    return this.value;
  }
}

export interface FbmParamOptions {
  /** Centerpoint the fBm motion oscillates around. Mutable via the public
   * field — UI sliders update this to change the parameter's setpoint
   * without disturbing the motion. */
  mean: number;
  /** Half-amplitude of the fBm motion. Output stays roughly in
   * `[mean - depth, mean + depth]`. Seed-derived in Stage 5+. */
  depth: number;
  /** Frequency multiplier applied to engine-time before sampling the
   * underlying fBm — controls how fast the parameter wanders. In Hz. */
  baseFreq: number;
  /** Optional hard clamp on output (sanity guard, e.g. don't let warmth
   * cutoff go negative). */
  minValue?: number;
  maxValue?: number;
}

/** A parameter that moves over time via fBm motion around a mutable mean. */
export class FbmParam implements ParamStream {
  /** Mutable. Update via UI sliders to shift the centerpoint without
   * disturbing the motion. */
  public mean: number;
  public readonly depth: number;
  public readonly baseFreq: number;
  public readonly minValue: number;
  public readonly maxValue: number;

  constructor(
    private readonly fbm: Fbm1D,
    opts: FbmParamOptions,
  ) {
    this.mean = opts.mean;
    this.depth = opts.depth;
    this.baseFreq = opts.baseFreq;
    this.minValue = opts.minValue ?? Number.NEGATIVE_INFINITY;
    this.maxValue = opts.maxValue ?? Number.POSITIVE_INFINITY;
  }

  evaluate(time: number): number {
    const noise = this.fbm.sample(time * this.baseFreq);
    const raw = this.mean + this.depth * noise;
    if (raw < this.minValue) return this.minValue;
    if (raw > this.maxValue) return this.maxValue;
    return raw;
  }
}
