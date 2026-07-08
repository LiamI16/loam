/**
 * Shared offline-render harness for the dev analysis scripts
 * (crush-spectrum.ts, crush-recipes.ts; pattern originated in
 * profile-chain.ts): builds the REAL lofi chain on an OfflineContext, feeds
 * it a real EmberEngine event stream, returns the rendered buffer.
 *
 * Run any consumer via scripts/profile-chain.sh <entry.ts> (esbuild bundle +
 * node-web-audio-api polyfill). Dev-only; not shipped.
 */

import { EmberEngine, type EngineEvent, Seed } from '@loam/core';
import * as Tone from 'tone';
import { buildLofiChain, type LofiChainOptions } from '../src/chains/lofi.js';
import type { ChannelRegistration, ParamSetter } from '../src/types.js';

/** Production default (docs/audio-cpu-plan.md). */
export const DEFAULT_SAMPLE_RATE = 32000;

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
  const context = new Tone.OfflineContext(2, seconds, cfg.sampleRate ?? DEFAULT_SAMPLE_RATE);
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
    await sleep(250); // let the nested reverb-IR render resolve
    return await context.render();
  } finally {
    Tone.setContext(original);
  }
}
