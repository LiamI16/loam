import { describe, expect, it } from 'vitest';
import {
  ADJACENCY,
  applyLaziness,
  biasedStationary,
  buildMHMatrix,
  drawPresenceBias,
  powerIterationStationary,
  ROLES,
  STATES,
} from '../src/engines/ember/arrangement-controller.js';
import { EmberEngine, Seed } from '../src/index.js';

/** L1 distance between two equal-length vectors. */
function l1(a: readonly number[], b: readonly number[]): number {
  return a.reduce((s, v, i) => s + Math.abs(v - (b[i] as number)), 0);
}

describe('ArrangementController numerics', () => {
  it('base π sums to 1 and palette is internally consistent', () => {
    const sum = STATES.reduce((s, st) => s + st.basePi, 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const st of STATES) {
      const active = st.bits.reduce((a, b) => a + b, 0);
      expect(st.fullness).toBeCloseTo(active / 4, 9);
      expect(st.bits.length).toBe(ROLES.length);
    }
  });

  it('adjacency is symmetric and single-instrument (Hamming distance 1)', () => {
    for (let i = 0; i < STATES.length; i++) {
      for (const j of ADJACENCY[i] as readonly number[]) {
        // symmetric
        expect((ADJACENCY[j] as readonly number[]).includes(i)).toBe(true);
        // differ by exactly one instrument
        const bi = (STATES[i] as { bits: readonly number[] }).bits;
        const bj = (STATES[j] as { bits: readonly number[] }).bits;
        const hamming = bi.reduce((s, b, k) => s + (b === bj[k] ? 0 : 1), 0);
        expect(hamming).toBe(1);
      }
    }
  });

  it('MH matrix has exactly π as its stationary (no drift), across seeds', () => {
    for (const raw of [42n, 7n, 1000n, 999983n, 3n]) {
      const seed = Seed.from(raw);
      const bias = drawPresenceBias(seed);
      const pi = biasedStationary(bias);
      const lambda = seed.child('arrangement-frequency').rng().nextRange(0.5, 0.86);
      const P = applyLaziness(buildMHMatrix(pi), lambda);
      // rows stochastic
      for (const row of P) {
        expect(row.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
        for (const v of row) expect(v).toBeGreaterThanOrEqual(-1e-12);
      }
      const stat = powerIterationStationary(P);
      // Presence-bias-not-Dirichlet ⇒ stationary is the *exact* target π'.
      expect(l1(stat, pi)).toBeLessThan(1e-9);
    }
  });

  it('laziness preserves the stationary but lengthens dwell', () => {
    const seed = Seed.from(12345n);
    const pi = biasedStationary(drawPresenceBias(seed));
    const base = buildMHMatrix(pi);
    const lazy = applyLaziness(base, 0.8);
    // same stationary
    expect(l1(powerIterationStationary(base), powerIterationStationary(lazy))).toBeLessThan(1e-9);
    // every self-loop grows (dwell up)
    for (let i = 0; i < STATES.length; i++) {
      expect((lazy[i] as number[])[i] as number).toBeGreaterThan(
        (base[i] as number[])[i] as number,
      );
    }
  });

  it('every state is reachable from every state (chain is irreducible)', () => {
    const seed = Seed.from(555n);
    const P = applyLaziness(buildMHMatrix(biasedStationary(drawPresenceBias(seed))), 0.7);
    const n = STATES.length;
    // BFS reachability over positive-probability edges.
    for (let start = 0; start < n; start++) {
      const seen = new Set<number>([start]);
      const queue = [start];
      while (queue.length) {
        const u = queue.shift() as number;
        for (let v = 0; v < n; v++) {
          if ((P[u] as number[])[v]! > 0 && !seen.has(v)) {
            seen.add(v);
            queue.push(v);
          }
        }
      }
      expect(seen.size).toBe(n);
    }
  });

  it('mean dwell between state changes lands ~1–2 min at 74 BPM', () => {
    // 1 / Σ π_i (1 − P_ii) phrases between any change; phrase = 8 bars.
    const spb = 60 / 74;
    const phraseSec = 8 * 4 * spb;
    for (const raw of [42n, 7n, 100n, 2024n]) {
      const seed = Seed.from(raw);
      const pi = biasedStationary(drawPresenceBias(seed));
      const lambda = seed.child('arrangement-frequency').rng().nextRange(0.5, 0.86);
      const P = applyLaziness(buildMHMatrix(pi), lambda);
      const stat = powerIterationStationary(P);
      const leaveRate = stat.reduce(
        (a, v, i) => a + v * (1 - ((P[i] as number[])[i] as number)),
        0,
      );
      const dwellSec = (1 / leaveRate) * phraseSec;
      // Validation harness measured p5–p95 ≈ 82 s … 260 s.
      expect(dwellSec).toBeGreaterThan(60);
      expect(dwellSec).toBeLessThan(300);
    }
  });
});

describe('ArrangementController integration', () => {
  it('opens at FULL: the first phrase (~26 s @74) mutes nothing', () => {
    const e = new EmberEngine(Seed.from(42n), { bpm: 74 });
    const state = (e as unknown as { state: { arrangementMaskAt(t: number): ReadonlySet<string> } })
      .state;
    // Phrase 0 spans [0, 8 bars). Every role present throughout.
    for (const t of [0, 5, 15, 25]) {
      const mask = state.arrangementMaskAt(t);
      for (const r of ROLES) expect(mask.has(r)).toBe(true);
    }
  });

  it('breathes below FULL later in a session (seed reaches a muted state)', () => {
    // Walk far enough that at least one phrase drops a role for some seed.
    const e = new EmberEngine(Seed.from(7n), { bpm: 74 });
    e.scheduleUntil(1);
    const state = (e as unknown as { state: { arrangementMaskAt(t: number): ReadonlySet<string> } })
      .state;
    let sawMute = false;
    for (let t = 0; t < 3000; t += 26) {
      const mask = state.arrangementMaskAt(t);
      if (mask.size < ROLES.length) {
        sawMute = true;
        break;
      }
    }
    expect(sawMute).toBe(true);
  });

  it('mask decisions are stable regardless of query order (cached by phrase)', () => {
    const e = new EmberEngine(Seed.from(99n), { bpm: 74 });
    const state = (e as unknown as { state: { arrangementMaskAt(t: number): ReadonlySet<string> } })
      .state;
    const times: number[] = [];
    for (let t = 0; t < 2000; t += 26) times.push(t);
    const forward = times.map((t) => [...state.arrangementMaskAt(t)].sort());
    // Query the same times again in reverse; cached decisions must match.
    for (let i = times.length - 1; i >= 0; i--) {
      expect([...state.arrangementMaskAt(times[i] as number)].sort()).toEqual(forward[i]);
    }
  });
});
