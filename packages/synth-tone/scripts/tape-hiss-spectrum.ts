/**
 * Dev-time CLI: spectrum verification for the tape-hiss bed
 * (docs/tape-texture.md §4). The programmatic anchor for the "does our hiss
 * match a real Sony HF-90 (Type I ferric) cassette" question — replaces
 * ear-A/B for a texture that is designed to be subliminal in-mix (where ear
 * discrimination is exactly the wrong tool).
 *
 * Method:
 *   1. Render the REAL lofi chain (shared harness: offline-harness.ts) with
 *      all music channels muted, rain muted, `tape: true`. What's left:
 *      brown bed + our tape-hiss bed + a silent reverb tail. (Crackle is
 *      note-triggered, no notes ⇒ silent.)
 *   2. Render the same with `tape: false` — brown bed alone. Same seed and
 *      duration, so brown-bed contribution is identical up to a two-render
 *      significance floor.
 *   3. Power-subtract the two Welch-averaged PSDs to isolate the hiss
 *      spectrum. `hiss_band = 10*log10(10^(a/10) - 10^(b/10))`.
 *   4. Normalize so the peak band = 0 dB. This makes the check a **shape**
 *      match — the absolute level lives in `TAPE_HISS_DB_DEFAULT` and is
 *      tuned by ear in-mix; the spectral shape is what we're numerically
 *      matching against published Sony HF measurements.
 *   5. Print per-band absolute levels, isolated hiss levels, shape (peak-
 *      normalized), and delta vs target. Within ±2 dB across all bands ⇒
 *      recipe is HF-90-shaped; iterate `TAPE_HISS_*` constants until met.
 *
 * Reference target — Sony HF Type I (normal-bias ferric), published tape-
 * review measurements. Broadband hiss, flat below ~1 kHz, +3 dB/oct rise
 * from 1 kHz to a broad peak near 8 kHz, gentle rolloff above. Numbers are
 * peak-normalized (peak band = 0 dB) so absolute level is decoupled.
 *
 * Run: bash packages/synth-tone/scripts/profile-chain.sh \
 *        packages/synth-tone/scripts/tape-hiss-spectrum.ts
 * Dev-only; not shipped.
 */

import { mkdirSync } from 'node:fs';
import type { LofiChainOptions } from '../src/chains/lofi.js';
import { DEFAULT_SAMPLE_RATE, renderChain, writeWav } from './offline-harness.js';
import { bandDb, monoMix, welchPsd } from './spectrum-util.js';

const SEED = 42n;
const RENDER_SECONDS = 30;
const FFT_SIZE = 8192;
const WAV_DIR = '/tmp/loam-tape-hiss';

// Bands aligned to the target-shape landmarks (HP corner, shelf corner,
// +3 dB/oct rise, peak, LP corner). Widths chosen so each band has ≥ 30
// FFT bins at fftSize=8192, sr=32000 (bin ≈ 3.9 Hz).
const BANDS: Array<[number, number]> = [
  [50, 150], // below HP (target: near noise floor — HP 80 must kill this)
  [150, 500],
  [500, 1200], // shelf corner region
  [1200, 2500],
  [2500, 5000],
  [5000, 9000], // hiss peak zone (this band is the reference 0 dB)
  [9000, 12000],
  [12000, 15500], // LP corner region
];

