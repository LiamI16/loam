import type { Rng } from '../../../rng/rng.js';
import { CHORD_NAMES, type ChordName } from './chords.js';

/**
 * Hand-tuned Markov transition matrix over the Stage-6 chord vocabulary.
 * Each row is `from → { to: relativeWeight }`. Weights are unnormalized —
 * the walk normalizes per row at sample time, so adding/removing edges
 * doesn't require rebalancing.
 *
 * Bias is per `docs/lofi-study.md` §3:
 *   - Strong i↔IV / I↔IV modal vamps (Dm7↔G…, Cmaj7↔Fmaj7).
 *   - ii→V→I cells common but soft (G7→Cmaj7 not so likely it dominates).
 *   - vi→IV→I a workhorse.
 *   - Borrowed colors (Fm6, Bbmaj7, Cmaj7s11) reachable but uncommon, and
 *     mostly returnable to the diatonic core in one step.
 *   - Self-loops nonzero on tonics, biasing "stay" over "wander."
 */
export type TransitionRow = Partial<Record<ChordName, number>>;
export type TransitionMatrix = Readonly<Record<ChordName, TransitionRow>>;

export const HAND_MATRIX: TransitionMatrix = {
  // Tonic majors — favored "return" targets. Many paths land here.
  Cmaj7: {
    Am7: 0.3,
    Fmaj7: 0.25,
    Dm7: 0.15,
    Em7: 0.1,
    Cmaj9: 0.08,
    Fmaj9: 0.05,
    Cmaj7s11: 0.04,
    Am9: 0.03,
  },
  Cmaj9: { Fmaj9: 0.3, Am9: 0.25, Dm9: 0.15, Cmaj7: 0.15, Em7: 0.08, Fmaj7: 0.05, Cmaj7s11: 0.02 },
  Cmaj7s11: { Fmaj9: 0.4, Cmaj7: 0.25, Am9: 0.15, Dm9: 0.1, Fmaj7: 0.1 },
  // ii — predominant. Strong pull to V or back to I.
  Dm7: { G7: 0.35, Cmaj7: 0.2, Am7: 0.15, Em7: 0.1, G9: 0.08, Fmaj7: 0.07, Dm9: 0.05 },
  Dm9: { G9: 0.3, Cmaj9: 0.2, Am9: 0.15, Dm7: 0.1, G7: 0.1, Fmaj9: 0.1, Em7: 0.05 },
  // iii — soft, often a passing chord to vi or IV.
  Em7: { Am7: 0.35, Dm7: 0.2, Fmaj7: 0.15, Cmaj7: 0.1, Am9: 0.1, Dm9: 0.05, Em7: 0.05 },
  // IV — the other half of the modal vamp.
  Fmaj7: { Cmaj7: 0.3, Em7: 0.2, Dm7: 0.15, Bbmaj7: 0.1, Fmaj9: 0.1, Am7: 0.1, Fm6: 0.05 },
  Fmaj9: {
    Cmaj9: 0.3,
    Em7: 0.15,
    Dm9: 0.15,
    Fmaj7: 0.1,
    Am9: 0.1,
    Bbmaj7: 0.1,
    Cmaj7s11: 0.05,
    Fm6: 0.05,
  },
  // V — dominant. Most often resolves to I or vi, but lofi softens this.
  G7: { Cmaj7: 0.35, Am7: 0.2, Em7: 0.1, Dm7: 0.15, G9: 0.1, Cmaj9: 0.05, Fmaj7: 0.05 },
  G9: { Cmaj9: 0.3, Am9: 0.2, Em7: 0.1, Dm9: 0.15, G7: 0.1, Cmaj7: 0.1, Fmaj9: 0.05 },
  // vi — relative minor tonic, the lofi home.
  Am7: {
    Dm7: 0.25,
    Fmaj7: 0.2,
    Cmaj7: 0.15,
    Em7: 0.15,
    Am9: 0.1,
    Am11: 0.08,
    G7: 0.05,
    Bbmaj7: 0.02,
  },
  Am9: { Dm9: 0.25, Fmaj9: 0.2, Cmaj9: 0.15, Em7: 0.1, Am7: 0.1, Am11: 0.1, G9: 0.05, Fmaj7: 0.05 },
  Am11: { Dm9: 0.3, Fmaj9: 0.2, Am9: 0.2, Cmaj9: 0.15, Em7: 0.1, Am7: 0.05 },
  // Borrowed colors — return to the diatonic core quickly.
  Fm6: { Cmaj7: 0.4, Fmaj7: 0.25, Cmaj9: 0.15, Bbmaj7: 0.1, Am7: 0.1 },
  Bbmaj7: { Fmaj7: 0.3, Cmaj7: 0.25, Am7: 0.15, Fmaj9: 0.15, Fm6: 0.1, Cmaj9: 0.05 },
};

/**
 * Stateful walk over a `TransitionMatrix`. Draws each step from its own
 * `Rng` (one per walk instance). Starts at a configurable chord — default
 * Am7, the lofi home (relative minor tonic).
 *
 * Edge case: if a row has been Dirichlet-perturbed to all-zero weights
 * (vanishingly unlikely with alpha=20 but mathematically possible), the
 * walk falls back to a uniform pick over all vocabulary entries to keep
 * the chain from getting stuck.
 */
export class MarkovChordWalk {
  private current: ChordName;
  private readonly matrix: TransitionMatrix;
  private readonly rng: Rng;

  constructor(matrix: TransitionMatrix, rng: Rng, start: ChordName = 'Am7') {
    this.matrix = matrix;
    this.rng = rng;
    this.current = start;
  }

  /** Current chord (the one that *will* play; not yet stepped past). */
  peek(): ChordName {
    return this.current;
  }

  /** Step the chain, return the new current. */
  next(): ChordName {
    const row = this.matrix[this.current];
    const entries = Object.entries(row) as [ChordName, number][];
    const total = entries.reduce((s, [, w]) => s + (w > 0 ? w : 0), 0);
    if (total <= 0) {
      this.current = this.rng.pick(CHORD_NAMES);
      return this.current;
    }
    let u = this.rng.nextFloat() * total;
    for (const [name, w] of entries) {
      if (w <= 0) continue;
      u -= w;
      if (u <= 0) {
        this.current = name;
        return this.current;
      }
    }
    // Float drift fallback: take the last positive entry.
    const last = entries.reverse().find(([, w]) => w > 0);
    this.current = last ? last[0] : this.rng.pick(CHORD_NAMES);
    return this.current;
  }
}
