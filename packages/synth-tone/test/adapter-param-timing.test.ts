import type { Engine, EngineEvent } from '@loam/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The adapter touches Tone (and therefore a Web Audio context) in its
// constructor. We don't need real audio here — only to observe the arguments
// the adapter passes to a registered ParamSetter — so stub Tone with the
// minimal surface the adapter uses. `now()` is driven from a mutable value so
// the test can pin the audio clock.
const state = vi.hoisted(() => ({ now: 0 }));

vi.mock('tone', () => {
  class FakeParam {
    value = 0;
    cancelScheduledValues(): void {}
    setValueAtTime(): void {}
    linearRampToValueAtTime(): void {}
    rampTo(): void {}
  }
  class Gain {
    gain = new FakeParam();
    toDestination(): this {
      return this;
    }
    connect(): this {
      return this;
    }
  }
  class Volume {
    volume = new FakeParam();
    connect(): this {
      return this;
    }
  }
  class Context {}
  return {
    setContext: (): void => {},
    Context,
    start: async (): Promise<void> => {},
    now: (): number => state.now,
    Gain,
    Volume,
  };
});

// The adapter drives its pump clock from a Web Worker built via Blob/URL —
// none of which exist in the node test env. Stub them with inert versions;
// the param dispatch we assert on happens in the synchronous first pump,
// before the worker clock would ever tick.
class StubWorker {
  onmessage: (() => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}
vi.stubGlobal('Worker', StubWorker);
vi.stubGlobal('Blob', class {});
vi.stubGlobal('URL', { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} });

// Imported after the mock is registered.
const { ToneAudioAdapter } = await import('../src/adapter.js');

/** An engine that emits a fixed set of events on its first pump, then nothing. */
function fixedEngine(events: EngineEvent[]): Engine {
  let drained = false;
  return {
    reset: () => {
      drained = false;
    },
    scheduleUntil: () => {
      if (drained) return [];
      drained = true;
      return events;
    },
  } as Engine;
}

describe('adapter param-event time-locking', () => {
  beforeEach(() => {
    state.now = 0;
  });

  it('begins an engine ParamEvent ramp at startAudioTime + event.time', async () => {
    // Pin the audio clock so startAudioTime is deterministic. On a first
    // start latestScheduledAudioTime is 0, so startAudioTime == now == 100.
    state.now = 100;

    const calls: Array<{ value: number; durationSec: number; startTime?: number }> = [];
    const adapter = new ToneAudioAdapter();
    adapter.registerParam('master.warmth', {
      set: () => {},
      ramp: (value, durationSec, startTime) => {
        calls.push({ value, durationSec, startTime });
      },
    });

    adapter.setEngine(
      fixedEngine([{ kind: 'param', target: 'master.warmth', value: 800, rampMs: 250, time: 0.5 }]),
    );

    await adapter.start();

    expect(calls).toHaveLength(1);
    const [first] = calls;
    if (!first) throw new Error('expected a ramp call');
    // startTime is anchored to the audio clock: startAudioTime (100) + 0.5.
    expect(first.startTime).toBeCloseTo(100.5, 6);
    expect(first.durationSec).toBeCloseTo(0.25, 6);
    expect(first.value).toBe(800);
  });

  it('leaves a direct UI setParam ramp anchored to "now" (no startTime)', () => {
    const calls: Array<{ startTime?: number }> = [];
    const adapter = new ToneAudioAdapter();
    adapter.registerParam('master.volume', {
      set: () => {},
      ramp: (_value, _durationSec, startTime) => {
        calls.push({ startTime });
      },
    });

    // UI slider path — no audio-time anchor, ramps from now.
    adapter.setParam('master.volume', -12, 30);

    expect(calls).toHaveLength(1);
    const [first] = calls;
    if (!first) throw new Error('expected a ramp call');
    expect(first.startTime).toBeUndefined();
  });
});

describe('adapter engine handoff (reseed collision guard)', () => {
  beforeEach(() => {
    state.now = 0;
  });

  // Regression net for the reseed "white-noise blast": a seed swap must anchor
  // the incoming engine's automation *strictly forward* of the outgoing seed's
  // scheduled horizon, so the two seeds' ramps never collide on a shared filter
  // signal (a collision slams the filter open and blasts the noise beds). The
  // guarantee is `handoffEngine`'s forward anchor
  // (`max(now, latestScheduledAudioTime + 0.005)`) — assert it at the param
  // dispatch, where a collision would otherwise show as an incoming ramp
  // scheduled at/behind the outgoing one on the same target.
  it('anchors the incoming seed forward of the outgoing horizon on a shared param', async () => {
    state.now = 100;

    const calls: Array<{ startTime?: number }> = [];
    const adapter = new ToneAudioAdapter();
    // A shared, engine-driven filter signal — exactly the kind that collided.
    adapter.registerParam('fx.evoFilter.cutoff', {
      set: () => {},
      ramp: (_value, _durationSec, startTime) => {
        calls.push({ startTime });
      },
    });

    // Outgoing seed: emits one ramp on the shared signal, then start playing.
    adapter.setEngine(
      fixedEngine([
        { kind: 'param', target: 'fx.evoFilter.cutoff', value: 1200, rampMs: 100, time: 0 },
      ]),
    );
    await adapter.start();

    // After the first pump the horizon sits at now + LOOKAHEAD_SEC.
    // (start() anchors at now=100, so the outgoing ramp lands at exactly 100.)
    expect(calls).toHaveLength(1);
    const outgoing = calls[0]?.startTime;
    if (outgoing === undefined) throw new Error('expected outgoing ramp startTime');
    expect(outgoing).toBeCloseTo(100, 6);

    // Reseed without advancing the audio clock — the worst case for collision.
    adapter.handoffEngine(
      fixedEngine([
        { kind: 'param', target: 'fx.evoFilter.cutoff', value: 400, rampMs: 100, time: 0 },
      ]),
    );

    expect(calls).toHaveLength(2);
    const incoming = calls[1]?.startTime;
    if (incoming === undefined) throw new Error('expected incoming ramp startTime');
    // The load-bearing assertion: the incoming ramp is anchored strictly past
    // the outgoing seed's horizon (now + LOOKAHEAD_SEC = 100.75), not on top of
    // the still-scheduled outgoing ramp — so the two never fight on the signal.
    expect(incoming).toBeGreaterThan(outgoing);
    expect(incoming).toBeGreaterThan(100.75);
  });
});