// Peak-normalized target shape (peak = 0 dB), constructed from published
// Type I ferric bias-noise spectra (Sony HF / Maxell UD / TDK D — the
// consumer-grade normal-bias family). Shape is what Sony HF looks like on a
// well-aligned playback deck with no Dolby: flat-ish low, +3 dB/oct rise
// from 1 kHz, broad peak ~5–9 kHz, rolloff above 12 kHz. Tolerance ±2 dB
// per band.
const TARGET_SHAPE_DB: number[] = [
  -20, // 50-150   (below HP — chain must attenuate this well)
  -12, // 150-500  (flat-ish low body)
  -9, // 500-1200 (shelf corner)
  -6, // 1.2k-2.5k
  -3, // 2.5k-5k
  0, // 5k-9k    (peak — reference)
  -3, // 9k-12k
  -10, // 12k-15.5k (LP corner — steep drop)
];
const TARGET_TOLERANCE_DB = 2;
// Bands where the always-on brown bed swamps the hiss (brown bed lives at
// LP 480 Hz, so it dominates absolute levels through ~500 Hz). Power
// subtraction then measures two near-identical numbers and its result is
// dominated by the between-render noise floor — not a real measurement of
// the hiss contribution. Mark those bands informational; pass/fail check
// only counts bands ≥ this index.
const FIRST_RELIABLE_BAND_IDX = 2; // 500-1.2k

interface Variant {
  label: string;
  file: string;
  lofi: LofiChainOptions;
}

const VARIANTS: Variant[] = [
  // Silence-mode renders: no music, no rain, no crackle (crackle is
  // note-triggered). Brown bed is always-on and has no mute, so it appears
  // in both — we subtract it out below.
  { label: 'silence + tape ON', file: 'silence-tape-on', lofi: { tape: true } },
  { label: 'silence + tape OFF', file: 'silence-tape-off', lofi: { tape: false } },
  // Two-repeat of tape-ON to establish the render-to-render noise floor —
  // any per-band delta below this row is not a real difference.
  {
    label: 'silence + tape ON (repeat)',
    file: 'silence-tape-on-repeat',
    lofi: { tape: true },
  },
];

/** Power subtraction in dB: 10·log10(10^(a/10) − 10^(b/10)); returns
 * −Infinity if b ≥ a (nothing left after subtracting). */
function subtractDb(aDb: number, bDb: number): number {
  const aP = 10 ** (aDb / 10);
  const bP = 10 ** (bDb / 10);
  const diff = aP - bP;
  return diff > 0 ? 10 * Math.log10(diff) : Number.NEGATIVE_INFINITY;
}

function fmtBand([lo, hi]: [number, number]): string {
  const l = lo >= 1000 ? `${lo / 1000}k` : lo;
  const h = hi >= 1000 ? `${hi / 1000}k` : hi;
  return `${l}-${h}`;
}

