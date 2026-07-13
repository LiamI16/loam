// biome-ignore-all lint/style/noNonNullAssertion: dev-only validation script over fixed-size arrays.
/**
 * Offline range-validation for the arrangement controller (docs/arrangement.md),
 * A2 event/dropout model. Pure seed-math — no audio. Drives the *real*
 * ArrangementController (no reimplementation) over many seeds × many phrases
 * and measures:
 *   (a) per-role **contiguous sojourn** (max + distribution) — the bounded-
 *       absence guarantee, the metric the old occupancy validation MISSED;
 *   (b) per-role presence fraction → cross-seed distinctness (per-seed identity);
 *   (c) change frequency (mean time between mask changes) vs the ~45–150 s target;
 *   (d) fullness distribution (time at FULL / sparsest).
 * Run:
 *   node --experimental-strip-types packages/core/scripts/arrangement-validate.ts
 */
import { ArrangementController, ROLES } from '../src/engines/ember/arrangement-controller.ts';
import type { EngineState } from '../src/engines/ember/ember.ts';
import { Seed } from '../src/rng/seed.ts';

const BPM = 74;
const SPB = 60 / BPM;
const PHRASE_SEC = 8 * 4 * SPB; // ~25.9 s
const SEED_COUNT = 2000;
const PHRASES = 1400; // ~10 h of arrangement per seed

type Role = (typeof ROLES)[number];

const meta = Seed.from(1234567n).rng();

const worstSojourn: Record<Role, number> = { bass: 0, chords: 0, melody: 0, drums: 0 };
const perSeedPresence: Record<Role, number[]> = { bass: [], chords: [], melody: [], drums: [] };
const changeSecArr: number[] = [];
const fullFracArr: number[] = [];
const sparsestArr: number[] = []; // per-seed min fullness fraction reached
const perSeedWorstBed: number[] = []; // worst bass/chords/drums sojourn per seed
let bedStarved = 0; // seeds with a bed role absent > 10 min

for (let s = 0; s < SEED_COUNT; s++) {
  const seed = new Seed(BigInt(Math.floor(meta.nextFloat() * 2 ** 53)));
  const state = { phraseBar: 0 } as unknown as EngineState;
  new ArrangementController(seed, state, SPB);
  const maskAt = state.arrangementMaskAt;

  const run: Record<Role, number> = { bass: 0, chords: 0, melody: 0, drums: 0 };
  const seedWorst: Record<Role, number> = { bass: 0, chords: 0, melody: 0, drums: 0 };
  const present: Record<Role, number> = { bass: 0, chords: 0, melody: 0, drums: 0 };
  let changes = 0;
  let fullCount = 0;
  let minActive = ROLES.length;
  let prevKey = '';

  for (let k = 0; k < PHRASES; k++) {
    const mask = maskAt(k * PHRASE_SEC + PHRASE_SEC * 0.5);
    let active = 0;
    for (const r of ROLES) {
      if (mask.has(r)) {
        present[r]++;
        run[r] = 0;
        active++;
      } else {
        run[r]++;
        if (run[r] > seedWorst[r]) seedWorst[r] = run[r];
      }
    }
    if (active === ROLES.length) fullCount++;
    if (active < minActive) minActive = active;
    const key = ROLES.map((r) => (mask.has(r) ? 1 : 0)).join('');
    if (k > 0 && key !== prevKey) changes++;
    prevKey = key;
  }

  for (const r of ROLES) {
    if (seedWorst[r] > worstSojourn[r]) worstSojourn[r] = seedWorst[r];
    perSeedPresence[r].push(present[r] / PHRASES);
  }
  changeSecArr.push(changes > 0 ? ((PHRASES - 1) * PHRASE_SEC) / changes : Infinity);
  fullFracArr.push(fullCount / PHRASES);
  sparsestArr.push(minActive / ROLES.length);
  const wb = Math.max(seedWorst.bass, seedWorst.chords, seedWorst.drums);
  perSeedWorstBed.push(wb);
  if (wb * PHRASE_SEC > 600) bedStarved++;
}

const pct = (arr: number[], p: number) => {
  const a = [...arr].filter(Number.isFinite).sort((x, y) => x - y);
  return a[Math.floor(p * (a.length - 1))] ?? 0;
};
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
const sec = (ph: number) => Math.round(ph * PHRASE_SEC);

console.log(`Arrangement A2 validation — ${SEED_COUNT} seeds × ${PHRASES} phrases @${BPM} BPM\n`);

console.log('CONTIGUOUS SOJOURN — worst per-role absence across all seeds (the hard bound):');
for (const r of ROLES) {
  console.log(`  ${r.padEnd(7)} ${worstSojourn[r]} phrases = ${sec(worstSojourn[r])} s`);
}
perSeedWorstBed.sort((a, b) => a - b);
console.log(
  `  per-seed worst BED (bass/chords/drums): median ${sec(pct(perSeedWorstBed, 0.5))}s  ` +
    `p95 ${sec(pct(perSeedWorstBed, 0.95))}s  max ${sec(pct(perSeedWorstBed, 1))}s  |  ` +
    `bed>10min: ${bedStarved}/${SEED_COUNT}`,
);

console.log('\nCHANGE FREQUENCY (mean s between mask changes; target ~45–150 s, median ~90):');
console.log(
  `  p05 ${pct(changeSecArr, 0.05).toFixed(0)}s  median ${pct(changeSecArr, 0.5).toFixed(0)}s  ` +
    `p95 ${pct(changeSecArr, 0.95).toFixed(0)}s`,
);

console.log('\nCROSS-SEED DISTINCTNESS (fraction of time each role present):');
for (const r of ROLES) {
  const a = perSeedPresence[r];
  console.log(
    `  ${r.padEnd(7)} mean ${mean(a).toFixed(2)}  std ${std(a).toFixed(3)}  ` +
      `range [${pct(a, 0.05).toFixed(2)}, ${pct(a, 0.95).toFixed(2)}]`,
  );
}
// mean pairwise L1 between per-seed presence vectors.
let dsum = 0;
let dn = 0;
for (let k = 0; k < 3000; k++) {
  const i = Math.floor(meta.nextFloat() * SEED_COUNT);
  const j = Math.floor(meta.nextFloat() * SEED_COUNT);
  if (i === j) continue;
  dsum += ROLES.reduce((a, r) => a + Math.abs(perSeedPresence[r][i]! - perSeedPresence[r][j]!), 0);
  dn++;
}
console.log(`  mean pairwise L1 between seed presence vectors: ${(dsum / dn).toFixed(3)}`);

console.log('\nFULLNESS:');
console.log(
  `  time at FULL: mean ${mean(fullFracArr).toFixed(2)}  range [${pct(fullFracArr, 0.05).toFixed(2)}, ${pct(fullFracArr, 0.95).toFixed(2)}]`,
);
console.log(
  `  per-seed sparsest active-fraction reached: median ${pct(sparsestArr, 0.5).toFixed(2)}  ` +
    `p05 ${pct(sparsestArr, 0.05).toFixed(2)}`,
);
