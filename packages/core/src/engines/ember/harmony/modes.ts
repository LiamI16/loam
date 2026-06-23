/**
 * Stage 7c modes. We do **mode drift without key drift** by re-centering
 * the tonic within the same diatonic-to-C chord pool — "modes of C." No
 * accidentals are introduced; the listener perceives mode flavor (a
 * Dorian-centered section sounds Dorian) without any key-signature
 * change. This is how modal jazz works in practice.
 *
 * Each mode is defined by:
 *   - `tonicChord` — the chord that functions as gravitational center
 *   - `tonicPc`    — its root pitch class
 *   - `chordWeights` — multiplier applied to Markov transition weights
 *                     when this mode is active. Tonic chord = 1.0,
 *                     diatonic-strong = 0.6–0.9, borrowed colors = 0
 *                     (excluded outside Aeolian which keeps them as
 *                     occasional borrowings)
 *   - `scalePcs`   — the canonical hexatonic for the mode (pent + the
 *                    one note that distinguishes this mode from its
 *                    neighbors on the brightness axis)
 *
 * Stage 7c.1 ships this module as a no-op data layer — `ChordScheduler`
 * still operates as if Aeolian were the only mode. 7c.2 wires position.x
 * → mode blending → reweighting + melody mode-awareness.
 */

import { mod12 } from '../util.js';
import type { ChordName } from './chords.js';
import { CHORD_NAMES } from './chords.js';

export type Mode = 'lydian' | 'ionian' | 'mixolydian' | 'dorian' | 'aeolian' | 'phrygian';

/** Canonical bright→dark order. Each adjacent pair differs by a single
 * scale-degree alteration (Lydian #4 → Ionian; Ionian b7 → Mixolydian;
 * etc.). Adjacent mode crossfade is musically smooth because the
 * gravitational-center shift is small. */
export const MODES_ORDER: readonly Mode[] = [
  'lydian',
  'ionian',
  'mixolydian',
  'dorian',
  'aeolian',
  'phrygian',
];

export interface ModePool {
  tonicChord: ChordName;
  /** Root pitch class of `tonicChord` (0–11). Cached so consumers don't
   * re-derive it from `CHORDS`. */
  tonicPc: number;
  /** Markov weight multipliers per chord. Missing = 0. Active mode's
   * weights multiply the base matrix row before sampling. */
  chordWeights: Readonly<Partial<Record<ChordName, number>>>;
  /** Hexatonic scale for the melody scheduler. Pent + the mode-
   * distinguishing note. All pcs stay within C major's key signature
   * (white keys only) — modes-of-C. */
  scalePcs: readonly number[];
}

/** Bm7b5 (the diatonic vii° of C / iv° of E Phrygian / vi° of D Dorian)
 * isn't in the Stage 6 chord vocab — those slots just get weight 0 in
 * the affected modes. Adding Bm7b5 later is a small vocab extension. */