async function main(): Promise<void> {
  console.log(
    `Tape-hiss spectrum check — seed ${SEED}, ${RENDER_SECONDS}s @ ${DEFAULT_SAMPLE_RATE} Hz, music/rain muted`,
  );
  console.log(
    'Method: render silence tape-ON / tape-OFF, power-subtract → isolated hiss, peak-normalize, compare to Sony HF Type I shape target.\n',
  );

  mkdirSync(WAV_DIR, { recursive: true });
  const results: Array<{ label: string; bands: number[] }> = [];
  for (const v of VARIANTS) {
    // noteChannels: [] fires zero notes, so drums / keys / bass / pad /
    // crackle all stay silent. Beds (brown always-on, hiss when tape=true)
    // are the only surviving sources.
    const buffer = await renderChain({
      seed: SEED,
      seconds: RENDER_SECONDS,
      lofi: v.lofi,
      noteChannels: [],
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
      bands: BANDS.map(([lo, hi]) => bandDb(psd, DEFAULT_SAMPLE_RATE, FFT_SIZE, lo, hi)),
    });
    console.log(`rendered: ${v.label}`);
  }

  const on = results[0];
  const off = results[1];
  const onRepeat = results[2];
  if (!on || !off || !onRepeat) throw new Error('missing render results');

  // Isolated hiss = power-subtract tape-OFF from tape-ON per band.
  const hissBands = on.bands.map((db, i) =>
    subtractDb(db, off.bands[i] ?? Number.NEGATIVE_INFINITY),
  );

  // Two-render significance floor = per-band |delta| between tape-ON and
  // tape-ON-repeat. Numbers below this are noise, not signal.
  const noiseFloor = on.bands.map((db, i) => Math.abs(db - (onRepeat.bands[i] ?? db)));

  // Peak-normalize the isolated hiss (peak band → 0 dB) for shape comparison.
  const finiteHiss = hissBands.filter((v) => Number.isFinite(v));
  const peak = finiteHiss.length > 0 ? Math.max(...finiteHiss) : 0;
  const hissShape = hissBands.map((db) =>
    Number.isFinite(db) ? db - peak : Number.NEGATIVE_INFINITY,
  );

  const header = ['band'.padEnd(14)].concat(BANDS.map((b) => fmtBand(b).padStart(9))).join('');

  console.log(`\n=== Absolute band levels (dB) ===\n${header}`);
  for (const r of results) {
    console.log([r.label.padEnd(14)].concat(r.bands.map((b) => b.toFixed(1).padStart(9))).join(''));
  }

  console.log(`\n=== Isolated hiss (tape-ON − tape-OFF, dB power-subtract) ===\n${header}`);
  console.log(
    ['hiss (abs)'.padEnd(14)]
      .concat(
        hissBands.map((b) =>
          Number.isFinite(b) ? b.toFixed(1).padStart(9) : '   -Inf'.padStart(9),
        ),
      )
      .join(''),
  );

  console.log(
    `\n=== Shape check (peak-normalized to peak band = 0 dB) — tolerance ±${TARGET_TOLERANCE_DB} dB ===\n${header}`,
  );
  console.log(
    ['target'.padEnd(14)].concat(TARGET_SHAPE_DB.map((b) => b.toFixed(1).padStart(9))).join(''),
  );
  console.log(
    ['measured'.padEnd(14)]
      .concat(
        hissShape.map((b) =>
          Number.isFinite(b) ? b.toFixed(1).padStart(9) : '   -Inf'.padStart(9),
        ),
      )
      .join(''),
  );
  const deltas = hissShape.map((v, i) => (Number.isFinite(v) ? v - (TARGET_SHAPE_DB[i] ?? 0) : 0));
  console.log(
    ['delta'.padEnd(14)]
      .concat(
        deltas.map((d, i) => {
          if (!Number.isFinite(hissShape[i] ?? Number.NEGATIVE_INFINITY))
            return '   -Inf'.padStart(9);
          const s = d.toFixed(1);
          // Brown-bed-contaminated bands: mark with `~` so they show but
          // don't count against the pass/fail tolerance check.
          if (i < FIRST_RELIABLE_BAND_IDX) return `~${s}`.padStart(9);
          const marker = Math.abs(d) > TARGET_TOLERANCE_DB ? '*' : ' ';
          return `${marker}${s}`.padStart(9);
        }),
      )
      .join(''),
  );
  console.log(
    `(~ = brown-bed contaminated, informational only; * = reliable band exceeds ±${TARGET_TOLERANCE_DB} dB)`,
  );

  console.log(`\n=== Two-render noise floor (|tape-ON − tape-ON-repeat|, dB) ===\n${header}`);
  console.log(
    ['floor'.padEnd(14)].concat(noiseFloor.map((b) => b.toFixed(2).padStart(9))).join(''),
  );

  const outOfSpec = deltas.filter((d, i) => {
    if (i < FIRST_RELIABLE_BAND_IDX) return false;
    const shape = hissShape[i] ?? Number.NEGATIVE_INFINITY;
    return Number.isFinite(shape) && Math.abs(d) > TARGET_TOLERANCE_DB;
  }).length;
  console.log(
    outOfSpec === 0
      ? '\n✓ All bands within ±2 dB of Sony HF Type I target shape.'
      : `\n✗ ${outOfSpec} band(s) exceed ±${TARGET_TOLERANCE_DB} dB tolerance (marked with * above).`,
  );
  console.log(
    'Dials for tuning: TAPE_HISS_HP_HZ (low-band cut), TAPE_HISS_SHELF_GAIN_DB (mid-to-peak',
  );
  console.log(
    'rise), TAPE_HISS_LP_HZ (top-band rolloff). Rerender → check → repeat until in spec.',
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
