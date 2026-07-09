import type { Engine, EngineEvent, NoteEvent, ParamEvent, TickEvent } from '@loam/core';
import * as Tone from 'tone';
import type { ChannelRegistration, ParamSetter } from './types.js';

/** How far ahead of the audio clock the engine pre-schedules, in seconds.
 *
 * This is the load-bearing defence against main-thread jank. `pumpOnce`
 * runs on the main thread (the worker only *posts* ticks), so when an
 * animation, scroll, layout or GC pause blocks the main thread, no new
 * events get scheduled until it clears. As long as that stall is shorter
 * than the lookahead, the already-scheduled notes keep rendering on the
 * audio thread and nothing is audible. 0.75 s comfortably absorbs the
 * scroll/animation stalls that caused dropouts at the previous 0.2 s while
 * keeping the stop→resume anchor gap (see `start()`) and the now-time-locked
 * param stream (see `dispatchParam`) modest. */
const LOOKAHEAD_SEC = 0.75;
/** How often the adapter polls the engine for the next chunk of events.
 * 50 ms is far below the lookahead (so we always stay ahead of the audio
 * clock) while halving the main-thread work vs the previous 25 ms —
 * reduces interaction jank (scroll, tab-switch) without audible effect on
 * scheduling fidelity. */
const TICK_INTERVAL_MS = 50;
/** Master-bus fade-out time when stop() is called. ~10 ms is short enough
 * to feel instant and long enough to avoid an audible click. */
const STOP_FADE_SEC = 0.01;
// ── live-handoff crossfade shape (see `handoffEngine`) — tune by ear ──
/** Seconds the outgoing seed takes to fall from full volume to
 * `HANDOFF_FLOOR`, positioned to *end* at the handoff. Capped by the bridge
 * length (~`LOOKAHEAD_SEC`), so a larger value just fades across the whole
 * bridge; a smaller value holds the old seed at full, then fades late. */
const HANDOFF_FADE_OUT_SEC = 0.3;
/** Gate level at the handoff instant. 0 = full dip (the loudness "sag" — old
 * gone, new not yet risen); higher = the old seed stays faintly audible under
 * the incoming seed but there's no hole. The main knob for "natural". */
const HANDOFF_FLOOR = 0.2;
/** Seconds the incoming seed takes to rise from `HANDOFF_FLOOR` to full. */
const HANDOFF_FADE_IN_SEC = 0.7;

/** Swap Tone's default audio context for one with `latencyHint: 'playback'`
 * — a ~250–500 ms buffer that survives scroll/background-tab hiccups without
 * audible glitches. The default `'interactive'` hint targets ~10–25 ms,
 * which is too tight for sustained ambient playback. Idempotent.
 *
 * `sampleRate` (optional) lowers the whole-graph render rate — the single
 * biggest CPU lever, since it scales *all* DSP (the ~70% note-synthesis cost,
 * not just the always-on floor). Web Audio has one rate per context, so this
 * is global. 32 kHz (Nyquist 16 kHz) is transparent-to-authentic for lofi
 * (classic-sampler territory) at ~−21% DSP; lower trades top-end for more.
 * Tone's `ContextOptions` has no `sampleRate`, so we wrap a raw AudioContext.
 * See docs/audio-cpu-plan.md. */
