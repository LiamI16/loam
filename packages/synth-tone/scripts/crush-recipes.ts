/**
 * Dev-time CLI: which lo-fi "crush" recipe matches the producer effect?
 * (docs/sampler-character.md §Scope decision, SRR unlocked 2026-07-03.)
 *
 * Renders a clean keys-only pass of the REAL chain once (chord + melody
 * channels, rain muted, reverb tail shrunk to near-zero), then applies
 * candidate recipes in pure JS — quantization, TPDF dither, integer
 * sample-and-hold SRR, and combinations — and measures each recipe's ERROR
 * signal (`processed − clean`, exact because there is a single render):
 *
 *   - error level (dB rel. signal)      how loud the character is
 *   - error spectral flatness (0..1)    ~1 = noise-like "dust", →0 = tonal
 *   - error peak prominence (dB)        high = discrete line = "buzz"
 *   - error energy share > 1.8 kHz      where the character lives
 *
 * Target: the producer texture is dust-like (high flatness, low prominence).
 * The known failure mode — undithered quantization of clean synthesis — is
 * buzz (low flatness, high prominence).
 *
 * Caveats (fine for recipe *selection*, production placement differs):
 * processing here is applied post-chain (after evoFilter/warmth/pan) to the
 * whole keys mix, and the always-on brown bed (no level param) is processed
 * too; its energy is <150 Hz, and metrics are computed over 150 Hz–8 kHz.
 *
 * Also writes 16-bit WAV excerpts per recipe to /tmp/loam-crush/ for ear
 * checks — the offline A/B that replaces flag-URL listening loops.
 *
 * Run: bash packages/synth-tone/scripts/profile-chain.sh \
 *        packages/synth-tone/scripts/crush-recipes.ts
 * Dev-only; not shipped.
 */

import { mkdirSync } from 'node:fs';
import { Channels } from '@loam/core';
import { DEFAULT_SAMPLE_RATE, renderChain, writeWav as writeWavShared } from './offline-harness.js';
import { monoMix, peakProminenceDb, rmsDb, spectralFlatness, welchPsd } from './spectrum-util.js';

const SEED = 42n;
const RENDER_SECONDS = 24;
const FFT_SIZE = 8192;
const OUT_DIR = '/tmp/loam-crush';
const WAV_START_S = 2;
const WAV_SECONDS = 12;
// Metrics band: above the brown bed (<150 Hz), inside the audible keys range.
const BAND_LO = 150;
const BAND_HI = 8000;

type Process = (channels: Float32Array[], sampleRate: number) => Float32Array[];

function peakOf(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i] ?? 0));
  }
  return peak || 1;
}

/** Amplitude quantization at `bits`, peak-staged (signal scaled to full-scale
 * first — ideal drive — then scaled back), optional 1-LSB TPDF dither. */
function quant(bits: number, dither: boolean): Process {
  return (channels) => {
    const peak = peakOf(channels);
    const step = 2 ** (1 - bits);
    return channels.map((ch) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        let v = (ch[i] ?? 0) / peak;
        if (dither) v += (Math.random() + Math.random() - 1) * step;
        v = Math.round(v / step) * step;
        out[i] = Math.max(-1, Math.min(1, v)) * peak;
      }
      return out;
    });
  };
}

/** First-order (linear-interpolation) hold at `factor`: same image
 * frequencies as the zero-order hold, but image energy falls off ~twice as
 * fast — chiptune-but-smoother. Tests whether the "rattle" is ZOH harshness
 * rather than the imaging itself. */
function srrLin(factor: number): Process {
  return (channels) =>
    channels.map((ch) => {
      const out = new Float32Array(ch.length);
      for (let start = 0; start < ch.length; start += factor) {
        const s0 = ch[start] ?? 0;
        const s1 = ch[Math.min(start + factor, ch.length - 1)] ?? s0;
        for (let k = 0; k < factor && start + k < ch.length; k++) {
          out[start + k] = s0 + ((s1 - s0) * k) / factor;
        }
      }
      return out;
    });
}

