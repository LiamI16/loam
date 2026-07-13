import { Fbm1D } from '../../noise/fbm.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState } from './ember.js';

/**
 * Arrangement controller — the layer that makes the engine *breathe*
 * (docs/arrangement.md). Instead of every instrument playing forever, whole
 * instrument roles mute and unmute at 8-bar phrase boundaries. Pad (+ brown
 * bed + crackle) is the always-on floor; bass / chords / melody / drums are
 * arrangement-controlled.
 *
 * Model — **A2 event/dropout** (settled 2026-07-11; supersedes the occupancy
 * Markov walk, which had *unbounded* per-instrument absence because a 1/f
 * energy trough could pin the walk in the sparse-state cluster arbitrarily
 * long). At each boundary exactly **one** move is chosen — hold, drop one
 * on-role, or restore one off-role:
 *   - **Cox servo:** a slow universal energy fBm sets a *target fullness*; the
 *     sign of `target − current` biases drop-vs-restore. The contour drives
 *     *how full / how often*, **never** a duration.
 *   - **Hard per-role deadline:** each dropped role carries a bounded restore
 *     deadline `K_role`; once its (distance-aware) slack runs out the walk is
 *     *forced* to move it back. This is what bounds contiguous absence **by
 *     construction** (the acceptance gate) — a generalization of the interim
 *     melody-only refractory to every role.
 *   - **Palette as a legal-combo filter:** moves are restricted to the vetted
 *     palette's single-role adjacency graph, so illegal combos are never
 *     reachable and serialization (≤1 change/boundary) is structural.
 *   - **Hysteresis:** a just-restored role can't drop again for a few phrases
 *     (anti-chatter).
 *   - **Per-seed identity:** a favored-to-drop weight vector (which roles a
 *     seed thins first, melody signature-protected) + a restlessness scalar
 *     (change frequency).
 *
 * Palette is the **6-state** subset of the original curated palette — the two
 * deepest states (`lead-breather`, `deep-breather`, i.e. bass-absent
 * near-silence) are pruned: they're the only states that break the airtight
 * per-role bound (bass-absent spans reachable only via multi-role detours) and
 * v1 defers deliberate deep near-silence anyway (docs/arrangement.md decision
 * F). With them gone bass is always present, every role's BFS distance to a
 * present-state is ≤2, and the graph stays fully connected.
 *
 * Fingerprint-safe: every seed **opens at FULL** (phrase 0), all seed children
 * are named/independent, and a FULL mask is a no-op for the composition-point
 * filter — so the 5 s `Seed.from(42n)` window is byte-identical. Arrangement is
 * a non-breaking additive change.
 */

export type Role = 'bass' | 'chords' | 'melody' | 'drums';

/** Bit order for every state's `bits` tuple: (bass, chords, melody, drums);
 * pad is implicit-always and not represented. */
export const ROLES: readonly Role[] = ['bass', 'chords', 'melody', 'drums'];

/** A phrase's active-role set. Readonly — consumers only test membership. */
export type ArrangementMask = ReadonlySet<Role>;

export interface ArrangementStateDef {
  readonly name: string;
  /** (bass, chords, melody, drums), 1 = active. */
  readonly bits: readonly [number, number, number, number];
  /** Active-instrument count / 4 — the energy-servo target axis. */
  readonly fullness: number;
}

/** The 6-state palette (docs/arrangement.md "Palette"). Index 0 = FULL is the
 * fingerprint-preserving open. Index order is load-bearing: it matches
 * ADJACENCY. The original `lead-breather`/`deep-breather` are pruned (see the
 * class doc + decision F). */
export const STATES: readonly ArrangementStateDef[] = [
  { name: 'FULL', bits: [1, 1, 1, 1], fullness: 1.0 },
  { name: 'no-melody', bits: [1, 1, 0, 1], fullness: 0.75 },
  { name: 'drums-out', bits: [1, 1, 1, 0], fullness: 0.75 },
  { name: 'pocket', bits: [1, 0, 0, 1], fullness: 0.5 },
  { name: 'warm', bits: [1, 1, 0, 0], fullness: 0.5 },
  { name: 'bass-breather', bits: [1, 0, 0, 0], fullness: 0.25 },
];

/** Single-role-move adjacency (the palette legal-combo filter; verified
 * connected over the 6 states). Row i lists state indices reachable from i. */