let toneContextConfigured = false;
function configureToneContextOnce(sampleRate?: number): void {
  if (toneContextConfigured) return;
  toneContextConfigured = true;
  const context = sampleRate
    ? new Tone.Context(new AudioContext({ latencyHint: 'playback', sampleRate }))
    : new Tone.Context({ latencyHint: 'playback' });
  Tone.setContext(context);
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

  /**
   * @param opts.sampleRate Optional render sample rate for the global audio
   *   context (the CPU lever — see `configureToneContextOnce`). Only takes
   *   effect on the *first* adapter constructed (the context is process-global
   *   and idempotent); later values are ignored.
   */
  constructor(opts: { sampleRate?: number } = {}) {
    // Configure the global Tone context with a playback-grade buffer before
    // creating any nodes — must happen first because attached nodes are
    // bound to whatever context is active at construction. Guarded so
    // multiple adapter instances don't spawn multiple contexts.
    configureToneContextOnce(opts.sampleRate);
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

  /**
   * Swap to a new engine *without interrupting playback* — the seamless
   * alternative to `stop()` → `setEngine()` → `start()` for a roll or a
   * tab-driven seed change. The previous seed's already-committed notes ring
   * out (no gate mute, no voice release) while the new engine schedules
   * *forward* of them, so the old tail bridges the ~`LOOKAHEAD_SEC` until the
   * new seed's first events land — no dead-air hiccup.
   *
   * The forward anchor is mandatory, not a preference: the instruments are
   * shared mono voices whose per-voice scheduling times must strictly
   * increase, so the new seed *cannot* be scheduled earlier than the old
   * seed's horizon (`latestScheduledAudioTime`) — Tone rejects backward times.
   * Params ride the same forward anchor, so the outgoing and incoming
   * automation streams never collide on a shared signal. Only valid while
   * already playing (the pump loop and mute gate must be live).
   *
   * The mute gate crossfades the two seeds. They occupy *disjoint* windows on
   * the shared gate — the outgoing seed's committed notes fill `[now,
   * startAudioTime]`, the incoming seed starts at `startAudioTime` — so a
   * single down-then-up ramp fades the old seed out across the bridge, then
   * fades the new one in, rather than letting the old tail ring at full level
   * under the new seed.
   */
  handoffEngine(next: Engine): void {
    this.engine = next;
    next.reset();
    const now = Tone.now();
    this.startAudioTime = Math.max(now, this.latestScheduledAudioTime + 0.005);

    // Crossfade on the shared gate: hold the outgoing seed at full until its
    // fade-out window, ramp down to HANDOFF_FLOOR at the handoff, then ramp the
    // incoming seed up. The fade-out can't outlast the bridge (there's no old
    // audio past startAudioTime to fade), so it's capped there.
    const bridgeSec = this.startAudioTime - now;
    const fadeOutStart = this.startAudioTime - Math.min(HANDOFF_FADE_OUT_SEC, bridgeSec);
    const gain = this.out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.setValueAtTime(gain.value, fadeOutStart);
    gain.linearRampToValueAtTime(HANDOFF_FLOOR, this.startAudioTime);
    gain.linearRampToValueAtTime(1, this.startAudioTime + HANDOFF_FADE_IN_SEC);

    // Schedule the incoming seed's first (forward-anchored) batch immediately;
    // the running pump worker then extends it on its normal cadence.
    this.pumpOnce();
  }

  /** Subscribe to `tick` events for UI (e.g. driving an ember pulse). */
  onTick(listener: (ev: TickEvent) => void): void {
    this.tickListeners.push(listener);
  }

  /**
   * Direct parameter setter — used by UI sliders. Same code path as
   * engine-emitted `ParamEvent`s.
   */
  setParam(target: string, value: number, rampMs = 0, startTime?: number): void {
    const setter = this.params.get(target);
    if (!setter) {
      console.warn(`[loam] no param registered for "${target}"`);
      return;
    }
    if (rampMs > 0) setter.ramp(value, rampMs / 1000, startTime);
    else setter.set(value);
  }

  /**
   * Resume the AudioContext, anchor engine-time to the current audio time,
   * and start the scheduling loop. Must be called from a user gesture.
   */
  async start(): Promise<void> {
    await Tone.start();

    this.engine?.reset();
    // Anchor past anything pre-scheduled by a previous run, plus a hair of
    // safety so per-voice "last scheduled" guards don't fire on the very
    // first event. First start: latestScheduledAudioTime == 0, no offset.
    // On a rapid stop→resume this can sit up to LOOKAHEAD_SEC ahead of now,
    // because we can't un-schedule Tone one-shots already queued by the
    // aborted run — anchoring past them is what keeps them from colliding
    // with the fresh start.
    const now = Tone.now();
    this.startAudioTime = Math.max(now, this.latestScheduledAudioTime + 0.005);

    // Fade the mute gate up, anchored to startAudioTime (not now). When the
    // anchor is ahead of now (rapid resume), this holds the gate at 0 across
    // the [now, startAudioTime] gap so the previous run's stale one-shots
    // stay muted, then opens exactly as the fresh audio begins. When the
    // anchor == now (first start / resume after a pause longer than the
    // lookahead) it degenerates to an immediate fade-up. Explicit AudioParam
    // scheduling (rather than Tone's `rampTo`) so the value lands at exactly
    // 1, not asymptotic.
    const gain = this.out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.setValueAtTime(gain.value, this.startAudioTime);
    gain.linearRampToValueAtTime(1, this.startAudioTime + 0.05);

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
    // Schedule the ramp to *begin* at the event's audio time rather than
    // "now". With a deep lookahead a param event can be dispatched up to
    // LOOKAHEAD_SEC before it should take effect; anchoring to the audio
    // clock keeps the continuous param stream (filter sweep, warmth drift)
    // time-locked to the notes it shapes. Instantaneous params (rampMs == 0)
    // still apply immediately — those are one-shots at t≈0 (setup) where the
    // distinction doesn't matter.
    const startTime = this.startAudioTime + event.time;
    this.setParam(event.target, event.value, event.rampMs ?? 0, startTime);
  }
}
