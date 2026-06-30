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
}

/** (A) Render the full chain for one seed and return render wall-clock ms. */
async function renderFull(seed: bigint, ro: RenderOpts = {}): Promise<number> {
  const events = engineEvents(seed, RENDER_SECONDS);
  const t0 = performance.now();
  await Tone.Offline(
    () => {
      const adapter = new StubAdapter();
      // biome-ignore lint/suspicious/noExplicitAny: stub matches the structural surface buildLofiChain uses.
      buildLofiChain(adapter as any, ro.lofi);
      // Rain defaults on (.start()); the UI sets it silent when off. Mirror the
      // off path so Task-2's source-gating shows up in the render (sets the
      // level below the chain's stop threshold → source + biquads stop).
      if (ro.rainOff) adapter.params.get('bed.rain.level')?.set(-120);
      for (const ev of events) {
        if (ev.kind === 'note') {
          const reg = adapter.channels.get(ev.channel);
          reg?.trigger(ev, ev.time);
        } else if (ev.kind === 'param') {
          const setter = adapter.params.get(ev.target);
          if (!setter) continue;
          if (ev.rampMs && ev.rampMs > 0) setter.ramp(ev.value, ev.rampMs / 1000, ev.time);
          else setter.set(ev.value);
        }
      }
    },
    RENDER_SECONDS,
    2,
    SAMPLE_RATE,
  );
  return performance.now() - t0;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const hi = s[m] ?? 0;
  const lo = s[m - 1] ?? hi;
  return s.length % 2 ? hi : (lo + hi) / 2;
}

async function fullGraph(label: string, ro: RenderOpts = {}): Promise<number> {
  const times: number[] = [];
  for (const seed of SEEDS) times.push(await renderFull(seed, ro));
  const med = median(times);
  console.log(
    `  ${label.padEnd(28)} median ${med.toFixed(1)} ms  (per-seed: ${times
      .map((t) => t.toFixed(0))
      .join(', ')})`,
  );
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

  console.log('\n=== (A) Full-graph render time ===');
  console.log('  (Phase-1 caps baked in; reverb IR is async so the convolver may');
  console.log('   render silent here — trust part (B) for the reverb A/B, not these)');
  const capped = await fullGraph('Phase 1 (stereo reverb)');
  const cappedRainOff = await fullGraph('  + rain OFF (Task 2)', { rainOff: true });
  console.log(`  -> rain-off saving: ${(100 * (1 - cappedRainOff / capped)).toFixed(1)}%`);

  console.log('\n=== (A2) Phase-2 flags — exercises mono-reverb code path ===');
  await fullGraph('mono reverb (Task 3)', { lofi: { monoReverb: true } });
  await fullGraph('mono reverb + decay 3', { lofi: { monoReverb: true, reverbDecay: 3 } });
  await fullGraph('mono bed (Task 5)', { lofi: { monoBed: true } });
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
