import { describe, expect, it } from 'vitest';
import { EmberEngine, Seed } from '../src/index.js';

describe('EmberEngine', () => {
  it('events are returned in non-decreasing time order', () => {
    const e = new EmberEngine(Seed.from(42n));
    const events = e.scheduleUntil(20);
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1] as { time: number };
      const cur = events[i] as { time: number };
      expect(cur.time).toBeGreaterThanOrEqual(prev.time);
    }
  });

  it('emits all four event kinds within the first few seconds', () => {
    const e = new EmberEngine(Seed.from(42n), { density: 1.0 }); // force melody firing
    const events = e.scheduleUntil(20);
    const kinds = new Set(events.map((ev) => ev.kind));
    expect(kinds.has('note')).toBe(true);
    expect(kinds.has('tick')).toBe(true);
    const channels = new Set(
      events.filter((ev) => ev.kind === 'note').map((ev) => (ev as { channel: string }).channel),
    );
    // chords (rhodes), pad, kick, snare, hat should all appear
    expect(channels.has('rhodes')).toBe(true);
    expect(channels.has('pad')).toBe(true);
    expect(channels.has('kick')).toBe(true);
    expect(channels.has('snare')).toBe(true);
    expect(channels.has('hat')).toBe(true);
  });

  it('same seed produces identical event streams', () => {
    const a = new EmberEngine(Seed.from(42n));
    const b = new EmberEngine(Seed.from(42n));
    expect(b.scheduleUntil(10)).toEqual(a.scheduleUntil(10));
  });

  it('different seeds diverge', () => {
    const a = new EmberEngine(Seed.from(42n));
    const b = new EmberEngine(Seed.from(43n));
    const evA = a.scheduleUntil(20);
    const evB = b.scheduleUntil(20);
    // Drum + chord skeleton is identical regardless of seed, but voicings
    // and melody differ. Compare the full event vector — should differ.
    expect(evB).not.toEqual(evA);
  });

  it('reset replays the same first window for the same seed', () => {
    const e = new EmberEngine(Seed.from(7n));
    const first = e.scheduleUntil(10);
    e.reset();
    const again = e.scheduleUntil(10);
    expect(again).toEqual(first);
  });

  it('vinylEnabled=false suppresses crackle events', () => {
    const e = new EmberEngine(Seed.from(42n), { vinylEnabled: false });
    const events = e.scheduleUntil(20);
    const bellEvents = events.filter(
      (ev) => ev.kind === 'note' && (ev as { channel: string }).channel === 'bell',
    );
    expect(bellEvents).toHaveLength(0);
  });

  it('setOption("density", 0) substantially reduces melody firings', () => {
    // Density is fBm-driven (Stage 5+): setting the mean to 0 doesn't
    // hard-mute melody — the fBm motion around the mean can still pull
    // the instantaneous density above 0 (clamped at 0). So we verify the
    // weaker but still meaningful invariant: mean=0 produces far fewer
    // melody notes than mean=1 over the same window.
    const melodyCount = (mean: number) => {
      const e = new EmberEngine(Seed.from(42n), { density: mean });
      const events = e.scheduleUntil(60);
      return events.filter(
        (ev) =>
          ev.kind === 'note' &&
          (ev as { channel: string }).channel === 'rhodes' &&
          (ev as { durationMs: number }).durationMs < 2000,
      ).length;
    };
    const high = melodyCount(1.0);
    const low = melodyCount(0);
    expect(low).toBeLessThan(high * 0.3);
  });

  it('determinism contract — fixed seed produces a known fingerprint', () => {
    const e = new EmberEngine(Seed.from(42n));
    const events = e.scheduleUntil(5);
    // Fingerprint is the count + first 6 event signatures. Locks the engine
    // composition against accidental refactor. Values filled after first run.
    const fingerprint = events.slice(0, 6).map((ev) => {
      if (ev.kind === 'note') return `n:${ev.channel}:${ev.pitch}:${ev.time.toFixed(4)}`;
      if (ev.kind === 'tick') return `t:${ev.bar}:${ev.beat}:${ev.time.toFixed(4)}`;
      return `p:${(ev as { target: string }).target}`;
    });
    // This fingerprint locks the engine composition (chord pick, voicing,
    // pad routing, drum grid). If it changes, every saved seed shifts —
    // treat as a deliberate compat break and bump the seed format version.
    expect({ count: events.length, fingerprint }).toEqual({
      count: 63,
      fingerprint: [
        'n:rhodes:52:0.0000',
        'n:rhodes:55:0.0000',
        'n:rhodes:57:0.0000',
        'n:rhodes:60:0.0000',
        'n:pad:45:0.0000',
        'n:pad:52:0.0000',
      ],
    });
  });
});
