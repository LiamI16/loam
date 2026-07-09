/**
 * Shared offline-render harness for the dev analysis scripts
 * (crush-spectrum.ts, crush-recipes.ts; pattern originated in
 * profile-chain.ts): builds the REAL lofi chain on an OfflineContext, feeds
 * it a real EmberEngine event stream, returns the rendered buffer.
 *
 * Run any consumer via scripts/profile-chain.sh <entry.ts> (esbuild bundle +
 * node-web-audio-api polyfill). Dev-only; not shipped.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmberEngine, type EngineEvent, Seed } from '@loam/core';
import * as Tone from 'tone';
import { buildLofiChain, type LofiChainOptions } from '../src/chains/lofi.js';
import {
  samplerCrushReady,
  setSamplerCrushModuleUrlProvider,
} from '../src/chains/sampler-crush.js';
import { DEFAULT_SAMPLE_RATE } from '../src/constants.js';
import type { ChannelRegistration, ParamSetter } from '../src/types.js';

/** Production default (docs/audio-cpu-plan.md). Imported from the package's
 * single source of truth, and re-exported so scripts can keep importing it
 * from the harness. */
export { DEFAULT_SAMPLE_RATE };

// node-web-audio-api (≥2.0) runs AudioWorklets in offline renders, but its
// addModule can't fetch blob: URLs — hand the processor source over as a
// real temp file instead. This closes the sim gap: offline renders now
// exercise the REAL sampler-crush worklet in the REAL chain topology.
setSamplerCrushModuleUrlProvider(async (src) => {
  const path = join(mkdtempSync(join(tmpdir(), 'loam-worklet-')), 'sampler-crush.js');
  writeFileSync(path, src);
  return path;
});

export function engineEvents(seed: bigint, seconds: number): EngineEvent[] {
  const engine = new EmberEngine(Seed.from(seed), { bpm: 74 });
  engine.reset();
  return engine.scheduleUntil(seconds).filter((e) => e.time >= 0 && e.time <= seconds);
}

/** Minimal adapter stub: master Gain on the current offline context +
 * channel/param registries. Exercises the real lofi.ts code. */
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

export interface RenderConfig {
  seed?: bigint;
  seconds?: number;
  sampleRate?: number;
  lofi?: LofiChainOptions;
  /** If set, only note events on these channels fire (param events always
   * apply — evoFilter sweeps etc. are part of the keys sound). */
  noteChannels?: readonly string[];
  /** Mute the rain bed (default true — it's nondeterministic noise that only
   * widens the comparison floor). The brown bed has no level param and stays
   * in every render. */
  muteRain?: boolean;
  /** Param values applied after all engine events (override anything the
   * engine set), e.g. `{ 'fx.chordEcho.wet': 0 }` to render echo-free. */
  params?: Record<string, number>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function renderChain(cfg: RenderConfig = {}): Promise<Tone.ToneAudioBuffer> {
  const seed = cfg.seed ?? 42n;
  const seconds = cfg.seconds ?? 24;
  const events = engineEvents(seed, seconds);
  const sampleRate = cfg.sampleRate ?? DEFAULT_SAMPLE_RATE;
  // Wrap the NATIVE (polyfilled) OfflineAudioContext rather than letting
  // Tone build one via standardized-audio-context — mirrors production
  // (which wraps a native AudioContext) and, critically, gives
  // `rawContext.audioWorklet` so the sampler-crush worklet runs offline.
  const context = new Tone.OfflineContext(
    new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate),
  );
  const original = Tone.getContext();
  Tone.setContext(context);
  try {
    const adapter = new StubAdapter();
    // biome-ignore lint/suspicious/noExplicitAny: stub matches the structural surface buildLofiChain uses.
    buildLofiChain(adapter as any, cfg.lofi);
    if (cfg.muteRain ?? true) adapter.params.get('bed.rain.level')?.set(-120);
    for (const ev of events) {
      if (ev.kind === 'note') {
        if (cfg.noteChannels && !cfg.noteChannels.includes(ev.channel)) continue;
        adapter.channels.get(ev.channel)?.trigger(ev, ev.time);
      } else if (ev.kind === 'param') {
        const setter = adapter.params.get(ev.target);
        if (!setter) continue;
        if (ev.rampMs && ev.rampMs > 0) setter.ramp(ev.value, ev.rampMs / 1000, ev.time);
        else setter.set(ev.value);
      }
    }
    for (const [target, value] of Object.entries(cfg.params ?? {})) {
      adapter.params.get(target)?.set(value);
    }
    // Don't race the async worklet splice — a render that starts before the
    // install completes silently measures the pass-through instead.
    await samplerCrushReady();
    await sleep(250); // let the nested reverb-IR render resolve
    return await context.render();
  } finally {
    Tone.setContext(original);
  }
}

/** 16-bit PCM WAV writer (interleaved, excerpt). Shared by the analysis
 * scripts so rendered comparisons are listenable artifacts, not just
 * numbers. */
export function writeWav(
  path: string,
  channels: Float32Array[],
  sampleRate: number,
  startSeconds = 0,
  seconds = Number.POSITIVE_INFINITY,
): void {
  const start = Math.floor(startSeconds * sampleRate);
  const frames = Math.max(
    0,
    Math.min(Math.floor(seconds * sampleRate), (channels[0]?.length ?? 0) - start),
  );
  const nCh = channels.length;
  const dataBytes = frames * nCh * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(nCh, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * nCh * 2, 28);
  buf.writeUInt16LE(nCh * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      const v = Math.max(-1, Math.min(1, ch[start + i] ?? 0));
      buf.writeInt16LE(Math.round(v * 32767), off);
      off += 2;
    }
  }
  writeFileSync(path, buf);
}