export const ADJACENCY: readonly (readonly number[])[] = [
  [1, 2], // FULL        → no-melody (drop m), drums-out (drop d)
  [0, 3, 4], // no-melody → FULL (+m), pocket (drop c), warm (drop d)
  [0, 4], // drums-out    → FULL (+d), warm (drop m)
  [1, 5], // pocket       → no-melody (+c), bass-breather (drop d)
  [1, 2, 5], // warm      → no-melody (+d), drums-out (+m), bass-breather (drop c)
  [3, 4], // bass-breather→ pocket (+d), warm (+c)
];

/** Grid: every mute/unmute lands on an 8-bar hypermetric downbeat
 * (decision B). Fixed, not per-seed. */
export const PHRASE_BARS = 8;

// ── Per-role hard absence ceilings K_max (phrases). The acceptance gate
//    (arrangement-absence.test.ts) asserts contiguous absence stays within
//    these. Ordered by musical tolerance: drums most droppable, chords/bass
//    least (bass is in fact never dropped in the 6-state palette). Per-seed
//    K_role is drawn in [1, K_max]; the ceiling is the universal bound. ──
const K_MAX: Readonly<Record<Role, number>> = {
  bass: 2, // never actually absent in the 6-state palette; kept for generality
  chords: 2, // 52 s worst-case; pad holds harmony underneath
  melody: 3, // 78 s worst-case; signature layer
  drums: 4, // 104 s worst-case; most droppable ("drums-out" is the lofi move)
};

// ── Per-seed presence-bias (favored-to-drop). Reused verbatim from the old
//    model's `arrangement-presence-bias` child (same draw ⇒ fingerprint of
//    that child unchanged). Higher bias ⇒ role more present ⇒ dropped less /
//    restored sooner. Applied to move selection, not a stationary. ──
/** Presence-bias half-width (multiplicative, symmetric in log). Provisional
 * M=1.6 carried from the old sweep; re-validated for A2 by
 * scripts/arrangement-validate.ts (distinctness *and* sojourn). */
const PRESENCE_BIAS_M = 1.6;
/** Melody uses a smaller downside (floor ≈ 0.83) — signature-protect
 * guardrail: never systematically hide the germ. */
const MELODY_BIAS_U_LO = -0.4;

// ── Restlessness (change frequency). Per-seed hold weight: bigger ⇒ the walk
//    holds longer ⇒ fewer changes. Range tuned so mean time-between-changes
//    spans ~45 s (restless) … ~150 s (stable), median ~90 s @74 BPM (decision
//    D; validated in scripts/arrangement-validate.ts). ──
const HOLD_WEIGHT_LO = 4.0; // restless seed
const HOLD_WEIGHT_HI = 22.0; // stable seed

/** Anti-chatter hysteresis: a role that just restored can't drop again for
 * this many phrases (decision D). */
const HYSTERESIS_PHRASES = 2;

// ── Energy contour (the Cox servo). One universal fBm, slowest octave ~4 min;
//    per-seed identity here is only the *phase* (contour is timing, not
//    per-seed amount). ──
const ENERGY_BASE_FREQ = 1 / 330;
/** Target-fullness center + swing: f_target = clamp01(center + swing·noise)
 * (decision C: center 0.70, trough ~0.42, peak FULL). */
const TARGET_CENTER = 0.7;
const TARGET_SWING = 0.28;
/** Boltzmann servo strength — how sharply move selection prefers neighbours
 * whose fullness matches the target. [taste], tuned offline. */
const SERVO_K = 5;

const N = STATES.length;
const ROLE_COUNT = ROLES.length;

/** Bits as index lookup. */
function bit(state: number, role: number): number {
  return (STATES[state] as ArrangementStateDef).bits[role] as number;
}

/** Does state `s` contain every role in bitmask `required`? */
function isSuperset(s: number, required: number): boolean {
  let sBits = 0;
  for (let r = 0; r < ROLE_COUNT; r++) if (bit(s, r)) sBits |= 1 << r;
  return (sBits & required) === required;
}

/** Build a mask (active-role set) from a state index. */
function maskFromState(state: number): ArrangementMask {
  const set = new Set<Role>();
  for (let i = 0; i < ROLE_COUNT; i++) if (bit(state, i)) set.add(ROLES[i] as Role);
  return set;
}

const STATE_MASKS: readonly ArrangementMask[] = STATES.map((_, i) => maskFromState(i));

/** The FULL mask (all roles) — the always-open default. */
export const FULL_MASK: ArrangementMask = STATE_MASKS[0] as ArrangementMask;

