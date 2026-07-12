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
 * Regression guard for the melody-absence bug (listen-check, 2026-07-09): a slow
 * energy-contour trough could pin the walk in the melody-absent state cluster
 * for 10-20+ min. The controller's melody refractory must cap contiguous
 * melody absence. This is the metric the offline range-validation *missed*
 * (it measured occupancy, not contiguous sojourn) — now a permanent test.
 */
describe('arrangement controller — contiguous role absence', () => {
  const bpm = 74;
  const spb = 60 / bpm;
  const phraseDur = PHRASE_BARS * 4 * spb; // ~25.9 s
  const PHRASES = 1400; // ~10 hours of arrangement
  const SEEDS = 300;

  it('bounds contiguous melody absence to ≤ ~2 min across seeds + long walks', () => {
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

    // Phrase 0 opens at FULL (all present), so every role is absent at most
    // starting phrase 1. Melody is the only capped role: ~110 s cap → ≤ ~5
    // phrases; assert ≤ 130 s with margin. (Was 22 min before the refractory.)
    expect(sec(worst.melody)).toBeLessThanOrEqual(130);
  });
});