export const MODE_POOLS: Readonly<Record<Mode, ModePool>> = {
  // F is tonic. The Cmaj7s11 in the vocab is literally the "Lydian I"
  // sound (C major with #11 = F#); we don't have F-rooted #11, but
  // Cmaj7s11 *appears* often in Lydian sections as the V chord, which
  // is one of the most characteristic Lydian gestures.
  lydian: {
    tonicChord: 'Fmaj9',
    tonicPc: 5,
    chordWeights: {
      Fmaj7: 0.9,
      Fmaj9: 1.0,
      G7: 0.6,
      G9: 0.7, // II — dominant flavor in Lydian
      Am7: 0.55,
      Am9: 0.55, // iii
      Cmaj7: 0.7,
      Cmaj9: 0.75,
      Cmaj7s11: 0.95, // V with Lydian #11 sound
      Dm7: 0.55,
      Dm9: 0.55, // vi
      Em7: 0.45, // vii
      Am11: 0.4,
    },
    scalePcs: [5, 7, 9, 11, 0, 4], // F G A B C E (B = Lydian #4 of F)
  },

  // C is tonic — the canonical major mode. Slow Cmaj7/9 vamping with
  // Dm7/G7 supports reads as "warm café piano," not nursery-rhyme major.
  ionian: {
    tonicChord: 'Cmaj9',
    tonicPc: 0,
    chordWeights: {
      Cmaj7: 0.95,
      Cmaj9: 1.0,
      Cmaj7s11: 0.7, // I
      Dm7: 0.75,
      Dm9: 0.7, // ii
      Em7: 0.55, // iii
      Fmaj7: 0.85,
      Fmaj9: 0.8, // IV
      G7: 0.85,
      G9: 0.85, // V
      Am7: 0.7,
      Am9: 0.65,
      Am11: 0.5, // vi
    },
    scalePcs: [0, 2, 4, 5, 7, 9], // C D E F G A (skip B — too tense as melody note)
  },

  // G is tonic, b7 = F (vs Ionian's F# — but we don't have F# anyway in
  // modes-of-C, so Mixolydian here is mostly about gravitational shift
  // toward G7).
  mixolydian: {
    tonicChord: 'G9',
    tonicPc: 7,
    chordWeights: {
      G7: 0.95,
      G9: 1.0, // I (dominant flavor as tonic = Mixolydian signature)
      Am7: 0.7,
      Am9: 0.7, // ii
      Cmaj7: 0.85,
      Cmaj9: 0.85, // IV
      Dm7: 0.65,
      Dm9: 0.65, // v (minor v = Mixolydian-distinctive vs Ionian's V)
      Em7: 0.55, // vi
      Fmaj7: 0.8,
      Fmaj9: 0.75, // bVII — the Mixolydian signature
      Am11: 0.5,
    },
    scalePcs: [7, 9, 11, 2, 4, 5], // G A B D E F (F = Mixolydian b7)
  },

  // D is tonic. Distinguished from Aeolian by B-natural (Dorian's 6 =
  // raised vs Aeolian's b6). Within modes-of-C, B is in the scale, so
  // the Dorian flavor comes through the chord weights favoring i-IV
  // (Dm-G) vs Aeolian's i-iv (Am-Dm).
  dorian: {
    tonicChord: 'Dm9',
    tonicPc: 2,
    chordWeights: {
      Dm7: 0.95,
      Dm9: 1.0, // i
      Em7: 0.6, // ii
      Fmaj7: 0.75,
      Fmaj9: 0.75, // bIII
      G7: 0.85,
      G9: 0.85, // IV — Dorian-signature major IV
      Am7: 0.7,
      Am9: 0.65, // v
      Cmaj7: 0.7,
      Cmaj9: 0.7,
      Cmaj7s11: 0.55, // bVII
      Am11: 0.4,
    },
    scalePcs: [2, 4, 5, 7, 9, 11], // D E F G A B (B = Dorian 6 of D)
  },

  // A is tonic — the engine's home mode and current Stage-6 default.
  // Aeolian retains the two borrowed colors (Fm6, Bbmaj7) as
  // occasional flavor; other modes exclude them entirely.
  aeolian: {
    tonicChord: 'Am7',
    tonicPc: 9,
    chordWeights: {
      Am7: 1.0,
      Am9: 0.9,
      Am11: 0.75, // i
      Cmaj7: 0.75,
      Cmaj9: 0.7,
      Cmaj7s11: 0.4, // bIII
      Dm7: 0.85,
      Dm9: 0.8, // iv
      Em7: 0.65, // v
      Fmaj7: 0.8,
      Fmaj9: 0.75, // bVI
      G7: 0.7,
      G9: 0.7, // bVII
      Fm6: 0.25, // borrowed iv (parallel minor flavor)
      Bbmaj7: 0.25, // borrowed bII / Neapolitan
    },
    scalePcs: [9, 0, 2, 4, 7, 5], // A C D E G F (F = Aeolian b6 vs Dorian)
  },

  // E is tonic, b2 = F. Spanish / dark. Em7 → Fmaj7 (i → bII) is the
  // archetypal Phrygian move — Fmaj7's weight stays high while G7's
  // (the bIII dominant) gets less love because the V function is
  // weak in Phrygian.
  phrygian: {
    tonicChord: 'Em7',
    tonicPc: 4,
    chordWeights: {
      Em7: 1.0, // i
      Fmaj7: 0.95,
      Fmaj9: 0.85, // bII — the Phrygian signature
      G7: 0.55,
      G9: 0.55, // bIII (as dom7 it pulls toward Cmaj — weak in Phrygian)
      Am7: 0.75,
      Am9: 0.7,
      Am11: 0.55, // iv
      Cmaj7: 0.5,
      Cmaj9: 0.5, // bVI
      Dm7: 0.6,
      Dm9: 0.6, // bVII
    },
    scalePcs: [4, 7, 9, 11, 2, 5], // E G A B D F (F = Phrygian b2 of E)
  },
};