/**
 * Per-seed presence-bias vector `b = (bass, chords, melody, drums)`. Each
 * component drawn log-uniform, multiplicatively symmetric around 1.0:
 * `b = exp(u·ln M)`, `u ~ uniform[−1, 1]` (melody uses `[−0.4, 1]`). Higher ⇒
 * role favoured present.
 */
export function drawPresenceBias(seed: Seed): number[] {
  const rng = seed.child('arrangement-presence-bias').rng();
  const lnM = Math.log(PRESENCE_BIAS_M);
  return ROLES.map((_, i) => {
    const u = i === 2 ? rng.nextRange(MELODY_BIAS_U_LO, 1) : rng.nextRange(-1, 1);
    return Math.exp(u * lnM);
  });
}

export class ArrangementController {
  private readonly energyFbm: Fbm1D;
  private readonly energyPhase: number;
  private readonly bias: number[];
  private readonly holdWeight: number;
  private readonly barDuration: number;
  private readonly phraseDuration: number;
  /** Per-role restore deadline in phrases (from `K_MAX`, per-seed in [1,K]). */
  private readonly capPhrases: number[];
  private walkRng: ReturnType<Seed['rng']>;

  /** Cached per-phrase state indices, computed lazily in order. Phrase 0 is
   * always FULL (index 0) — the fingerprint-preserving open. */
  private readonly phraseStates: number[] = [0];

  constructor(
    private readonly seed: Seed,
    private readonly state: EngineState,
    secondsPerBeat: number,
  ) {
    this.barDuration = 4 * secondsPerBeat;
    this.phraseDuration = PHRASE_BARS * this.barDuration;

    this.bias = drawPresenceBias(seed);

    // Per-seed restore deadlines: drawn in [1, K_max] per role. The ceiling is
    // the universal bound the gate asserts; the draw gives per-seed depth.
    const capRng = seed.child('arrangement-caps').rng();
    this.capPhrases = ROLES.map((r) => {
      const kmax = K_MAX[r as Role];
      return kmax <= 1 ? 1 : capRng.nextInt(1, kmax); // inclusive [1, kmax]
    });

    // Restlessness → hold weight (change frequency, decision D).
    this.holdWeight = seed
      .child('arrangement-frequency')
      .rng()
      .nextRange(HOLD_WEIGHT_LO, HOLD_WEIGHT_HI);

    // Energy contour: one universal fBm (per-seed identity = phase only).
    this.energyFbm = new Fbm1D(seed.child('arrangement-energy-fbm'));
    this.energyPhase = seed.child('arrangement-energy-config').rng().nextRange(0, 10000);

    this.walkRng = seed.child('arrangement-walk').rng();

    // Wire the query into shared state; schedulers read it per emission.
    state.arrangementMaskAt = (t: number) => this.maskAt(t);
    state.phraseBar = 0;
  }

  /** Runs first in `EmberEngine.scheduleUntil`. Maintains the phrase-bar clock
   * and pre-warms phrase decisions up to `engineUntil` (so the mask query never
   * lazily computes a walk step out of RNG order). */
  advance(_engineFrom: number, engineUntil: number): void {
    const k = Math.max(0, Math.floor(engineUntil / this.phraseDuration));
    this.ensurePhrase(k);
    this.state.phraseBar = Math.floor(engineUntil / this.barDuration) % PHRASE_BARS;
  }

  /** Active-role mask at engine-time `time`. Phrase-accurate regardless of call
   * order (decisions are cached by phrase index, computed once each). */
  maskAt(time: number): ArrangementMask {
    const k = time <= 0 ? 0 : Math.floor(time / this.phraseDuration);
    this.ensurePhrase(k);
    return STATE_MASKS[this.phraseStates[k] as number] as ArrangementMask;
  }

  reset(): void {
    this.phraseStates.length = 1;
    this.phraseStates[0] = 0;
    this.state.phraseBar = 0;
    this.walkRng = this.seed.child('arrangement-walk').rng();
  }

  /** Extend the cached phrase-state list up to and including index `k`, walking
   * one transition per new phrase (each consumes exactly one roll from
   * `walkRng`, in order — so the stream is call-order-independent). */
  private ensurePhrase(k: number): void {
    while (this.phraseStates.length <= k) {
      const idx = this.phraseStates.length;
      const prev = this.phraseStates[idx - 1] as number;
      this.phraseStates.push(this.walkNext(prev, idx));
    }
  }

  /** Consecutive phrases (ending at `prev`) for which `role` was absent /
   * present. Scans the cached history back from the previous phrase. */
  private run(prevIdx: number, role: number, absent: boolean): number {
    let n = 0;
    for (let i = prevIdx; i >= 0; i--) {
      const present = bit(this.phraseStates[i] as number, role) === 1;
      if (present === !absent) n++;
      else break;
    }
    return n;
  }

