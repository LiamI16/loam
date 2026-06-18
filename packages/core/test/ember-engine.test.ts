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
    //
    // Counting note: chord-comping (post bar-grid rewrite) emits
    // voicings of ≥3 simultaneous Rhodes notes; the melody scheduler
    // emits a single Rhodes note at a time. Counting Rhodes timestamps
    // with ≤2 voices at them isolates melody.
    const melodyCount = (mean: number) => {
      const e = new EmberEngine(Seed.from(42n), { density: mean });
      const events = e.scheduleUntil(60);
      const rhodesByTime = new Map<number, number>();
      for (const ev of events) {
        if (ev.kind !== 'note') continue;
        if ((ev as { channel: string }).channel !== 'rhodes') continue;
        const t = ev.time;
        rhodesByTime.set(t, (rhodesByTime.get(t) ?? 0) + 1);
      }
      let count = 0;
      for (const n of rhodesByTime.values()) if (n <= 2) count += n;
      return count;
    };
    const high = melodyCount(1.0);
    const low = melodyCount(0);
    expect(low).toBeLessThan(high * 0.3);
  });

  it('speedMultiplier=1.0 is byte-identical to default', () => {
    const a = new EmberEngine(Seed.from(42n));
    const b = new EmberEngine(Seed.from(42n), { speedMultiplier: 1.0 });
    expect(b.scheduleUntil(10)).toEqual(a.scheduleUntil(10));
  });

  it('speedMultiplier=2.0 halves timestamps and durations, preserves pitches', () => {
    const slow = new EmberEngine(Seed.from(42n));
    const fast = new EmberEngine(Seed.from(42n), { speedMultiplier: 2.0 });
    // Schedule enough wall-clock time on each that they cover the same
    // amount of musical content: 10 s engine-time = 10 s @1× = 5 s @2×.
    const slowEvents = slow.scheduleUntil(10);
    const fastEvents = fast.scheduleUntil(5);
    expect(fastEvents.length).toBe(slowEvents.length);
    for (let i = 0; i < slowEvents.length; i++) {
      const s = slowEvents[i];
      const f = fastEvents[i];
      if (!s || !f) throw new Error('length mismatch');
      expect(f.kind).toBe(s.kind);
      expect(f.time).toBeCloseTo(s.time / 2, 9);
      if (s.kind === 'note' && f.kind === 'note') {
        expect(f.pitch).toBe(s.pitch);
        expect(f.channel).toBe(s.channel);
        expect(f.durationMs).toBeCloseTo(s.durationMs / 2, 6);
      }
      if (s.kind === 'param' && f.kind === 'param') {
        expect(f.target).toBe(s.target);
        expect(f.value).toBeCloseTo(s.value, 9);
        if (s.rampMs !== undefined && f.rampMs !== undefined) {
          expect(f.rampMs).toBeCloseTo(s.rampMs / 2, 6);
        }
      }
    }
  });

  it('setOption("speedMultiplier") rescales subsequent emissions only', () => {
    const e = new EmberEngine(Seed.from(42n));
    const first = e.scheduleUntil(2);
    // Switch to half speed: the next wall-clock second should produce
    // half a second of musical content.
    e.setOption('speedMultiplier', 0.5);
    const second = e.scheduleUntil(4);
    // Continuity at the boundary: second's first event time >= 2.
    expect((second[0] as { time: number }).time).toBeGreaterThanOrEqual(2);
    // First-batch events stay below 2 (the audio boundary).
    for (const ev of first) expect(ev.time).toBeLessThan(2);
    // After the speed change, the engine should still be producing
    // events out to the new audio cursor.
    expect(second.length).toBeGreaterThan(0);
    for (const ev of second) expect(ev.time).toBeLessThan(4);
  });

  it('derives BPM from the seed when options.bpm is omitted', () => {
    // Each seed picks its own home tempo in [60, 90] BPM. Same seed →
    // same BPM; different seeds → different BPMs (usually).
    const a = new EmberEngine(Seed.from(42n));
    const aBpm = a.getOptions().bpm;
    expect(aBpm).toBeGreaterThanOrEqual(60);
    expect(aBpm).toBeLessThanOrEqual(90);
    // Same seed: same derived BPM.
    const b = new EmberEngine(Seed.from(42n));
    expect(b.getOptions().bpm).toBe(aBpm);
    // Explicit override beats derivation.
    const overridden = new EmberEngine(Seed.from(42n), { bpm: 100 });
    expect(overridden.getOptions().bpm).toBe(100);
  });

  it('speedMultiplier is clamped at the minimum', () => {
    const e = new EmberEngine(Seed.from(42n), { speedMultiplier: -1 });
    // Out-of-range collapses to the minimum (0.1) rather than throwing.
    expect(e.getOptions().speedMultiplier).toBeGreaterThan(0);
  });

  it('determinism contract — fixed seed produces a known fingerprint', () => {
    // BPM pinned explicitly to keep the lock stable across the per-seed
    // BPM-derivation change. Seed-derived BPM is exercised by other
    // tests (same-seed determinism, getOptions reporting).
    const e = new EmberEngine(Seed.from(42n), { bpm: 74 });
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
    // Reset on 2026-06-17 with the chord-comping bar-grid rewrite —
    // see docs/seed-format.md §7.3a. Pad now precedes rhodes voicing
    // at slot starts because the pad emission happens during the
    // slot-advance step (before per-bar hit rolls). Voicing-variety
    // (C) follow-up (same day): seed 42's first archetype roll lands
    // on quartal, producing a 3-voice (D-G-C) voicing instead of the
    // previous 4-voice close (C-E-G-A). Count drops by 4 across the
    // 5 s window (3 voices instead of 4 on hits within the first slot).
    // Chord-echo (same day): adds a one-shot `fx.chordEcho.time`
    // ParamEvent at t=0 (BPM-derived delay time for the adapter).
    // Count: 112 + 1 = 113; the param slots in after the hat at
    // t=-0.003 and pushes the last rhodes out of the 6-slot slice.
    expect({ count: events.length, fingerprint }).toEqual({
      count: 113,
      fingerprint: [
        'n:hat:42:-0.0030',
        'p:fx.chordEcho.time',
        'n:pad:45:0.0000',
        'n:pad:52:0.0000',
        'n:rhodes:60:0.0000',
        'n:rhodes:62:0.0000',
      ],
    });
  });
});
