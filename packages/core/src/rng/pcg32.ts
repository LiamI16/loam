const MASK64 = 0xffffffffffffffffn;
const MASK32 = 0xffffffff;
const MULT = 6364136223846793005n;

/**
 * PCG32 stream PRNG — 64-bit internal state, 32-bit output, ~50 lines.
 * Reference: https://www.pcg-random.org/  ·  spec: docs/seed-format.md §2.
 */
export class Pcg32 {
  private state = 0n;
  private readonly inc: bigint;

  /**
   * @param seed       64-bit seed value
   * @param sequence   independent stream selector (0 by default)
   */
  constructor(seed: bigint, sequence = 0n) {
    this.inc = (((sequence & MASK64) << 1n) | 1n) & MASK64;
    this.nextUint32();
    this.state = (this.state + (seed & MASK64)) & MASK64;
    this.nextUint32();
  }

  /** Next uniform 32-bit unsigned integer. */
  nextUint32(): number {
    const oldstate = this.state;
    this.state = (oldstate * MULT + this.inc) & MASK64;
    const xorshifted = Number(((oldstate >> 18n) ^ oldstate) >> 27n) & MASK32;
    const rot = Number(oldstate >> 59n) & 31;
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** Snapshot internal state for save/resume. */
  snapshot(): { state: bigint; inc: bigint } {
    return { state: this.state, inc: this.inc };
  }
}