/** A single mode contribution to the active blend. */
export interface ModeWeight {
  mode: Mode;
  weight: number;
}

/**
 * Map `position.x` (~[-1, 1]) to a list of active modes with weights.
 *
 * Aeolian is centered at x=0 (the engine's home). Brighter modes
 * (Lydian → Ionian → Mixolydian → Dorian) pack into x ∈ [-1, 0]; the
 * single darker mode (Phrygian) gets all of x ∈ (0, +1]. Asymmetric
 * but honest: lofi's home is minor, and the engine should spend most
 * time near Aeolian. Bright excursions are uncommon, dark excursions
 * (single mode) are common-but-not-dominant.
 *
 * Returns up to 2 modes (the dominant + nearest neighbor) with weights
 * summing to 1. Two-mode crossfade is enough — a 3-way blend on a
 * monophonic melody would dilute mode identity.
 */
export function modesAtPosition(x: number): ModeWeight[] {
  // Position knots (in canonical bright-to-dark order):
  //   -1.0 = lydian, -0.75 = ionian, -0.5 = mixolydian,
  //   -0.25 = dorian, 0.0 = aeolian, +1.0 = phrygian.
  const KNOTS: ReadonlyArray<readonly [number, Mode]> = [
    [-1.0, 'lydian'],
    [-0.75, 'ionian'],
    [-0.5, 'mixolydian'],
    [-0.25, 'dorian'],
    [0.0, 'aeolian'],
    [1.0, 'phrygian'],
  ];

  // Clamp to valid range.
  const cx = Math.max(-1, Math.min(1, x));

  // Find bracketing knots. Linear scan is fine — 6 entries.
  let lo = KNOTS[0] as readonly [number, Mode];
  let hi = KNOTS[KNOTS.length - 1] as readonly [number, Mode];
  for (let i = 0; i < KNOTS.length - 1; i++) {
    const a = KNOTS[i] as readonly [number, Mode];
    const b = KNOTS[i + 1] as readonly [number, Mode];
    if (cx >= a[0] && cx <= b[0]) {
      lo = a;
      hi = b;
      break;
    }
  }

  if (lo[0] === hi[0]) return [{ mode: lo[1], weight: 1 }];

  // Linear interpolation between the two adjacent knots' modes.
  const t = (cx - lo[0]) / (hi[0] - lo[0]);
  if (t <= 0) return [{ mode: lo[1], weight: 1 }];
  if (t >= 1) return [{ mode: hi[1], weight: 1 }];
  return [
    { mode: lo[1], weight: 1 - t },
    { mode: hi[1], weight: t },
  ];
}

/**
 * Combine per-mode chord weights into a single blended weight map by
 * `weight`-weighted sum. Chords missing from a mode are treated as 0
 * for that contribution.
 */
export function blendChordWeights(
  active: ModeWeight[],
): Readonly<Partial<Record<ChordName, number>>> {
  const out: Partial<Record<ChordName, number>> = {};
  for (const name of CHORD_NAMES) {
    let sum = 0;
    for (const { mode, weight } of active) {
      const w = MODE_POOLS[mode].chordWeights[name];
      if (w !== undefined) sum += w * weight;
    }
    if (sum > 0) out[name] = sum;
  }
  return out;
}

/**
 * The dominant mode at a position — the one with highest blend weight.
 * Used where a single-mode answer is needed (e.g. the melody scale
 * choice, which is hard to blend across modes without sounding
 * ambiguous).
 */
export function dominantModeAtPosition(x: number): Mode {
  const active = modesAtPosition(x);
  let best = active[0] as ModeWeight;
  for (let i = 1; i < active.length; i++) {
    const cur = active[i] as ModeWeight;
    if (cur.weight > best.weight) best = cur;
  }
  return best.mode;
}

/**
 * Materialize a mode's `scalePcs` as MIDI pitches over `[low, high]`,
 * ascending. The melody scheduler picks from this bag instead of the
 * fixed A-minor pentatonic. Range matches Stage 6's `PENT_MIDI`
 * (A4–C6) so the melody sits in the same register regardless of mode.
 */
export function modeMidiBag(mode: Mode, low = 69, high = 84): number[] {
  const pcs = MODE_POOLS[mode].scalePcs;
  const out: number[] = [];
  for (let p = low; p <= high; p++) {
    const pc = mod12(p);
    if (pcs.includes(pc)) out.push(p);
  }
  return out;
}