/** Integer sample-and-hold SRR: hold every `factor` samples (naive — the
 * aliasing is the point). Effective rate = sampleRate / factor. */
function srr(factor: number): Process {
  return (channels) =>
    channels.map((ch) => {
      const out = new Float32Array(ch.length);
      let held = 0;
      for (let i = 0; i < ch.length; i++) {
        if (i % factor === 0) held = ch[i] ?? 0;
        out[i] = held;
      }
      return out;
    });
}

function compose(...steps: Process[]): Process {
  return (channels, sr) => steps.reduce((acc, step) => step(acc, sr), channels);
}

/**
 * 4th-order Butterworth low-pass (two RBJ biquad stages, Q = 0.541/1.307).
 * Used as (a) a *reconstruction* filter after the hold — real samplers had an
 * analog output LP that removed the staircase imaging (the "rattle"; the
 * fold-DOWN aliasing baked in at sampling survives — that's the character) —
 * and (b) optionally as a pre-hold anti-alias filter to tame fold-down too.
 */
function lp(cutoffHz: number): Process {
  const stage = (ch: Float32Array, sr: number, q: number): Float32Array => {
    const w0 = (2 * Math.PI * cutoffHz) / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const cosW0 = Math.cos(w0);
    const a0 = 1 + alpha;
    const b0 = (1 - cosW0) / 2 / a0;
    const b1 = (1 - cosW0) / a0;
    const b2 = b0;
    const a1 = (-2 * cosW0) / a0;
    const a2 = (1 - alpha) / a0;
    const out = new Float32Array(ch.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < ch.length; i++) {
      const x0 = ch[i] ?? 0;
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      out[i] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
    return out;
  };
  return (channels, sr) => channels.map((ch) => stage(stage(ch, sr, 0.5412), sr, 1.3066));
}

interface Recipe {
  label: string;
  file: string;
  process: Process;
}

const identity: Process = (chs) => chs;

const RECIPES: Recipe[] = [
  { label: 'clean (reference)', file: '0-clean', process: identity },
  { label: 'quant 7 (current buzz)', file: '1-quant7', process: quant(7, false) },
  { label: 'quant 7 + dither', file: '2-quant7-dither', process: quant(7, true) },
  { label: 'quant 12 + dither', file: '3-quant12-dither', process: quant(12, true) },
  { label: 'srr /2 (16 kHz)', file: '4-srr2', process: srr(2) },
  { label: 'srr /3 (10.7 kHz)', file: '5-srr3', process: srr(3) },
  { label: 'srr /4 (8 kHz)', file: '6-srr4', process: srr(4) },
  {
    label: 'srr /3 + quant 12 + dither',
    file: '7-srr3-quant12-dither',
    process: compose(srr(3), quant(12, true)),
  },
  {
    label: 'srr /3 + quant 7 + dither',
    file: '8-srr3-quant7-dither',
    process: compose(srr(3), quant(7, true)),
  },
  // Reconstruction-filtered variants (cutoff ≈ 0.47 × effective rate):
  // aliasing kept, staircase imaging ("rattle") removed — the hardware path.
  { label: 'srr /3 → LP 5k', file: '9-srr3-postlp', process: compose(srr(3), lp(5000)) },
  { label: 'srr /4 → LP 3.7k', file: '10-srr4-postlp', process: compose(srr(4), lp(3700)) },
  {
    label: 'LP 5k → srr /3 → LP 5k',
    file: '11-srr3-prelp-postlp',
    process: compose(lp(5000), srr(3), lp(5000)),
  },
  {
    label: 'srr /3 + q7 + dith → LP 5k',
    file: '12-srr3-quant7-dither-postlp',
    process: compose(srr(3), quant(7, true), lp(5000)),
  },
  { label: 'srrLin /3 (smooth hold)', file: '13-srrlin3', process: srrLin(3) },
  // Spec-anchored "actual lofi levels" ladder (2026-07-03): SP-1200 = 12-bit
  // @26k pitched down (~13-17k effective) through ~10k analog output LPs;
  // MPC60 = 12-bit with steep ~10.5k output filter; plugin lofi presets =
  // 8-16k effective + ~12-bit, samples only. ZOH + moderate LP is the
  // hardware-faithful pair we never tried (only 5k, which nuked the effect).
  {
    label: 'HW: zoh/3 + q12 → LP 10.5k',
    file: '16-hw-srr3-q12-lp10k',
    process: compose(srr(3), quant(12, true), lp(10500)),
  },
  {
    label: 'srrLin /3 + q12 + dither',
    file: '17-srrlin3-q12',
    process: compose(srrLin(3), quant(12, true)),
  },
  {
    label: 'srrLin /2 + q12 (subtle)',
    file: '18-srrlin2-q12',
    process: compose(srrLin(2), quant(12, true)),
  },
  {
    label: 'srrLin /4 + q12 (heavy)',
    file: '19-srrlin4-q12',
    process: compose(srrLin(4), quant(12, true)),
  },
];

/** JS approximation of lofi.ts's chord echo (FeedbackDelay time 60/74,
 * feedback 0.3, send 0.2) for the production-placement simulation. */
function addEcho(channels: Float32Array[], sr: number): Float32Array[] {
  const delay = Math.round((60 / 74) * sr);
  return channels.map((ch) => {
    const echo = new Float32Array(ch.length);
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const fed = i >= delay ? (ch[i - delay] ?? 0) + 0.3 * (echo[i - delay] ?? 0) : 0;
      echo[i] = fed;
      out[i] = (ch[i] ?? 0) + 0.2 * fed;
    }
    return out;
  });
}

