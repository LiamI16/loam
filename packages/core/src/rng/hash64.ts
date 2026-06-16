const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/**
 * 64-bit FNV-1a hash over the UTF-16 code units of a string.
 * Stable across platforms. Used only for hashing label strings
 * when deriving sub-seeds in `Seed.child(label)`.
 *
 * Seed labels are dev-controlled identifiers (see docs/seed-format.md §3) —
 * hashing code units rather than UTF-8 bytes is fine for our use and avoids
 * pulling `TextEncoder` (and therefore DOM/Node lib types) into core.
 */
export function hash64String(s: string): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    hash = (hash ^ BigInt(s.charCodeAt(i))) & MASK64;
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash;
}
