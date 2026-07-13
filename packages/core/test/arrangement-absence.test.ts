import { describe, expect, it } from 'vitest';
import {
  ArrangementController,
  PHRASE_BARS,
  ROLES,
  type Role,
} from '../src/engines/ember/arrangement-controller.js';
import type { EngineState } from '../src/engines/ember/ember.js';
import { Seed } from '../src/rng/seed.js';

/**
 * Regression guard for the absence bug (listen-check, 2026-07-09): a slow
 * energy-contour trough pinned the occupancy walk in a sparse-state cluster for
 * 10-70+ min. The A2 event/dropout model bounds contiguous absence *by
 * construction* — a per-role hard deadline force-restores a role (batching
 * simultaneous deadlines to avoid competing-deadline starvation). This is the
 * metric the original occupancy validation *missed* (it measured occupancy, not
 * contiguous sojourn) — now a permanent test, asserted for **all four roles**.
 *
 * Caps (K_MAX, phrases ≈ 25.9 s @74): bass 0 (never dropped in the palette),
 * chords 2, melody 3, drums 4. Worst-case absence = cap exactly.
 */
describe('arrangement controller — contiguous role absence', () => {
  const bpm = 74;
  const spb = 60 / bpm;
  const phraseDur = PHRASE_BARS * 4 * spb; // ~25.9 s
  const PHRASES = 1400; // ~10 hours of arrangement
  const SEEDS = 300;

  it('bounds contiguous absence for every role across seeds + long walks', () => {
    const meta = Seed.from(424242n).rng();
    const worst: Record<Role, number> = { bass: 0, chords: 0, melody: 0, drums: 0 };
    const perSeedWorstBed: number[] = []; // worst bass/chords/drums run per seed
    let bedStarvedSeeds = 0; // seeds with a bed role absent > 10 min

    for (let s = 0; s < SEEDS; s++) {
      const seed = new Seed(BigInt(Math.floor(meta.nextFloat() * 2 ** 53)));
      const state = { phraseBar: 0 } as unknown as EngineState;
      // Construction wires state.arrangementMaskAt (the controller's query).
      new ArrangementController(seed, state, spb);
      const maskAt = state.arrangementMaskAt;
      if (!maskAt) throw new Error('controller did not wire arrangementMaskAt');

      const run: Record<Role, number> = { bass: 0, chords: 0, melody: 0, drums: 0 };
      const seedWorst: Record<Role, number> = { bass: 0, chords: 0, melody: 0, drums: 0 };
      for (let k = 0; k < PHRASES; k++) {
        const mask = maskAt(k * phraseDur + phraseDur * 0.5);
        for (const role of ROLES) {
          if (mask.has(role)) {
            run[role] = 0;
          } else {
            run[role]++;
            if (run[role] > worst[role]) worst[role] = run[role];
            if (run[role] > seedWorst[role]) seedWorst[role] = run[role];
          }
        }
      }
      const worstBed = Math.max(seedWorst.bass, seedWorst.chords, seedWorst.drums);
      perSeedWorstBed.push(worstBed);
      if (worstBed * phraseDur > 600) bedStarvedSeeds++;
    }

    const sec = (ph: number) => Math.round(ph * phraseDur);
    perSeedWorstBed.sort((a, b) => a - b);
    const p = (q: number) => sec(perSeedWorstBed[Math.floor(q * (SEEDS - 1))] ?? 0);
    console.log(
      `worst contiguous absence: ${ROLES.map((r) => `${r} ${sec(worst[r])}s`).join('  ')}`,
    );
    console.log(
      `per-seed worst BED absence (bass/chords/drums): median ${p(0.5)}s  p95 ${p(0.95)}s  ` +
        `max ${p(1)}s  |  seeds with bed absent >10min: ${bedStarvedSeeds}/${SEEDS}`,
    );

    // Every role is bounded by construction (A2 hard deadline). Worst-case
    // absence = K_MAX phrases exactly. Assert each role's ceiling (no margin
    // needed — the bound is exact, not statistical). Before A2, melody reached
    // 22 min and bed instruments a median 71 min.
    expect(sec(worst.bass)).toBe(0); // bass never absent in the palette
    expect(sec(worst.chords)).toBeLessThanOrEqual(2 * phraseDur + 1);
    expect(sec(worst.melody)).toBeLessThanOrEqual(3 * phraseDur + 1);
    expect(sec(worst.drums)).toBeLessThanOrEqual(4 * phraseDur + 1);
    // No bed role (bass/chords/drums) ever approaches the old-model minutes.
    expect(bedStarvedSeeds).toBe(0);
  });
});
