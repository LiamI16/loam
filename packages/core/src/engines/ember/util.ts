/** Shared numeric helpers for the ember schedulers. Small, pure, and
 * behavior-defining — extracted so the bass/chord/drum schedulers share
 * one definition rather than re-deriving these in each file. */

/** Positive modulo 12. Pitch class of a MIDI note, or interval class of
 * a semitone difference — always in `[0, 12)`, unlike `%` for negatives. */
export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Clamp to `[0, 1]`. Used for note velocities / normalized amplitudes. */
export function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** MIDI pitch in `[low, high]` with pitch class `pc`, nearest to `target`.
 * Returns -1 if no pitch in the range has that class. */
export function nearestPitchClassInRange(
  pc: number,
  target: number,
  low: number,
  high: number,
): number {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let p = low; p <= high; p++) {
    if (mod12(p) !== pc) continue;
    const d = Math.abs(p - target);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
