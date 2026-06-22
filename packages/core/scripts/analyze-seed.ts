/**
 * Dev-time CLI: diagnose a seed's melody behaviour by surfacing
 * scheduler-internal state alongside emission stats.
 *
 * Usage:
 *   pnpm --filter @loam/core build && \
 *   node --experimental-strip-types packages/core/scripts/analyze-seed.ts <seed>
 *
 * Complements `render-snippet.ts`: render-snippet shows *what notes*
 * the engine emits (event listing); this script shows *why* (germ
 * shape, per-seed activity/coupling parameter draws, effective-activity
 * over time, fragment-vs-firing stats). Useful when triaging "this
 * seed sounds wrong" reports.
 *
 * Not built or distributed — intended for development use only.
 */

import { EmberEngine, Seed } from '../dist/index.js';

const seedValue = process.argv[2] ?? '42';
const seed = Seed.from(seedValue);
console.log(`\n=== Seed ${seedValue} ===\n`);

const engine = new EmberEngine(seed);
const opts = engine.getOptions();
console.log(`BPM: ${opts.bpm}`);

// Reach into the melody scheduler for germ + per-seed stream draws.
const melody = (
  engine as unknown as {
    melody: {
      germ: ReadonlyArray<{ scaleDegreeOffset: number; durationBeats: number }>;
      template: { id: string; contour: string };
      activityStream: { evaluate(t: number): number };
      couplingStream: { evaluate(t: number): number };
    };
  }
).melody;
const state = (
  engine as unknown as {
    state: { chordActivityStream: { evaluate(t: number): number } };
  }
).state;

console.log(`Template: ${melody.template.id} (${melody.template.contour})`);
console.log(`Germ length: ${melody.germ.length}`);
for (const note of melody.germ) {
  console.log(`  offset=${note.scaleDegreeOffset}  beats=${note.durationBeats}`);
}
const totalGermBeats = melody.germ.reduce((a, n) => a + n.durationBeats, 0);
console.log(`Germ total length: ${totalGermBeats} beats\n`);

// Run engine over 60 s and tally melody events.
const events = engine.scheduleUntil(60);
const melodyEvents = events.filter(
  (ev) => ev.kind === 'note' && (ev as { channel: string }).channel === 'rhodes_melody',
);
console.log(`Melody notes in 60 s: ${melodyEvents.length}`);

// Fragment detection: notes within < 1 quarter of the prior note are
// considered same-fragment. Imperfect — a germ whose first inter-note
// gap is exactly a quarter (e.g. T2's [4n, 8n, 8n, 8n, 4n]) will split
// off the head; treat fragment counts as approximate.
const secondsPerQuarter = 60 / opts.bpm;
const times = melodyEvents.map((ev) => (ev as { time: number }).time).sort((a, b) => a - b);
let fragmentCount = 0;
let lastEnd = Number.NEGATIVE_INFINITY;
const fragmentSizes: number[] = [];
let currentSize = 0;
for (const t of times) {
  if (t - lastEnd > secondsPerQuarter - 1e-3) {
    if (currentSize > 0) fragmentSizes.push(currentSize);
    fragmentCount++;
    currentSize = 1;
  } else {
    currentSize++;
  }
  lastEnd = t;
}
if (currentSize > 0) fragmentSizes.push(currentSize);
console.log(`Fragment count: ${fragmentCount}`);
console.log(
  `Average fragment size: ${(fragmentSizes.reduce((a, b) => a + b, 0) / Math.max(1, fragmentSizes.length)).toFixed(2)} notes`,
);
console.log(`Fragment sizes: ${fragmentSizes.join(', ')}`);
console.log(`Notes per second: ${(melodyEvents.length / 60).toFixed(2)}`);
console.log(`Fragments per minute: ${fragmentCount}`);

console.log(`\nSampled effective activity over 60 s:`);
for (let t = 0; t < 60; t += 5) {
  const m = melody.activityStream.evaluate(t);
  const c = state.chordActivityStream.evaluate(t);
  const k = melody.couplingStream.evaluate(t);
  const eff = (1 - k) * m + k * Math.min(m, 1 - c);
  console.log(
    `  t=${t.toString().padStart(2)}s  melody=${m.toFixed(3)}  chord=${c.toFixed(3)}  coupling=${k.toFixed(3)}  effective=${eff.toFixed(3)}`,
  );
}
