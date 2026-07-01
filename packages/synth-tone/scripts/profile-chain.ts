/**
 * Phase-0 measurement harness for docs/audio-cpu-plan.md.
 *
 * Two things this measures, per that doc's Phase-0 protocol:
 *
 *  (A) Full-graph offline render time — the DSP "floor" proxy. We build the
 *      REAL lofi chain (`buildLofiChain`), feed it a real EmberEngine event
 *      stream for several seconds, render it in an OfflineAudioContext, and
 *      time `context.render()` wall-clock. That is pure DSP cost with zero
 *      browser-overhead noise; the *ratios* port to Windows even though the
 *      absolute ms don't. This is the before/after number for Tasks 1-2.
 *
 *  (B) Isolated reverb-node profiling — stereo IR vs mono IR vs short decay,
 *      a noise→ConvolverNode graph rendered in isolation. Informs whether
 *      Phase 2 (the suspected dominant cost) is worth it, without touching
 *      production code.
 *
 *  (C) Max concurrent voices per PolySynth (keysChord / keysMelody / pad),
 *      computed from the engine event stream + each synth's release tail,
 *      across several seeds. Feeds the Task-1 maxPolyphony caps. Pad matters
 *      most (4 s release → heavy overlap).
 *
 * Run via scripts/profile-chain.sh (bundles with esbuild, runs on Node with
 * the node-web-audio-api Web Audio polyfill). Dev-only; not shipped.
 */

import { Channels, EmberEngine, type EngineEvent, type NoteEvent, Seed } from '@loam/core';
import * as Tone from 'tone';
import { buildLofiChain, type LofiChainOptions } from '../src/chains/lofi.js';
import type { ChannelRegistration, ParamSetter } from '../src/types.js';

const SEEDS = [42n, 1n, 2n, 7n, 99n, 1234n];
const RENDER_SECONDS = 24;
const SAMPLE_RATE = 44100;
// Release tails per voice (seconds) — from lofi.ts envelopes. A voice is held
// from its attack until duration + release elapse, then Tone frees it.
const RELEASE: Record<string, number> = {
  [Channels.RHODES_CHORD]: 0.8,
  [Channels.RHODES_MELODY]: 0.8,
  [Channels.PAD]: 4,
};

function engineEvents(seed: bigint, seconds: number): EngineEvent[] {
  const engine = new EmberEngine(Seed.from(seed), { bpm: 74 });
  engine.reset();
  return engine.scheduleUntil(seconds).filter((e) => e.time >= 0 && e.time <= seconds);
}

/** (C) Max concurrent voices for one channel given its release tail. */
function maxConcurrent(notes: NoteEvent[], release: number): number {
  const starts = notes.map((n) => n.time);
  const ends = notes.map((n) => n.time + n.durationMs / 1000 + release);
  const points: Array<[number, number]> = [];
  for (const s of starts) points.push([s, 1]);
  for (const e of ends) points.push([e, -1]);
  // Process releases before attacks at an equal timestamp (a freed voice can
  // be reused) — sort by time, then by delta ascending (-1 before +1).
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of points) {
    cur += d;
    if (cur > max) max = cur;
  }
  return max;
}

function voiceCounts(): void {
  console.log('\n=== (C) Max concurrent voices per PolySynth (release-tail model) ===');
  const channels = [Channels.RHODES_CHORD, Channels.RHODES_MELODY, Channels.PAD];
  const overall: Record<string, number> = {};
  for (const seed of SEEDS) {
    const evs = engineEvents(seed, RENDER_SECONDS).filter((e): e is NoteEvent => e.kind === 'note');
    const row: string[] = [];
    for (const ch of channels) {
      const m = maxConcurrent(
        evs.filter((e) => e.channel === ch),
        RELEASE[ch] ?? 0,
      );
      overall[ch] = Math.max(overall[ch] ?? 0, m);
      row.push(`${ch}=${m}`);
    }
    console.log(`  seed ${String(seed).padStart(5)}: ${row.join('  ')}`);
  }
  console.log(`  ----`);
  console.log(`  MAX across seeds: ${channels.map((c) => `${c}=${overall[c]}`).join('  ')}`);
  console.log('  Suggested maxPolyphony (max + 50%, floor 8):');
  for (const ch of channels) {
    const cap = Math.max(8, Math.ceil((overall[ch] ?? 0) * 1.5));
    console.log(`    ${ch}: ${cap}`);
  }
}

/** Minimal adapter stub: a master Gain on the *current* (offline) context, a
 * channel registry, and a param registry. Exercises the real lofi.ts code. */
