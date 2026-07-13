import { describe, expect, it } from 'vitest';
import {
  ADJACENCY,
  ArrangementController,
  drawPresenceBias,
  ROLES,
  STATES,
} from '../src/engines/ember/arrangement-controller.js';
import type { EngineState } from '../src/engines/ember/ember.js';
import { EmberEngine, Seed } from '../src/index.js';

describe('ArrangementController palette (A2)', () => {
  it('palette is internally consistent (fullness = active/4, bits width)', () => {
    for (const st of STATES) {
      const active = st.bits.reduce((a, b) => a + b, 0);
      expect(st.fullness).toBeCloseTo(active / 4, 9);
      expect(st.bits.length).toBe(ROLES.length);
    }
    // FULL is index 0 (the fingerprint-preserving open).
    expect(STATES[0]?.name).toBe('FULL');
    // Bass is present in every state (the 6-state palette prunes bass-absent
    // near-silence) — so bass never drops.
    const bassIdx = ROLES.indexOf('bass');
    for (const st of STATES) expect(st.bits[bassIdx]).toBe(1);
  });

  it('adjacency is symmetric and single-role (Hamming distance 1)', () => {
    for (let i = 0; i < STATES.length; i++) {
      for (const j of ADJACENCY[i] as readonly number[]) {
        expect((ADJACENCY[j] as readonly number[]).includes(i)).toBe(true);
        const bi = (STATES[i] as { bits: readonly number[] }).bits;
        const bj = (STATES[j] as { bits: readonly number[] }).bits;
        const hamming = bi.reduce((s, b, k) => s + (b === bj[k] ? 0 : 1), 0);
        expect(hamming).toBe(1);
      }
    }
  });

  it('graph is connected (every state reachable from every state)', () => {
    const n = STATES.length;
    for (let start = 0; start < n; start++) {
      const seen = new Set<number>([start]);
      const queue = [start];
      while (queue.length) {
        const u = queue.shift() as number;
        for (const v of ADJACENCY[u] as readonly number[]) {
          if (!seen.has(v)) {
            seen.add(v);
            queue.push(v);
          }
        }
      }
      expect(seen.size).toBe(n);
    }
  });

  it('presence-bias draw is multiplicatively symmetric with melody protected', () => {
    // Across seeds, every component stays in the log-symmetric band; melody has
    // a higher floor (signature-protect: never systematically hidden).
    const meta = Seed.from(31337n).rng();
    const melodyIdx = ROLES.indexOf('melody');
    let melodyMin = Infinity;
    let otherMin = Infinity;
    for (let s = 0; s < 500; s++) {
      const b = drawPresenceBias(new Seed(BigInt(Math.floor(meta.nextFloat() * 2 ** 53))));
      for (let i = 0; i < b.length; i++) {
        expect(b[i]).toBeGreaterThan(0);
        expect(b[i]).toBeLessThanOrEqual(1.6 + 1e-9);
        if (i === melodyIdx) melodyMin = Math.min(melodyMin, b[i] as number);
        else otherMin = Math.min(otherMin, b[i] as number);
      }
    }
    // Melody's downside floor (~0.83) is well above the others' (~0.63).
    expect(melodyMin).toBeGreaterThan(0.8);
    expect(otherMin).toBeLessThan(0.7);
  });
});

describe('ArrangementController runtime (A2)', () => {
  const spb = 60 / 74;

  /** Build a bare controller against a stub state (no full engine). */
  function makeMaskAt(seed: Seed): (t: number) => ReadonlySet<string> {
    const state = { phraseBar: 0 } as unknown as EngineState;
    new ArrangementController(seed, state, spb);
    return state.arrangementMaskAt;
  }

  it('every emitted mask is a legal palette state', () => {
    const legal = new Set(STATES.map((s) => ROLES.filter((_, i) => s.bits[i]).join(',')));
    const phraseDur = 8 * 4 * spb;
    const maskAt = makeMaskAt(Seed.from(7n));
    for (let k = 0; k < 2000; k++) {
      const mask = maskAt(k * phraseDur + phraseDur * 0.5);
      const key = ROLES.filter((r) => mask.has(r)).join(',');
      expect(legal.has(key)).toBe(true);
    }
  });

  it('opens at FULL: the first phrase (~26 s @74) mutes nothing', () => {
    const e = new EmberEngine(Seed.from(42n), { bpm: 74 });
    const state = (e as unknown as { state: { arrangementMaskAt(t: number): ReadonlySet<string> } })
      .state;
    for (const t of [0, 5, 15, 25]) {
      const mask = state.arrangementMaskAt(t);
      for (const r of ROLES) expect(mask.has(r)).toBe(true);
    }
  });

  it('breathes below FULL later in a session', () => {
    const maskAt = makeMaskAt(Seed.from(7n));
    let sawMute = false;
    for (let t = 0; t < 3000; t += 26) {
      if (maskAt(t).size < ROLES.length) {
        sawMute = true;
        break;
      }
    }
    expect(sawMute).toBe(true);
  });

  it('mask decisions are stable regardless of query order (cached by phrase)', () => {
    const maskAt = makeMaskAt(Seed.from(99n));
    const times: number[] = [];
    for (let t = 0; t < 2000; t += 26) times.push(t);
    const forward = times.map((t) => [...maskAt(t)].sort());
    for (let i = times.length - 1; i >= 0; i--) {
      expect([...maskAt(times[i] as number)].sort()).toEqual(forward[i]);
    }
  });
});