/** Excerpted WAV write with this script's window (shared writer lives in
 * offline-harness.ts). */
function writeWav(path: string, channels: Float32Array[], sampleRate: number): void {
  writeWavShared(path, channels, sampleRate, WAV_START_S, WAV_SECONDS);
}

async function main(): Promise<void> {
  console.log(
    `Crush recipe comparison — seed ${SEED}, keys-only, ${RENDER_SECONDS}s @ ${DEFAULT_SAMPLE_RATE} Hz`,
  );
  console.log(`Error metrics over ${BAND_LO} Hz–${BAND_HI / 1000} kHz. WAVs → ${OUT_DIR}/\n`);

  const buffer = await renderChain({
    seed: SEED,
    seconds: RENDER_SECONDS,
    noteChannels: [Channels.RHODES_CHORD, Channels.RHODES_MELODY],
    lofi: { reverbDecay: 0.05 },
  });
  const clean: Float32Array[] = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const cleanMono = monoMix(buffer);
  const signalRms = rmsDb(cleanMono);
  console.log(`clean render done (signal RMS ${signalRms.toFixed(1)} dB)\n`);

  mkdirSync(OUT_DIR, { recursive: true });

  const header = [
    'recipe'.padEnd(28),
    'errRel dB'.padStart(10),
    'flatness'.padStart(9),
    'peakProm dB'.padStart(12),
    '%>1.8k'.padStart(8),
  ].join('');
  console.log(header);

  for (const recipe of RECIPES) {
    const processed = recipe.process(
      clean.map((ch) => Float32Array.from(ch)),
      DEFAULT_SAMPLE_RATE,
    );
    writeWav(`${OUT_DIR}/${recipe.file}.wav`, processed, DEFAULT_SAMPLE_RATE);

    if (recipe.process === identity) {
      console.log(`${recipe.label.padEnd(28)}${'—'.padStart(10)} (reference)`);
      continue;
    }
    const err = new Float32Array(cleanMono.length);
    const procL = processed[0];
    const procR = processed[1] ?? procL;
    for (let i = 0; i < err.length; i++) {
      const mono = (((procL?.[i] ?? 0) as number) + ((procR?.[i] ?? 0) as number)) / 2;
      err[i] = mono - (cleanMono[i] ?? 0);
    }
    const psd = welchPsd(err, FFT_SIZE);
    const errRel = rmsDb(err) - signalRms;
    const flatness = spectralFlatness(psd, DEFAULT_SAMPLE_RATE, FFT_SIZE, BAND_LO, BAND_HI);
    const prom = peakProminenceDb(psd, DEFAULT_SAMPLE_RATE, FFT_SIZE, BAND_LO, BAND_HI);
    // Share of error power above the evoFilter cutoff.
    const binHz = DEFAULT_SAMPLE_RATE / FFT_SIZE;
    let below = 0;
    let above = 0;
    for (let k = 1; k < psd.length; k++) {
      if (k * binHz >= 1800) above += psd[k] ?? 0;
      else below += psd[k] ?? 0;
    }
    const pctAbove = (100 * above) / (above + below + 1e-20);
    console.log(
      [
        recipe.label.padEnd(28),
        errRel.toFixed(1).padStart(10),
        flatness.toFixed(3).padStart(9),
        prom.toFixed(1).padStart(12),
        pctAbove.toFixed(0).padStart(8),
      ].join(''),
    );
  }

  // Production-placement warmth check: in the real chain the crush sits
  // BEFORE the master warmth LP (default warmHz(0.7) ≈ 4.6 kHz, −24 dB/oct);
  // the approved offline recipes were applied after it. Warmth is LTI, so
  // error_production = warmth(error_offline): filter recipe 19's error
  // signal and compare levels — the exact amount of character warmth eats.
  {
    const winner = compose(srrLin(4), quant(12, true));
    const processed = winner(
      clean.map((ch) => Float32Array.from(ch)),
      DEFAULT_SAMPLE_RATE,
    );
    const err = new Float32Array(cleanMono.length);
    const pl = processed[0];
    const pr = processed[1] ?? pl;
    for (let i = 0; i < err.length; i++) {
      err[i] = ((pl?.[i] ?? 0) + (pr?.[i] ?? 0)) / 2 - (cleanMono[i] ?? 0);
    }
    const filteredErr = lp(4630)([err], DEFAULT_SAMPLE_RATE)[0];
    if (filteredErr) {
      const before = rmsDb(err) - signalRms;
      const after = rmsDb(filteredErr) - signalRms;
      console.log(
        `\nwarmth-placement check (recipe 19): character ${before.toFixed(1)} dB rel before warmth, ` +
          `${after.toFixed(1)} dB rel after (warmth eats ${(before - after).toFixed(1)} dB)`,
      );
    }
  }

  // In-mix audibility check: recipe 19 was approved on SOLO keys; in the app
  // it competes with drums/bass/pad/beds. Render the non-keys mix separately
  // (sources are independent, mixing is linear, so summing separate renders
  // ≈ the full mix), sum with clean vs crushed keys, and measure the
  // character relative to the FULL mix. Also writes one decisive A/B WAV
  // pair for when ears are fresh.
  {
    const restBuf = await renderChain({
      seed: SEED,
      seconds: RENDER_SECONDS,
      noteChannels: [
        Channels.BASS,
        Channels.KICK,
        Channels.SNARE,
        Channels.HAT,
        Channels.PAD,
        Channels.BELL,
      ],
      lofi: { reverbDecay: 0.05 },
    });
    const rest: Float32Array[] = [restBuf.getChannelData(0), restBuf.getChannelData(1)];
    const winner = compose(srrLin(4), quant(12, true));
    const crushedKeys = winner(
      clean.map((ch) => Float32Array.from(ch)),
      DEFAULT_SAMPLE_RATE,
    );
    const mixClean = clean.map((ch, c) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = (ch[i] ?? 0) + (rest[c]?.[i] ?? 0);
      return out;
    });
    const mixCrushed = crushedKeys.map((ch, c) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = (ch[i] ?? 0) + (rest[c]?.[i] ?? 0);
      return out;
    });
    writeWav(`${OUT_DIR}/21-mix-clean.wav`, mixClean, DEFAULT_SAMPLE_RATE);
    writeWav(`${OUT_DIR}/22-mix-crushed.wav`, mixCrushed, DEFAULT_SAMPLE_RATE);
    const mixMonoClean = new Float32Array(cleanMono.length);
    for (let i = 0; i < mixMonoClean.length; i++) {
      mixMonoClean[i] =
        (((mixClean[0]?.[i] ?? 0) as number) + ((mixClean[1]?.[i] ?? 0) as number)) / 2;
    }
    const errMix = new Float32Array(cleanMono.length);
    for (let i = 0; i < errMix.length; i++) {
      const cm =
        (((mixCrushed[0]?.[i] ?? 0) as number) + ((mixCrushed[1]?.[i] ?? 0) as number)) / 2;
      errMix[i] = cm - (mixMonoClean[i] ?? 0);
    }
    console.log(
      `\nin-mix audibility (recipe 19): character ${(rmsDb(errMix) - rmsDb(mixMonoClean)).toFixed(1)} dB rel FULL mix ` +
        `(was ${(rmsDb(errMix) - signalRms).toFixed(1)} dB rel solo keys) — WAVs: 21-mix-clean / 22-mix-crushed`,
    );
  }

  // Chord-buzz diagnosis + fix candidates (2026-07-08 ear report: "slight
  // buzzing, probably from the chord bitcrushing"). Sustained chords make
  // the FOH imaging STEADY (tonal buzz); short melody notes make it
  // transient (grit). Confirm by comparing the recipe-19 error tonality on
  // chord-only vs melody-only renders, then render three fix candidates
  // in-mix (the approval lesson: judge in-mix, never solo).
  {
    const winner = compose(srrLin(4), quant(12, true));
    const imgLo = 3000; // FOH /4 imaging band at 32 kHz: ~5-11 k, tails to 3 k
    const imgHi = 11000;
    const errOf = (chs: Float32Array[], proc: Process): Float32Array => {
      const p = proc(
        chs.map((ch) => Float32Array.from(ch)),
        DEFAULT_SAMPLE_RATE,
      );
      const e = new Float32Array(chs[0]?.length ?? 0);
      for (let i = 0; i < e.length; i++) {
        const pm = (((p[0]?.[i] ?? 0) as number) + ((p[1]?.[i] ?? 0) as number)) / 2;
        const cm = (((chs[0]?.[i] ?? 0) as number) + ((chs[1]?.[i] ?? 0) as number)) / 2;
        e[i] = pm - cm;
      }
      return e;
    };
    const toChs = (b: Awaited<ReturnType<typeof renderChain>>): Float32Array[] => [
      b.getChannelData(0),
      b.getChannelData(1),
    ];
    const kOpts = { seed: SEED, seconds: RENDER_SECONDS, lofi: { reverbDecay: 0.05 } };
    const chordChs = toChs(await renderChain({ ...kOpts, noteChannels: [Channels.RHODES_CHORD] }));
    const melodyChs = toChs(
      await renderChain({ ...kOpts, noteChannels: [Channels.RHODES_MELODY] }),
    );
    const restChs = toChs(
      await renderChain({
        ...kOpts,
        noteChannels: [
          Channels.BASS,
          Channels.KICK,
          Channels.SNARE,
          Channels.HAT,
          Channels.PAD,
          Channels.BELL,
        ],
      }),
    );
    for (const [label, chs] of [
      ['chord-only', chordChs],
      ['melody-only', melodyChs],
    ] as const) {
      const psd = welchPsd(errOf(chs, winner), FFT_SIZE);
      console.log(
        `\nbuzz check — recipe-19 error on ${label}: ` +
          `peakProm ${peakProminenceDb(psd, DEFAULT_SAMPLE_RATE, FFT_SIZE, imgLo, imgHi).toFixed(1)} dB, ` +
          `flatness ${spectralFlatness(psd, DEFAULT_SAMPLE_RATE, FFT_SIZE, imgLo, imgHi).toFixed(3)} (${imgLo / 1000}-${imgHi / 1000} kHz)`,
      );
    }
    const sum = (...parts: Float32Array[][]): Float32Array[] =>
      [0, 1].map((c) => {
        const out = new Float32Array(parts[0]?.[c]?.length ?? 0);
        for (const part of parts) {
          const ch = part[c];
          for (let i = 0; i < out.length; i++) out[i] += ch?.[i] ?? 0;
        }
        return out;
      });
    const crush = (chs: Float32Array[], proc: Process): Float32Array[] =>
      proc(
        chs.map((ch) => Float32Array.from(ch)),
        DEFAULT_SAMPLE_RATE,
      );
    // Candidates. NB 24 sums three renders (3× brown bed vs 2× elsewhere —
    // slight bed boost, disclosed, fine for A/B of the crush character).
    writeWav(
      `${OUT_DIR}/23-mix-19-rate3.wav`,
      sum(crush(clean, compose(srrLin(3), quant(12, true))), restChs),
      DEFAULT_SAMPLE_RATE,
    );
    writeWav(
      `${OUT_DIR}/24-mix-melody-only-crush.wav`,
      sum(crush(melodyChs, winner), chordChs, restChs),
      DEFAULT_SAMPLE_RATE,
    );
    writeWav(
      `${OUT_DIR}/25-mix-19-postlp6k5.wav`,
      sum(crush(clean, compose(srrLin(4), quant(12, true), lp(6500))), restChs),
      DEFAULT_SAMPLE_RATE,
    );
    console.log('fix candidates written: 23 (rate 3), 24 (melody-only crush), 25 (post-LP 6.5k)');
  }

  // Production-placement simulation: the real chain crushes BEFORE the
  // chord-echo send, so repeats are clean copies OF the crushed signal.
  // Rendering echo-free, crushing, then adding a JS echo tests whether the
  // "rattle" is really the decimated echo/tail imaging of the post-chain
  // placement above (which production would never have).
  const dryBuf = await renderChain({
    seed: SEED,
    seconds: RENDER_SECONDS,
    noteChannels: [Channels.RHODES_CHORD, Channels.RHODES_MELODY],
    lofi: { reverbDecay: 0.05 },
    params: { 'fx.chordEcho.wet': 0 },
  });
  const dry: Float32Array[] = [dryBuf.getChannelData(0), dryBuf.getChannelData(1)];
  writeWav(
    `${OUT_DIR}/14-placement-clean.wav`,
    addEcho(dry, DEFAULT_SAMPLE_RATE),
    DEFAULT_SAMPLE_RATE,
  );
  const crushedDry = srr(3)(
    dry.map((ch) => Float32Array.from(ch)),
    DEFAULT_SAMPLE_RATE,
  );
  writeWav(
    `${OUT_DIR}/15-placement-srr3.wav`,
    addEcho(crushedDry, DEFAULT_SAMPLE_RATE),
    DEFAULT_SAMPLE_RATE,
  );
  console.log('\nplacement sim: 14-placement-clean.wav (reference) / 15-placement-srr3.wav');

  console.log('\nReading guide: producer "dust" = high flatness + low peak prominence.');
  console.log('Undithered-quant "buzz" = low flatness + high prominence. errRel dB says');
  console.log('how loud the character is; %>1.8k says how much survives the evoFilter');
  console.log('regime in production placement.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
