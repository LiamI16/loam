import type { Engine, EngineEvent, NoteEvent, ParamEvent, TickEvent } from '@loam/core';
import * as Tone from 'tone';

/** How far ahead of the audio clock the engine pre-schedules, in seconds. */
const LOOKAHEAD_SEC = 0.2;
/** How often the adapter polls the engine for the next chunk of events. */
const TICK_INTERVAL_MS = 25;

/**
 * The single layer that talks to Tone.js. Owns a registry of named channels
 * (`PolySynth` instances), pulls events from an `Engine` via a periodic
 * scheduling loop, and dispatches them to Web Audio with sample-accurate
 * timing. See docs/event-protocol.md §3 (lookahead scheduling).
 */
export class ToneAudioAdapter {
  private readonly channels = new Map<string, Tone.PolySynth>();
  private engine: Engine | null = null;
  private startAudioTime = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tickListeners: Array<(ev: TickEvent) => void> = [];

  /** Register a synth voice under a channel name. Idempotent. */
  registerChannel(name: string, synth: Tone.PolySynth): void {
    this.channels.set(name, synth);
  }

  /** Attach the engine the adapter will pull events from. */
  setEngine(engine: Engine): void {
    this.engine = engine;
  }

  /** Subscribe to `tick` events for UI (e.g. driving an ember pulse). */
  onTick(listener: (ev: TickEvent) => void): void {
    this.tickListeners.push(listener);
  }

  /**
   * Resume the AudioContext, anchor engine-time to the current audio time,
   * and start the scheduling loop. Must be called from a user gesture.
   */
  async start(): Promise<void> {
    await Tone.start();
    this.engine?.reset();
    this.startAudioTime = Tone.now();
    this.pumpOnce();
    this.intervalId = setInterval(() => this.pumpOnce(), TICK_INTERVAL_MS);
  }

  /** Stop the scheduling loop. Already-scheduled audio events will finish. */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private pumpOnce(): void {
    if (!this.engine) return;
    const engineNow = Tone.now() - this.startAudioTime;
    const until = engineNow + LOOKAHEAD_SEC;
    const events = this.engine.scheduleUntil(until);
    for (const event of events) {
      this.dispatch(event);
    }
  }

  private dispatch(event: EngineEvent): void {
    switch (event.kind) {
      case 'note':
        this.dispatchNote(event);
        return;
      case 'param':
        this.dispatchParam(event);
        return;
      case 'tick':
        for (const fn of this.tickListeners) fn(event);
        return;
    }
  }

  private dispatchNote(event: NoteEvent): void {
    const synth = this.channels.get(event.channel);
    if (!synth) {
      console.warn(`[loam] no synth registered for channel "${event.channel}"`);
      return;
    }
    const freq = Tone.Frequency(event.pitch, 'midi').toFrequency();
    const durationSec = event.durationMs / 1000;
    const audioTime = this.startAudioTime + event.time;
    synth.triggerAttackRelease(freq, durationSec, audioTime, event.velocity);
  }

  private dispatchParam(_event: ParamEvent): void {
    // TODO Stage 4+: route dotted-path targets (master.warmth, fx.chorus.depth, ...)
    // to real Tone.js parameters with rampTo. Stage-3 vamp doesn't emit any.
  }
}
