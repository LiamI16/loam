/**
 * Validators for chain flag values. Every knob crosses a URL/localStorage
 * boundary, so a malformed value must fall back to a default — never break or
 * silence audio. Centralized here so the tape stage and keys-crush don't each
 * hand-roll the same `typeof … && Number.isFinite …` guard.
 */

/** Finite and > 0, else `fallback`. */
export function posFiniteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Finite (any sign), else `fallback`. */
export function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Finite → rounded and clamped to `[lo, hi]`; else `fallback`. */
export function clampIntOr(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(Math.max(Math.round(v), lo), hi)
    : fallback;
}

/** Finite → clamped to `[lo, hi]` (no rounding); else `fallback`. */
export function clampOr(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback;
}
