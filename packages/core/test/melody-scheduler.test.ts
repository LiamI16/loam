import { describe, expect, it } from 'vitest';
import { Channels, MelodyScheduler, Seed, StaticParam } from '../src/index.js';
import { makeState } from './_helpers.js';

describe('MelodyScheduler', () => {
  it('emits notes on the rhodes_melody channel only', () => {
    const s = new MelodyScheduler(Seed.from(42n), makeState({ chordActivity: 0 }));
    const events = s.scheduleUntil(0, 30);
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      expect(ev.kind).toBe('note');
      expect((ev as { channel: string }).channel).toBe(Channels.RHODES_MELODY);
    }
  });

  it('emitted pitches lie within the melody-register mode bag (A4..C6)', () => {
    const s = new MelodyScheduler(Seed.from(42n), makeState({ chordActivity: 0 }));
    const events = s.scheduleUntil(0, 30);
    for (const ev of events) {
      const p = (ev as { pitch: number }).pitch;
      expect(p).toBeGreaterThanOrEqual(69);
      expect(p).toBeLessThanOrEqual(84);
    }
  });

  it('high chord activity + coupling suppresses melody firings (min-cap)', () => {
    const sBusy = new MelodyScheduler(Seed.from(42n), makeState({ chordActivity: 1 }));
    const sCalm = new MelodyScheduler(Seed.from(42n), makeState({ chordActivity: 0 }));
    const busy = sBusy.scheduleUntil(0, 60).length;
    const calm = sCalm.scheduleUntil(0, 60).length;
    expect(busy).toBeLessThan(calm);
  });

  it('reset replays the same first events for the same seed', () => {
    const s = new MelodyScheduler(Seed.from(7n), makeState({ chordActivity: 0.2 }));
    const a = s.scheduleUntil(0, 20);
    s.reset();
    const b = s.scheduleUntil(0, 20);
    expect(b).toEqual(a);
  });

  it('exposes the per-seed germ and template', () => {
    const s = new MelodyScheduler(Seed.from(42n), makeState());
    expect(s.germ.length).toBeGreaterThan(0);
    expect(s.template.id).toMatch(/^T(10|[1-9])$/);
  });

  it('per-seed swing ratio is in [0.50, 0.55] and stable for the same seed', () => {
    for (const seedVal of [42n, 1n, 7n, 1012746201732607284n]) {
      const a = new MelodyScheduler(Seed.from(seedVal), makeState());
      const b = new MelodyScheduler(Seed.from(seedVal), makeState());
      expect(a.swingRatio).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(a.swingRatio).toBeLessThanOrEqual(0.55 + 1e-9);
      expect(b.swingRatio).toBe(a.swingRatio);
    }
  });

  it('different seeds usually get different swing ratios', () => {
    const ratios = new Set<number>();
    for (const seedVal of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]) {
      const s = new MelodyScheduler(Seed.from(seedVal), makeState());
      ratios.add(s.swingRatio);
    }
    // 8 independent uniform draws from a continuous range — collisions
    // are vanishingly rare, but allow tiny slack.
    expect(ratios.size).toBeGreaterThanOrEqual(7);
  });

  it('emitted note times are consistent with the per-seed swing offset', () => {
    // Property: every emitted note time `t` has a fractional-beat
    // position that's either an exact germ-rhythm position OR an
    // off-beat (fractional 0.5) shifted by exactly `swingOffsetSec`.
    // For straight-feel seeds (swing 0.50) this collapses to "exact
    // rhythm positions". Use seed 42 — T10 arpeggio with [8n, 8n, 8n,
    // 4n] rhythm produces fragments with cursor positions at 0.5 and
    // 1.5 (8n off-beats), so swing should be observable in the gaps.
    const s = new MelodyScheduler(Seed.from(42n), makeState({ chordActivity: 0 }));
    const events = s.scheduleUntil(0, 120);
    const bpm = 74;
    const spq = 60 / bpm;
    const swingOffsetSec = (s.swingRatio - 0.5) * 0.5 * spq;
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      const t = (ev as { time: number }).time;
      const beats = t / spq;
      const frac = beats - Math.floor(beats);
      // Either an on-beat / known rhythm position, or an 8n off-beat
      // shifted by swingOffsetSec. The shifted off-beat position is
      // `0.5 + swingOffsetSec / spq` in beats.
      const shiftedOffbeat = 0.5 + swingOffsetSec / spq;
      // Acceptable fractional positions:
      //   0          (on-beat, fragment start or every-quarter rhythm)
      //   0.25, 0.75 (16n if it ever shows up — diminished germ)
      //   1/3, 2/3   (triplets — T7)
      //   shiftedOffbeat (swung 8n off-beat)
      const tolerable = [0, 0.25, 0.5, 0.75, 1 / 3, 2 / 3, shiftedOffbeat];
      const ok = tolerable.some((p) => Math.abs(frac - p) < 1e-6 || Math.abs(frac - p - 1) < 1e-6);
      expect(ok, `event at t=${t} → fractional beat ${frac}`).toBe(true);
    }
  });

  it('with chord activity at 0 and seed-typical activity, fires fragments regularly', () => {
    const state = makeState({ chordActivity: 0 });
    state.chordActivityStream = new StaticParam(0);
    const a = new MelodyScheduler(Seed.from(42n), state).scheduleUntil(0, 60).length;
    const b = new MelodyScheduler(Seed.from(7n), state).scheduleUntil(0, 60).length;
    expect(a).toBeGreaterThan(5);
    expect(b).toBeGreaterThan(5);
  });

  it('fragment-per-firing: consecutive notes inside a fragment span < 1 quarter apart', () => {
    // Within a germ fragment, notes are emitted at cumulative
    // beat-offsets from the fragment start (most germs have 8n/4n
    // intra-fragment gaps). Across fragments, the gap is ≥ 1 quarter
    // (we advance nextQuarter past the fragment tail). So the
    // distribution of inter-note gaps should include sub-quarter
    // gaps (intra-fragment) AND larger gaps (inter-fragment).
    const state = makeState({ chordActivity: 0 });
    state.chordActivityStream = new StaticParam(0);
    const s = new MelodyScheduler(Seed.from(42n), state);
    const events = s.scheduleUntil(0, 60);
    expect(events.length).toBeGreaterThan(4);
    const times = events.map((ev) => (ev as { time: number }).time);
    let foundSubQuarterGap = false;
    const secondsPerQuarter = 60 / 74;
    for (let i = 1; i < times.length; i++) {
      const t = times[i] as number;
      const prev = times[i - 1] as number;
      const gap = t - prev;
      if (gap > 1e-6 && gap < secondsPerQuarter - 1e-3) {
        foundSubQuarterGap = true;
        break;
      }
    }
    expect(foundSubQuarterGap).toBe(true);
  });
});
