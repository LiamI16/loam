/**
 * Dev-time CLI: aggregate spectral-difference render for the tape-texture stage
 * (docs/tape-texture.md open-q §2 — "is the stage audibly *more produced*, not
 * merely harmless?"). The programmatic half of the tape ON/OFF confirmation;
 * the level-matched ear A/B is the other half.
 *
 * Renders the REAL lofi chain + real EmberEngine events offline (shared
 * harness) with `tape` off vs on, across several seeds, and reports the
 * band-by-band dB delta averaged over seeds. Answers with numbers:
 *   1. Does the tape stage move the spectrum at all (is it wired / audible)?
 *   2. WHERE — the −72 dB HF hiss shelf should show as a small top-octave lift;
 *      the drive-5 "tape squeeze" as broadband RMS compression; wow/flutter is
 *      time-domain, so it won't show as a static band delta (expected).
 *   3. Is any of it above the OFF-vs-OFF noise floor (the beds are
 *      nondeterministic, so OFF-repeat is the significance gate)?
 *
 * Run: bash packages/synth-tone/scripts/profile-chain.sh \
 *        packages/synth-tone/scripts/tape-spectrum.ts
 * Dev-only; not shipped.
 */

import { DEFAULT_SAMPLE_RATE, renderChain } from './offline-harness.js';
import { bandDb, monoMix, rmsDb, welchPsd } from './spectrum-util.js';

const SEEDS = [42n, 7n, 12345n];
const RENDER_SECONDS = 24;
const FFT_SIZE = 8192;

// Bands weighted toward the top, where the hiss shelf + HF character live.
const BANDS: Array<[number, number]> = [
  [30, 150],
  [150, 400],
  [400, 1000],
  [1000, 2500],
  [2500, 5000],
  [5000, 9000],
  [9000, 13000],
  [13000, 16000],
];

const bandLabel = ([lo, hi]: [number, number]) =>
  `${lo >= 1000 ? `${lo / 1000}k` : lo}-${hi >= 1000 ? `${hi / 1000}k` : hi}`.padStart(9);

interface Row {
  rms: number;
  bands: number[];
}

async function renderRow(seed: bigint, tape: boolean): Promise<Row> {
  const buffer = await renderChain({ seed, seconds: RENDER_SECONDS, lofi: { tape } });
  const samples = monoMix(buffer);
  const psd = welchPsd(samples, FFT_SIZE);
  return {
    rms: rmsDb(samples),
    bands: BANDS.map(([lo, hi]) => bandDb(psd, DEFAULT_SAMPLE_RATE, FFT_SIZE, lo, hi)),
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

async function main(): Promise<void> {
  console.log(
    `Tape ON/OFF spectral difference — ${SEEDS.length} seeds, ${RENDER_SECONDS}s @ ${DEFAULT_SAMPLE_RATE} Hz, rain muted`,
  );
  console.log('Deltas are dB (tape ON − OFF), averaged over seeds. Wow/flutter is');
  console.log('time-domain and will NOT show here — this measures static spectral shape.\n');

  const onDelta: number[][] = [];
  const rmsDelta: number[] = [];
  const floorDelta: number[][] = [];
  const floorRms: number[] = [];

  for (const seed of SEEDS) {
    const off = await renderRow(seed, false);
    const offRepeat = await renderRow(seed, false); // OFF-vs-OFF significance floor
    const on = await renderRow(seed, true);
    onDelta.push(on.bands.map((b, i) => b - (off.bands[i] ?? 0)));
    rmsDelta.push(on.rms - off.rms);
    floorDelta.push(offRepeat.bands.map((b, i) => Math.abs(b - (off.bands[i] ?? 0))));
    floorRms.push(Math.abs(offRepeat.rms - off.rms));
    console.log(`rendered seed ${seed}`);
  }

  const header = ['label'.padEnd(6), 'RMS'.padStart(7)].concat(BANDS.map(bandLabel)).join('');
  console.log(`\n=== Tape ON − OFF (dB), seed-averaged ===\n${header}`);
  console.log(
    ['tape'.padEnd(6), mean(rmsDelta).toFixed(2).padStart(7)]
      .concat(
        BANDS.map((_, i) =>
          mean(onDelta.map((d) => d[i] ?? 0))
            .toFixed(2)
            .padStart(9),
        ),
      )
      .join(''),
  );
  console.log(
    ['floor'.padEnd(6), mean(floorRms).toFixed(2).padStart(7)]
      .concat(
        BANDS.map((_, i) =>
          mean(floorDelta.map((d) => d[i] ?? 0))
            .toFixed(2)
            .padStart(9),
        ),
      )
      .join(''),
  );

  console.log('\nReading guide:');
  console.log('  • RMS delta ≈ the "tape squeeze" (drive-5 compression) + hiss energy.');
  console.log('  • Top-octave (9k+) lift above the floor row = the −72 dB hiss shelf.');
  console.log('  • Any band whose |delta| ≤ its floor value is NOT significant.');
  console.log('  • A stage that only shows floor-level static deltas would mean its');
  console.log('    audible character is essentially all wow/flutter (time-domain).');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
