/**
 * Dev-time CLI: spectrum verification for the keys bit-crush
 * (docs/sampler-character.md) — the programmatic ear.
 *
 * Renders the REAL lofi chain + real EmberEngine events offline (shared
 * harness: offline-harness.ts) under crush variants, then compares
 * Welch-averaged band spectra against the crush-off baseline. Answers, with
 * numbers instead of ear tests:
 *   1. Is the crush wired up at all (does the spectrum move)?
 *   2. Do the bits / drive knobs discriminate (do variants differ)?
 *   3. Where does the difference live — in particular, does the evoFilter
 *      (LP 1800) immediately after the crusher eat the quantization products
 *      (delta confined below ~1800 Hz → "airy, bits all sound the same")?
 *
 * The OFF baseline is rendered twice: the chain's noise beds are
 * nondeterministic, so OFF-vs-OFF is the significance floor — any variant
 * delta smaller than that is measurement noise, not character.
 *
 * Run: bash packages/synth-tone/scripts/profile-chain.sh \
 *        packages/synth-tone/scripts/crush-spectrum.ts
 * Dev-only; not shipped.
 */

import { mkdirSync } from 'node:fs';
import type { LofiChainOptions } from '../src/chains/lofi.js';
import { DEFAULT_SAMPLE_RATE, renderChain, writeWav } from './offline-harness.js';
import { bandDb, monoMix, rmsDb, welchPsd } from './spectrum-util.js';

const SEED = 42n;
const RENDER_SECONDS = 24;
const FFT_SIZE = 8192;
const WAV_DIR = '/tmp/loam-crush/live';

// Band edges in Hz — split around the evoFilter cutoff (1800) so "did the LP
// eat the crunch" is directly readable from the table.
const BANDS: Array<[number, number]> = [
  [30, 150],
  [150, 300],
  [300, 600],
  [600, 1200],
  [1200, 1800],
  [1800, 3000],
  [3000, 6000],
  [6000, 12000],
  [12000, 16000],
];

interface Variant {
  label: string;
  file: string;
  lofi: LofiChainOptions;
}

// The offline harness runs the REAL sampler-crush worklet (file-path module
// provider — see offline-harness.ts), so these variants measure the true
// production topology: crush after evoFilter, before the reverb/echo taps.
const VARIANTS: Variant[] = [
  { label: 'OFF (baseline)', file: 'off', lofi: {} },
  { label: 'OFF (repeat = noise floor)', file: 'off-repeat', lofi: {} },
  { label: 'crush defaults (rate4 q12)', file: 'crush-default', lofi: { keysCrush: true } },
  { label: 'crush rate 3', file: 'crush-rate3', lofi: { keysCrush: true, keysCrushRate: 3 } },
  { label: 'crush rate 8', file: 'crush-rate8', lofi: { keysCrush: true, keysCrushRate: 8 } },
  { label: 'crush bits 8', file: 'crush-bits8', lofi: { keysCrush: true, keysCrushBits: 8 } },
];

async function main(): Promise<void> {
  console.log(
    `Keys bit-crush spectrum check — seed ${SEED}, ${RENDER_SECONDS}s @ ${DEFAULT_SAMPLE_RATE} Hz, rain muted`,
  );
  console.log(`Bands split at the evoFilter cutoff (1800 Hz). Deltas are dB vs OFF baseline.\n`);

  mkdirSync(WAV_DIR, { recursive: true });
  const results: Array<{ label: string; rms: number; bands: number[] }> = [];
  for (const v of VARIANTS) {
    const buffer = await renderChain({ seed: SEED, seconds: RENDER_SECONDS, lofi: v.lofi });
    writeWav(
      `${WAV_DIR}/${v.file}.wav`,
      [buffer.getChannelData(0), buffer.getChannelData(1)],
      DEFAULT_SAMPLE_RATE,
      2,
      12,
    );
    const samples = monoMix(buffer);
    const psd = welchPsd(samples, FFT_SIZE);
    results.push({
      label: v.label,
      rms: rmsDb(samples),
      bands: BANDS.map(([lo, hi]) => bandDb(psd, DEFAULT_SAMPLE_RATE, FFT_SIZE, lo, hi)),
    });
    console.log(`rendered: ${v.label}`);
  }

  const base = results[0];
  if (!base) throw new Error('no baseline render');

  const header = ['variant'.padEnd(28), 'RMS'.padStart(7)]
    .concat(
      BANDS.map(([lo, hi]) =>
        `${lo >= 1000 ? `${lo / 1000}k` : lo}-${hi >= 1000 ? `${hi / 1000}k` : hi}`.padStart(9),
      ),
    )
    .join('');
  console.log(`\n=== Absolute band levels (dB) ===\n${header}`);
  for (const r of results) {
    console.log(
      [r.label.padEnd(28), r.rms.toFixed(1).padStart(7)]
        .concat(r.bands.map((b) => b.toFixed(1).padStart(9)))
        .join(''),
    );
  }

  console.log(
    `\n=== Delta vs OFF baseline (dB) — |delta| ≤ noise-floor row is NOT significant ===\n${header}`,
  );
  for (const r of results.slice(1)) {
    console.log(
      [r.label.padEnd(28), (r.rms - base.rms).toFixed(2).padStart(7)]
        .concat(r.bands.map((b, i) => (b - (base.bands[i] ?? 0)).toFixed(2).padStart(9)))
        .join(''),
    );
  }

  console.log('\nReading guide: if crush deltas sit mostly in the ≤1800 Hz bands and the');
  console.log('>1800 Hz deltas are near the noise-floor row, the evoFilter is eating the');
  console.log('quantization products — the "airy / bits all sound identical" hypothesis.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
