const MASK64 = 0xffffffffffffffffn;

/**
 * Splitmix64 mixer. Pure 64-bit function: same input → same output, well-mixed.
 * Used as the basis for deriving sub-seeds in `Seed.child(label)`.
 * Not the stream PRNG for general use — that's `Pcg32`.
 * See docs/seed-format.md §3.
 */
export function splitmix64(input: bigint): bigint {
  let z = (input + 0x9e3779b97f4a7c15n) & MASK64;
  z = (((z ^ (z >> 30n)) & MASK64) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = (((z ^ (z >> 27n)) & MASK64) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}
