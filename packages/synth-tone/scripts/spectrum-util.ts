/**
 * Shared spectral-analysis helpers for the dev analysis scripts
 * (crush-spectrum.ts, crush-recipes.ts). Pure JS — no Web Audio. Dev-only.
 */

import type * as Tone from 'tone';

/** In-place iterative radix-2 FFT (re/im). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k] ?? 0;
        const ai = im[i + k] ?? 0;
        const br = (re[i + k + len / 2] ?? 0) * cr - (im[i + k + len / 2] ?? 0) * ci;
        const bi = (re[i + k + len / 2] ?? 0) * ci + (im[i + k + len / 2] ?? 0) * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Welch-averaged power spectrum (Hann window, 50% overlap). */
export function welchPsd(samples: Float32Array, fftSize: number): Float64Array {
  const hop = fftSize / 2;
  const psd = new Float64Array(fftSize / 2);
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / fftSize));
  let frames = 0;
  for (let start = 0; start + fftSize <= samples.length; start += hop) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = (samples[start + i] ?? 0) * (window[i] ?? 0);
    fft(re, im);
    for (let k = 0; k < fftSize / 2; k++) {
      psd[k] = (psd[k] ?? 0) + (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
    }
    frames++;
  }
  for (let k = 0; k < psd.length; k++) psd[k] = (psd[k] ?? 0) / Math.max(frames, 1);
  return psd;
}

function binRange(
  sampleRate: number,
  fftSize: number,
  lo: number,
  hi: number,
  len: number,
): [number, number] {
  const binHz = sampleRate / fftSize;
  return [Math.max(1, Math.ceil(lo / binHz)), Math.min(Math.floor(hi / binHz), len)];
}

/** Total band power in dB. */
export function bandDb(
  psd: Float64Array,
  sampleRate: number,
  fftSize: number,
  lo: number,
  hi: number,
): number {
  const [k0, k1] = binRange(sampleRate, fftSize, lo, hi, psd.length);
  let power = 0;
  for (let k = k0; k < k1; k++) power += psd[k] ?? 0;
  return 10 * Math.log10(power + 1e-20);
}

/**
 * Spectral flatness (0..1) over a band: geometric / arithmetic mean of PSD
 * bins. ~1 = noise-like ("dust"); → 0 = tonal lines ("buzz").
 */
export function spectralFlatness(
  psd: Float64Array,
  sampleRate: number,
  fftSize: number,
  lo: number,
  hi: number,
): number {
  const [k0, k1] = binRange(sampleRate, fftSize, lo, hi, psd.length);
  let logSum = 0;
  let sum = 0;
  let n = 0;
  for (let k = k0; k < k1; k++) {
    const p = (psd[k] ?? 0) + 1e-20;
    logSum += Math.log(p);
    sum += p;
    n++;
  }
  if (n === 0) return 1;
  return Math.exp(logSum / n) / (sum / n + 1e-20);
}

/**
 * Harmonic-line prominence in dB: strongest PSD bin over the band median.
 * High = a dominant discrete tone (buzz); low = no line sticks out.
 */
export function peakProminenceDb(
  psd: Float64Array,
  sampleRate: number,
  fftSize: number,
  lo: number,
  hi: number,
): number {
  const [k0, k1] = binRange(sampleRate, fftSize, lo, hi, psd.length);
  const bins: number[] = [];
  for (let k = k0; k < k1; k++) bins.push((psd[k] ?? 0) + 1e-20);
  if (bins.length === 0) return 0;
  const sorted = [...bins].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 1e-20;
  const max = sorted[sorted.length - 1] ?? 1e-20;
  return 10 * Math.log10(max / median);
}

export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2;
  return 10 * Math.log10(sum / samples.length + 1e-20);
}

/** Average a rendered buffer's channels into one mono Float32Array. */
export function monoMix(buffer: Tone.ToneAudioBuffer | AudioBuffer): Float32Array {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = ((left[i] ?? 0) + (right[i] ?? 0)) / 2;
  return mono;
}
