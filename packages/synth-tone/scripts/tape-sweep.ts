/**
 * Dev-time CLI: Sweep 1 for the tape saturation node (docs/tape-texture.md
 * §Measurement sweeps). Two questions to answer with numbers:
 *
 *   1. What TAPE_DRIVE lands the target "+1..+2 dB odd-harmonic rise in the
 *      mids" without pushing the low bands above the OFF-repeat significance
 *      floor (which would mean bass mud — apply A-fallback per plan §A).
 *   2. At that drive, which `WaveShaper.oversample` factor (`'none' | '2x'
 *      | '4x'`) is the lowest that stays alias-free (no inharmonic
 *      top-band energy rise beyond the OFF-repeat floor).
 *
 * Method:
 *   - Render seed 42, 24 s @ 32 kHz with the REAL chain + REAL engine event
 *     stream (shared harness: offline-harness.ts). Music channels active
 *     (this is the mix the saturator will see in production), rain muted,
 *     hiss zeroed via `bed.hiss.level = -120` so the tape-ON−OFF delta is
 *     purely the sat + wow stages (wow is delay-only, adds no band energy —
 *     so effectively pure saturation).
 *   - Two OFF renders establish the between-render significance floor. Any
 *     variant delta smaller than the floor row is measurement noise.
 *   - Drive sweep: 1.0 (unity, sanity check) / 1.5 / 2.0 / 3.0 / 4.0. Print
 *     absolute band levels and delta-vs-OFF for each; the "bass mud gate"
 *     is the delta in the 30–150 / 150–400 bands vs the OFF-repeat floor.
 *   - Oversample sweep: at the picked drive, render `none / 2x / 4x` and
 *     compare 12k–16k band levels — inharmonic top-band rise beyond the
 *     floor is aliasing.
 *
 * Run: bash packages/synth-tone/scripts/profile-chain.sh \
 *        packages/synth-tone/scripts/tape-sweep.ts
 * Dev-only; not shipped.
 */

import { mkdirSync } from 'node:fs';
import type { LofiChainOptions } from '../src/chains/lofi.js';
import { DEFAULT_SAMPLE_RATE, renderChain, writeWav } from './offline-harness.js';
import { bandDb, monoMix, rmsDb, welchPsd } from './spectrum-util.js';

const SEED = 42n;
const RENDER_SECONDS = 24;
const FFT_SIZE = 8192;
const WAV_DIR = '/tmp/loam-tape-sweep';

// Bands chosen to expose (a) bass-mud (30-400 Hz for the low-band gate),
// (b) mid odd-harmonic rise from tanh (1500-4000 Hz — where 3f/5f of the
// keys register lands), (c) HF aliasing (12k-16k for the oversample check).
const BANDS: Array<[number, number]> = [
  [30, 150], // bass mud gate — low
  [150, 400], // bass mud gate — fundamentals
  [400, 800],
  [800, 1500],
  [1500, 3000], // mid odd-harmonic zone (target: +1..+2 dB)
  [3000, 6000], // upper odd-harmonic zone
  [6000, 12000],
  [12000, 16000], // alias-detection zone
];

// Hiss-zero override applied to every tape-ON variant so the ON−OFF delta
// isolates saturation. Wow adds no band energy (delay-time modulation is
// amplitude-preserving), so this leaves saturation as the only sat/wow
// contribution to the delta.
const HISS_MUTE = { 'bed.hiss.level': -120 };

interface Variant {
  label: string;
  file: string;
  lofi: LofiChainOptions;
  params?: Record<string, number>;
}

// The music mix sits around -30 dBFS RMS with peaks well below 1.0. `tanh(x)
// ≈ x` for small `x`, so at drives 1–4 the saturator passes through nearly
// linearly (verified: initial sweep at 1.0/1.5/2.0/3.0/4.0 showed no
// measurable mid-band harmonic rise). To actually push peaks into the
// compressive region we need drives roughly one to two orders of magnitude
// higher — these values expose where tanh engages, then we can back off
// toward whichever drive lands the target "+1..+2 dB mid rise."
const DRIVE_VARIANTS: Variant[] = [
  { label: 'OFF (baseline)', file: 'off', lofi: {} },
  { label: 'OFF (repeat = noise floor)', file: 'off-repeat', lofi: {} },
  {
    label: 'tape drive 2 (unity-ish)',
    file: 'drive-2',
    lofi: { tape: true, tapeDrive: 2 },
    params: HISS_MUTE,
  },
  {
    label: 'tape drive 5',
    file: 'drive-5',
    lofi: { tape: true, tapeDrive: 5 },
    params: HISS_MUTE,
  },
  {
    label: 'tape drive 10',
    file: 'drive-10',
    lofi: { tape: true, tapeDrive: 10 },
    params: HISS_MUTE,
  },
  {
    label: 'tape drive 20',
    file: 'drive-20',
    lofi: { tape: true, tapeDrive: 20 },
    params: HISS_MUTE,
  },
  {
    label: 'tape drive 40',
    file: 'drive-40',
    lofi: { tape: true, tapeDrive: 40 },
    params: HISS_MUTE,
  },
];

