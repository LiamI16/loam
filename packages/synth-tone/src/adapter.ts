import type { Engine, EngineEvent, NoteEvent, ParamEvent, TickEvent } from '@loam/core';
import * as Tone from 'tone';
import type { ChannelRegistration, ParamSetter } from './types.js';

/** How far ahead of the audio clock the engine pre-schedules, in seconds. */
const LOOKAHEAD_SEC = 0.2;
/** How often the adapter polls the engine for the next chunk of events.
 * 50 ms is comfortably below the 200 ms lookahead (so we always stay ahead
 * of the audio clock) while halving the main-thread work vs the previous
 * 25 ms — reduces interaction jank (scroll, tab-switch) without audible
 * effect on scheduling fidelity. */
const TICK_INTERVAL_MS = 50;
/** Master-bus fade-out time when stop() is called. ~10 ms is short enough
 * to feel instant and long enough to avoid an audible click. */
const STOP_FADE_SEC = 0.01;

/** Swap Tone's default audio context for one with `latencyHint: 'playback'`
 * — a ~250–500 ms buffer that survives scroll/background-tab hiccups without
 * audible glitches. The default `'interactive'` hint targets ~10–25 ms,
 * which is too tight for sustained ambient playback. Idempotent. */
let toneContextConfigured = false;
function configureToneContextOnce(): void {
  if (toneContextConfigured) return;
  toneContextConfigured = true;
  Tone.setContext(new Tone.Context({ latencyHint: 'playback' }));
}

/** Inline Web Worker source. The worker exists for one reason: browsers
 * throttle main-thread setInterval to ~1 Hz when a tab/window is hidden or
 * minimized, which starves our 200 ms scheduling lookahead and causes audible
 * dropouts. Worker timers are exempt from that throttling, so we drive the
 * pump clock from here and let the main thread just receive ticks. */
const PUMP_WORKER_SOURCE = `
let id = null;
self.onmessage = (e) => {
  if (e.data && e.data.cmd === 'start') {
    if (id !== null) clearInterval(id);
    id = setInterval(() => self.postMessage('tick'), e.data.intervalMs);
  } else if (e.data && e.data.cmd === 'stop') {
    if (id !== null) { clearInterval(id); id = null; }
  }
};
`;

/**
 * The single layer that talks to Tone.js. Owns:
 *   - A master `Gain` between everything and `Tone.Destination`. Chains
 *     route into it; fades on stop() target it.
 *   - A channel registry of `(trigger, releaseAll?)` callbacks supplied by
 *     chains — works for both pitched (`PolySynth`) and non-pitched
 *     (`NoiseSynth`, `MembraneSynth`) voices.
 *   - A parameter registry of dotted-path → `Tone.Param` mappings. UI
 *     sliders and engine `ParamEvent`s both flow through `setParam(...)`.
 *
 * See `docs/event-protocol.md` and `docs/adapter.md`.
 */
export class ToneAudioAdapter {
  /** Adapter-owned master bus. Chains should connect to this, not
   * `Tone.Destination` directly. Carries the user-facing volume in dB
   * (controlled by the volume slider via `setParam('master.volume', ...)`). */
  readonly master: Tone.Volume;

  /** Internal mute gate between `master` and the destination. Adapter ramps
   * this 0↔1 on start/stop. Separate from `master.volume` so the user's
   * slider position isn't disturbed by play/pause fades. */
  private readonly out: Tone.Gain;

  private readonly channels = new Map<string, ChannelRegistration>();
  private readonly params = new Map<string, ParamSetter>();
  private readonly tickListeners: Array<(ev: TickEvent) => void> = [];

  private engine: Engine | null = null;
  private startAudioTime = 0;
  private pumpWorker: Worker | null = null;
  private pumpWorkerUrl: string | null = null;
  /** Furthest absolute audio time any event has been scheduled at. Used to
   * keep a fresh `start()` from emitting events with a `time` earlier than
   * events still queued from a previous run (Tone's synths reject those). */
  private latestScheduledAudioTime = 0;