class StubAdapter {
  readonly master: Tone.Gain;
  readonly channels = new Map<string, ChannelRegistration>();
  readonly params = new Map<string, ParamSetter>();
  constructor() {
    this.master = new Tone.Gain(0.9).toDestination();
  }
  registerChannel(name: string, reg: ChannelRegistration): void {
    this.channels.set(name, reg);
  }
  registerParam(target: string, setter: ParamSetter): void {
    this.params.set(target, setter);
  }
}

interface RenderOpts {
  rainOff?: boolean;
  lofi?: LofiChainOptions;
  /** Skip all note/param events → measures the always-on "floor" only. */
  noEvents?: boolean;
  /** Render sample rate. Defaults to SAMPLE_RATE. Lowering it scales the whole
   * graph (floor + note synthesis) ~linearly — the biggest single lever. */
  sampleRate?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * (A) Render the full chain for one seed and return the render wall-clock ms.
 *
 * Done manually (rather than via `Tone.Offline`) for two reasons: (1) the
 * reverb IR — stereo `Tone.Reverb` or our mono convolver — is generated in a
 * *nested* async OfflineContext, so we build the graph, wait for the IR to
 * actually load, and only THEN start+time `render()`; otherwise the convolver
 * renders silent and the reverb's cost (the whole point) vanishes into noise.
 * (2) Timing only `render()` keeps the IR-load wait out of the measurement.
 */
async function renderFull(seed: bigint, ro: RenderOpts = {}): Promise<number> {
  const events = engineEvents(seed, RENDER_SECONDS);
  const context = new Tone.OfflineContext(2, RENDER_SECONDS, ro.sampleRate ?? SAMPLE_RATE);
  const original = Tone.getContext();
  Tone.setContext(context);
  try {
    const adapter = new StubAdapter();
    // biome-ignore lint/suspicious/noExplicitAny: stub matches the structural surface buildLofiChain uses.
    buildLofiChain(adapter as any, ro.lofi);
    // Rain defaults on (.start()); the UI sets it silent when off. Mirror the
    // off path so Task-2's source-gating shows up in the render.
    if (ro.rainOff) adapter.params.get('bed.rain.level')?.set(-120);
    for (const ev of ro.noEvents ? [] : events) {
      if (ev.kind === 'note') {
        adapter.channels.get(ev.channel)?.trigger(ev, ev.time);
      } else if (ev.kind === 'param') {
        const setter = adapter.params.get(ev.target);
        if (!setter) continue;
        if (ev.rampMs && ev.rampMs > 0) setter.ramp(ev.value, ev.rampMs / 1000, ev.time);
        else setter.set(ev.value);
      }
    }
    // Let the nested IR render(s) resolve so the convolver has its buffer.
    await sleep(250);
    const t0 = performance.now();
    await context.render();
    return performance.now() - t0;
  } finally {
    Tone.setContext(original);
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const hi = s[m] ?? 0;
  const lo = s[m - 1] ?? hi;
  return s.length % 2 ? hi : (lo + hi) / 2;
}

const REPEATS = 3;

async function fullGraph(label: string, ro: RenderOpts = {}): Promise<number> {
  // Same 6 workloads under every config; repeat each to damp measurement
  // noise, then take the median of all render times. Since every config sees
  // the identical seed set, the medians are directly comparable.
  const times: number[] = [];
  for (let r = 0; r < REPEATS; r++) {
    for (const seed of SEEDS) times.push(await renderFull(seed, ro));
  }
  const med = median(times);
  console.log(`  ${label.padEnd(26)} median ${med.toFixed(1)} ms  (n=${times.length})`);
  return med;
}

/** (B) Isolated reverb convolution cost: noise → Convolver(IR) → dest. */
function makeIR(
  ctx: OfflineAudioContext,
  channels: number,
  decay: number,
  preDelay: number,
): AudioBuffer {
  const len = Math.floor((decay + preDelay) * SAMPLE_RATE);
  const buf = ctx.createBuffer(channels, len, SAMPLE_RATE);
  for (let c = 0; c < channels; c++) {
    const data = buf.getChannelData(c);
    const pd = Math.floor(preDelay * SAMPLE_RATE);
    for (let i = 0; i < len; i++) {
      const t = (i - pd) / SAMPLE_RATE;
      const env = t < 0 ? 0 : Math.exp((-6.9 * t) / decay); // ~-60dB at `decay`
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buf;
}

async function reverbIsolation(label: string, channels: number, decay: number): Promise<number> {
  const seconds = RENDER_SECONDS;
  const t0 = performance.now();
  // node-web-audio-api exposes OfflineAudioContext globally (polyfilled).
  const ctx = new OfflineAudioContext(2, seconds * SAMPLE_RATE, SAMPLE_RATE);
  const ir = makeIR(ctx, channels, decay, 0.02);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = ir;
  const noise = ctx.createBufferSource();
  const nb = ctx.createBuffer(1, SAMPLE_RATE, SAMPLE_RATE);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  noise.buffer = nb;
  noise.loop = true;
  noise.connect(conv).connect(ctx.destination);
  noise.start();
  await ctx.startRendering();
  const ms = performance.now() - t0;
  console.log(`  ${label.padEnd(28)} ${ms.toFixed(1)} ms`);
  return ms;
}

async function main(): Promise<void> {
  console.log(`Loam audio CPU profiling — ${RENDER_SECONDS}s render, ${SEEDS.length} seeds`);
  console.log('(render ms = OfflineAudioContext wall-clock; ratios matter, not absolutes)');

  voiceCounts();

  console.log('\n=== (B) Isolated reverb convolution cost ===');
  const stereo7 = await reverbIsolation('stereo IR, decay 7 (current)', 2, 7);
  const mono7 = await reverbIsolation('mono IR,   decay 7', 1, 7);
  const stereo3 = await reverbIsolation('stereo IR, decay 3', 2, 3);
  const mono3 = await reverbIsolation('mono IR,   decay 3', 1, 3);
  console.log(`  -> mono halves?    ${(mono7 / stereo7).toFixed(2)}× of stereo`);
  console.log(`  -> decay3 vs 7:    ${(stereo3 / stereo7).toFixed(2)}× of decay7`);
  console.log(`  -> mono+decay3:    ${(mono3 / stereo7).toFixed(2)}× of current`);

  console.log('\n=== (A) Full-graph render time — reverb IR loaded (definitive A/B) ===');
  // Warm up the JIT / allocator so the first real config isn't penalised.
  await renderFull(SEEDS[0] ?? 42n);
  // Explicit old-sound baseline (mono/decay-3/bed are the chain defaults now).
  const OFF: LofiChainOptions = { monoReverb: false, reverbDecay: 7, monoBed: false };
  const base = await fullGraph('OFF: stereo, decay 7', { lofi: OFF });
  const pct = (t: number): string => {
    const d = 100 * (1 - t / base);
    return `${d >= 0 ? '−' : '+'}${Math.abs(d).toFixed(1)}% vs OFF`;
  };
  const monoOnly = await fullGraph('monoverb', { lofi: { monoReverb: true } });
  const decayOnly = await fullGraph('reverbdecay=3', { lofi: { reverbDecay: 3 } });
  const bedOnly = await fullGraph('monobed', { lofi: { monoBed: true } });
  const allOn = await fullGraph('ALL: mono+decay3+bed', {
    lofi: { monoReverb: true, reverbDecay: 3, monoBed: true },
  });
  console.log('  ----');
  console.log(`  monoverb           ${pct(monoOnly)}`);
  console.log(`  reverbdecay=3      ${pct(decayOnly)}`);
  console.log(`  monobed            ${pct(bedOnly)}`);
  console.log(`  ALL three          ${pct(allOn)}`);

  console.log('\n=== (D) Cost composition — where the render time actually goes ===');
  console.log('  (splits note-driven synthesis vs the always-on "floor")');
  const withNotes = base; // full graph, notes on, stereo/decay7 = (A) baseline
  const floor = await fullGraph('always-on floor (no notes)', { noEvents: true });
  // Reverb ~removed: tiny mono IR (0.05s) ≈ negligible convolution.
  const floorNoVerb = await fullGraph('floor − reverb', {
    noEvents: true,
    lofi: { monoReverb: true, reverbDecay: 0.05 },
  });
  const notesOnly = withNotes - floor;
  console.log('  ----');
  console.log(`  full graph (notes on)   ${withNotes.toFixed(0)} ms`);
  console.log(
    `  always-on floor         ${floor.toFixed(0)} ms  (${(100 * (floor / withNotes)).toFixed(0)}% of full)`,
  );
  console.log(
    `  note-driven synthesis   ${notesOnly.toFixed(0)} ms  (${(100 * (notesOnly / withNotes)).toFixed(0)}% of full)`,
  );
  console.log(
    `  reverb's share of floor ${(floor - floorNoVerb).toFixed(0)} ms  (${(100 * (1 - floorNoVerb / floor)).toFixed(0)}% of floor)`,
  );

  console.log('\n=== (E) Sample-rate lever — scales the WHOLE graph (notes + floor) ===');
  const sr44 = await fullGraph('44.1 kHz (current)', { sampleRate: 44100 });
  const sr32 = await fullGraph('32 kHz', { sampleRate: 32000 });
  const sr22 = await fullGraph('22.05 kHz', { sampleRate: 22050 });
  console.log('  ----');
  console.log(`  32 kHz     ${(100 * (1 - sr32 / sr44)).toFixed(1)}% vs 44.1`);
  console.log(`  22.05 kHz  ${(100 * (1 - sr22 / sr44)).toFixed(1)}% vs 44.1`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