// Oversample sweep at the drive that Sweep 1's drive pass chose (5) — the
// drive at which tanh actually engages enough to generate aliasable
// harmonics against 16 kHz Nyquist. Testing oversample at unity-ish drives
// is not diagnostic because no aliasing exists to remove.
const OVERSAMPLE_DRIVE_FOR_ALIAS_CHECK = 5;
const OVERSAMPLE_VARIANTS: Variant[] = [
  {
    label: `drive ${OVERSAMPLE_DRIVE_FOR_ALIAS_CHECK} × oversample none`,
    file: 'ov-none',
    lofi: {
      tape: true,
      tapeDrive: OVERSAMPLE_DRIVE_FOR_ALIAS_CHECK,
      tapeOversample: 'none',
    },
    params: HISS_MUTE,
  },
  {
    label: `drive ${OVERSAMPLE_DRIVE_FOR_ALIAS_CHECK} × oversample 2x`,
    file: 'ov-2x',
    lofi: {
      tape: true,
      tapeDrive: OVERSAMPLE_DRIVE_FOR_ALIAS_CHECK,
      tapeOversample: '2x',
    },
    params: HISS_MUTE,
  },
  {
    label: `drive ${OVERSAMPLE_DRIVE_FOR_ALIAS_CHECK} × oversample 4x`,
    file: 'ov-4x',
    lofi: {
      tape: true,
      tapeDrive: OVERSAMPLE_DRIVE_FOR_ALIAS_CHECK,
      tapeOversample: '4x',
    },
    params: HISS_MUTE,
  },
];

function fmtBand([lo, hi]: [number, number]): string {
  const l = lo >= 1000 ? `${lo / 1000}k` : lo;
  const h = hi >= 1000 ? `${hi / 1000}k` : hi;
  return `${l}-${h}`;
}

async function renderAll(
  variants: Variant[],
): Promise<Array<{ label: string; rms: number; bands: number[] }>> {
  mkdirSync(WAV_DIR, { recursive: true });
  const results: Array<{ label: string; rms: number; bands: number[] }> = [];
  for (const v of variants) {
    const buffer = await renderChain({
      seed: SEED,
      seconds: RENDER_SECONDS,
      lofi: v.lofi,
      params: v.params,
    });
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
  return results;
}

function printTable(
  title: string,
  rows: Array<{ label: string; rms: number; bands: number[] }>,
  baseline?: { rms: number; bands: number[] },
): void {
  const header = ['variant'.padEnd(32), 'RMS'.padStart(7)]
    .concat(BANDS.map((b) => fmtBand(b).padStart(9)))
    .join('');
  console.log(`\n=== ${title} ===\n${header}`);
  for (const r of rows) {
    if (baseline) {
      const rmsDelta = r.rms - baseline.rms;
      const bandDeltas = r.bands.map((b, i) => b - (baseline.bands[i] ?? 0));
      console.log(
        [r.label.padEnd(32), rmsDelta.toFixed(2).padStart(7)]
          .concat(bandDeltas.map((d) => d.toFixed(2).padStart(9)))
          .join(''),
      );
    } else {
      console.log(
        [r.label.padEnd(32), r.rms.toFixed(1).padStart(7)]
          .concat(r.bands.map((b) => b.toFixed(1).padStart(9)))
          .join(''),
      );
    }
  }
}

async function main(): Promise<void> {
  console.log(
    `Sweep 1 — tape saturation drive + oversample. Seed ${SEED}, ${RENDER_SECONDS}s @ ${DEFAULT_SAMPLE_RATE} Hz.`,
  );
  console.log(
    'Music active, rain muted, hiss muted (bed.hiss.level=-120) so tape-ON − OFF delta isolates saturation.\n',
  );

  const driveResults = await renderAll(DRIVE_VARIANTS);
  const off = driveResults[0];
  const offRepeat = driveResults[1];
  if (!off || !offRepeat) throw new Error('missing baseline renders');

  printTable('Absolute band levels (dB)', driveResults);
  printTable('Delta vs OFF baseline (dB)', driveResults, off);

  // The OFF-vs-OFF-repeat row is the significance floor. Print it as
  // absolute deltas so the reader can compare each variant's per-band
  // deltas against it directly.
  const floorRow = {
    label: 'OFF-vs-OFF (significance floor)',
    rms: Math.abs(offRepeat.rms - off.rms),
    bands: offRepeat.bands.map((b, i) => Math.abs(b - (off.bands[i] ?? 0))),
  };
  printTable('Two-render significance floor (dB |delta|)', [floorRow]);

  console.log('\nDrive-pick guide:');
  console.log('  - Target: +1..+2 dB in 1500-3000 Hz band, low bands within floor row.');
  console.log('  - Bass-mud gate: 30-150 / 150-400 deltas must be near floor row.');
  console.log('    If not, apply A-fallback (pre-saturation HP on bass or exclude');
  console.log('    bass from tapeInput) and document in docs/tape-texture.md.\n');

  const oversampleResults = await renderAll(OVERSAMPLE_VARIANTS);
  const ovBase = oversampleResults[0];
  if (!ovBase) throw new Error('missing oversample baseline');
  printTable(
    `Oversample sweep at drive ${OVERSAMPLE_DRIVE_FOR_ALIAS_CHECK} — absolute band levels`,
    oversampleResults,
  );
  // Delta the higher oversample rows against `none` — dropping inharmonic
  // top-band energy is the pass criterion. Look at 12k-16k specifically.
  printTable(`Oversample sweep — delta vs 'none' (dB)`, oversampleResults, ovBase);
  console.log('\nOversample-pick guide:');
  console.log('  - 12k-16k delta from `none` → `2x`/`4x` shows the aliasing that oversample');
  console.log('    removes. A big drop means `none` was aliasing hard.');
  console.log('  - Pick the LOWEST oversample factor whose 12k-16k delta vs the next factor');
  console.log('    up is within the drive-sweep floor row (no further alias removal to gain).');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