  constructor() {
    // Configure the global Tone context with a playback-grade buffer before
    // creating any nodes — must happen first because attached nodes are
    // bound to whatever context is active at construction. Guarded so
    // multiple adapter instances don't spawn multiple contexts.
    configureToneContextOnce();
    this.out = new Tone.Gain(0).toDestination();
    this.master = new Tone.Volume(0).connect(this.out);
  }

  /** Register a voice trigger under a channel name. Idempotent. */
  registerChannel(name: string, registration: ChannelRegistration): void {
    this.channels.set(name, registration);
  }

  /** Register a parameter target (`'master.warmth'`, `'fx.chorus.depth'`). */
  registerParam(target: string, setter: ParamSetter): void {
    this.params.set(target, setter);
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
   * Direct parameter setter — used by UI sliders. Same code path as
   * engine-emitted `ParamEvent`s.
   */
  setParam(target: string, value: number, rampMs = 0): void {
    const setter = this.params.get(target);
    if (!setter) {
      console.warn(`[loam] no param registered for "${target}"`);
      return;
    }
    if (rampMs > 0) setter.ramp(value, rampMs / 1000);
    else setter.set(value);
  }

  /**
   * Resume the AudioContext, anchor engine-time to the current audio time,
   * and start the scheduling loop. Must be called from a user gesture.
   */
  async start(): Promise<void> {
    await Tone.start();
    // Fade the mute gate up. Explicit AudioParam scheduling (rather than
    // Tone's `rampTo`) so the value lands at exactly 1, not asymptotic.
    const now = Tone.now();
    const gain = this.out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(1, now + 0.05);

    this.engine?.reset();
    // Anchor past anything pre-scheduled by a previous run, plus a hair of
    // safety so per-voice "last scheduled" guards don't fire on the very
    // first event. First start: latestScheduledAudioTime == 0, no offset.
    this.startAudioTime = Math.max(Tone.now(), this.latestScheduledAudioTime + 0.005);
    this.pumpOnce();
    this.startPumpClock();
  }

  private startPumpClock(): void {
    if (!this.pumpWorker) {
      this.pumpWorkerUrl = URL.createObjectURL(
        new Blob([PUMP_WORKER_SOURCE], { type: 'application/javascript' }),
      );
      this.pumpWorker = new Worker(this.pumpWorkerUrl);
      this.pumpWorker.onmessage = () => this.pumpOnce();
    }
    this.pumpWorker.postMessage({ cmd: 'start', intervalMs: TICK_INTERVAL_MS });
  }

  private stopPumpClock(): void {
    this.pumpWorker?.postMessage({ cmd: 'stop' });
  }

  /**
   * Stop the scheduling loop and kill audio within ~10 ms. The internal
   * mute gate is linearly ramped to 0 (instant-feeling, click-free), then
   * `releaseAll()` is called on each registered channel that supplies one.
   * Always-on noise sources (brown bed, rain) are silenced too because they
   * route through the gate. See `docs/adapter.md` §7.
   */
  stop(): void {
    this.stopPumpClock();
    const now = Tone.now();
    const gain = this.out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + STOP_FADE_SEC);
    setTimeout(
      () => {
        for (const reg of this.channels.values()) {
          reg.releaseAll?.();
        }
      },
      STOP_FADE_SEC * 1000 + 5,
    );
  }

  private pumpOnce(): void {
    if (!this.engine) return;
    const engineNow = Tone.now() - this.startAudioTime;
    const until = engineNow + LOOKAHEAD_SEC;
    const events = this.engine.scheduleUntil(until);
    for (const event of events) {
      this.dispatch(event);
    }
    // Remember the furthest absolute audio time we've reached so a
    // subsequent start() can anchor past it.
    const absoluteUntil = this.startAudioTime + until;
    if (absoluteUntil > this.latestScheduledAudioTime) {
      this.latestScheduledAudioTime = absoluteUntil;
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
    const reg = this.channels.get(event.channel);
    if (!reg) {
      console.warn(`[loam] no channel registered for "${event.channel}"`);
      return;
    }
    const audioTime = this.startAudioTime + event.time;
    reg.trigger(event, audioTime);
  }

  private dispatchParam(event: ParamEvent): void {
    this.setParam(event.target, event.value, event.rampMs ?? 0);
  }
}