  /**
   * Choose the next state from `prev` at phrase `idx`. Consumes exactly one
   * `walkRng` roll (RNG-stream stable regardless of branch). Order:
   *   1. **Hard deadline (airtight bound)** — any absent role whose absence run
   *      has reached `capPhrases[role]` *must* return this boundary. All such
   *      due roles are restored at once by jumping to the lowest-fullness legal
   *      palette state that is a superset of `present(prev) ∪ due` (a rare
   *      multi-restore — the sanctioned exception to ≤1 change/boundary;
   *      decision A). This makes each role's contiguous absence **exactly ≤
   *      capPhrases[role] by construction** — no competing-deadline starvation,
   *      the failure mode of a one-role-at-a-time return.
   *   2. **Cox servo** — otherwise weight {hold} ∪ {legal neighbours} by a
   *      Boltzmann tilt toward the energy target fullness × a per-seed
   *      favoured-to-drop factor, minus hysteresis-excluded drops; sample.
   */
  private walkNext(prev: number, idx: number): number {
    const roll = this.walkRng.nextFloat();

    // (1) Hard deadline: collect roles that would exceed their cap if not
    // restored now (absence run already == cap), plus prev's present roles.
    let required = 0;
    let due = false;
    for (let r = 0; r < ROLE_COUNT; r++) {
      if (bit(prev, r)) {
        required |= 1 << r;
      } else if (this.run(idx - 1, r, true) >= (this.capPhrases[r] as number)) {
        required |= 1 << r;
        due = true;
      }
    }
    if (due) return this.nearestSuperset(required, roll);

    // (2) Cox servo. "Hold" is the current state tilted by the same Boltzmann
    // servo (so the walk *tracks* the target fullness rather than parking where
    // it started) × a per-seed persistence factor (dwell / change frequency).
    const target = this.energyTarget(idx * this.phraseDuration);
    const fPrev = (STATES[prev] as ArrangementStateDef).fullness;
    const holdW = this.holdWeight * Math.exp(-SERVO_K * Math.abs(fPrev - target));
    const neighbours = ADJACENCY[prev] as readonly number[];
    const weights: { to: number; w: number }[] = [{ to: prev, w: holdW }];
    let sum = holdW;
    for (const j of neighbours) {
      // Identify the single role that changed and its direction.
      let changedRole = -1;
      let isDrop = false;
      for (let r = 0; r < ROLE_COUNT; r++) {
        if (bit(prev, r) !== bit(j, r)) {
          changedRole = r;
          isDrop = bit(prev, r) === 1; // present→absent
          break;
        }
      }
      // Hysteresis: a just-restored role may not drop again yet.
      if (isDrop && this.run(idx - 1, changedRole, false) < HYSTERESIS_PHRASES) continue;

      const b = this.bias[changedRole] as number;
      const favour = isDrop ? 1 / b : b; // drop favoured roles less; restore sooner
      const fj = (STATES[j] as ArrangementStateDef).fullness;
      const w = Math.exp(-SERVO_K * Math.abs(fj - target)) * favour;
      weights.push({ to: j, w });
      sum += w;
    }

    let acc = 0;
    for (const { to, w } of weights) {
      acc += w / sum;
      if (roll < acc) return to;
    }
    return prev;
  }

  /** Lowest-fullness palette state containing every role in bitmask
   * `required`. FULL is always a superset, so one always exists. Among equal-
   * fullness candidates, `roll` breaks the tie (directed but not deterministic
   * which bonus role a jump-up adds). */
  private nearestSuperset(required: number, roll: number): number {
    const cands: number[] = [];
    let best = Number.POSITIVE_INFINITY;
    for (let s = 0; s < N; s++) {
      if (!isSuperset(s, required)) continue;
      const f = (STATES[s] as ArrangementStateDef).fullness;
      if (f < best) {
        best = f;
        cands.length = 0;
        cands.push(s);
      } else if (f === best) {
        cands.push(s);
      }
    }
    return cands[Math.floor(roll * cands.length)] ?? 0;
  }

  /** Map the slow energy fBm → target fullness ∈ [0, 1] (decision C). */
  private energyTarget(time: number): number {
    const noise = this.energyFbm.sample((time + this.energyPhase) * ENERGY_BASE_FREQ);
    const target = TARGET_CENTER + TARGET_SWING * noise;
    return target < 0 ? 0 : target > 1 ? 1 : target;
  }
}
