/**
 * Dev-time CLI: level-match the tape saturator makeup gain (Sweep 1
 * follow-up per docs/tape-texture.md §"Level-matched makeup gain").
 *
 * At the frozen `TAPE_DRIVE = 5` and current makeup `1/drive = 0.2`, the
 * saturator compresses peaks (~0.5–1 dB RMS drop) — so tape-ON is quieter
 * than tape-OFF, and any ear A/B is loudness-biased ("ON sounds worse"
 * partly because it's softer). The bypass A/B must be loudness-fair for the
 * character judgment to be honest. This script measures the RMS drop across
 * multiple renders (beds are nondeterministic, so N renders average the
 * stochastic noise out) and prints the exact linear multiplier to apply on
 * top of the `1/drive` base so ON matches OFF at the master output.
 *
 * Method (mirrors tape-sweep.ts but focused on RMS only):
 *   - Render seed 42, 24 s @ 32 kHz, rain muted, hiss muted (isolates sat).
 *   - N renders each of tape OFF and tape ON at frozen drive + oversample.
 *   - Report mean/stddev RMS for each and the mean delta.
 *   - Print the linear correction needed: `10^(mean_delta_db / 20)`.
 *
 * Run: bash packages/synth-tone/scripts/profile-chain.sh \
 *        packages/synth-tone/scripts/tape-makeup-match.ts
 * Dev-only; not shipped.
 */

import { DEFAULT_SAMPLE_RATE, renderChain } from './offline-harness.js';
import { monoMix, rmsDb } from './spectrum-util.js';

const SEED = 42n;
const RENDER_SECONDS = 24;
const N_RENDERS = 8;
// The frozen Sweep-1 pick. If Sweep 1 is ever re-run and the pick changes,
// update these; the makeup correction is drive-dependent.
const DRIVE = 5;
const OVERSAMPLE = '2x' as const;
const HISS_MUTE = { 'bed.hiss.level': -120 };

async function renderRms(label: string, tapeOn: boolean): Promise<number> {
  const buffer = await renderChain({
    seed: SEED,
    seconds: RENDER_SECONDS,
    lofi: tapeOn ? { tape: true, tapeDrive: DRIVE, tapeOversample: OVERSAMPLE } : {},
    params: tapeOn ? HISS_MUTE : undefined,
  });
  const rms = rmsDb(monoMix(buffer));
  console.log(`  ${label}: ${rms.toFixed(3)} dBFS`);
  return rms;
}

function meanStd(xs: number[]): { mean: number; std: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(variance) };
}

async function main(): Promise<void> {
  console.log(
    `Tape makeup level-match — seed ${SEED}, ${RENDER_SECONDS}s @ ${DEFAULT_SAMPLE_RATE} Hz, drive ${DRIVE}, oversample ${OVERSAMPLE}`,
  );
  console.log(
    `Music active, rain muted, hiss muted. ${N_RENDERS} renders each of tape OFF and tape ON.\n`,
  );

  console.log('OFF renders:');
  const offRms: number[] = [];
  for (let i = 0; i < N_RENDERS; i++) offRms.push(await renderRms(`off ${i + 1}`, false));
  console.log('\nON renders:');
  const onRms: number[] = [];
  for (let i = 0; i < N_RENDERS; i++) onRms.push(await renderRms(`on  ${i + 1}`, true));

  const off = meanStd(offRms);
  const on = meanStd(onRms);
  const meanDelta = on.mean - off.mean; // negative = ON is quieter

  console.log('\n=== Summary ===');
  console.log(`OFF: mean ${off.mean.toFixed(3)} dBFS, std ${off.std.toFixed(3)}`);
  console.log(`ON:  mean ${on.mean.toFixed(3)} dBFS, std ${on.std.toFixed(3)}`);
  console.log(`Delta (ON − OFF): ${meanDelta.toFixed(3)} dB`);
  console.log(`Between-run stability (max std): ${Math.max(off.std, on.std).toFixed(3)} dB`);

  // Correction: linear multiplier we need to apply on top of the current
  // 1/drive makeup so ON matches OFF. `1/drive * correction = makeup_new`.
  const correctionDb = -meanDelta;
  const correctionLinear = 10 ** (correctionDb / 20);
  const currentMakeup = 1 / DRIVE;
  const newMakeup = currentMakeup * correctionLinear;

  console.log('\n=== Level-match correction ===');
  console.log(`Current makeup (1/drive):            ${currentMakeup.toFixed(4)}`);
  console.log(`Correction linear (10^(-Δ/20)):      ${correctionLinear.toFixed(4)}`);
  console.log(`Corrected makeup (1/drive × corr):   ${newMakeup.toFixed(4)}`);
  console.log(`Correction in dB:                    +${correctionDb.toFixed(2)} dB`);
  console.log(
    '\nApply as TAPE_MAKEUP_TRIM constant in chains/lofi.ts: multiply the 1/drive base by this.',
  );
  console.log('Note: if |Δ| ≤ stability, the current makeup is already fair — no change needed.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
