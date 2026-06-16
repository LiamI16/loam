import { describe, expect, it } from 'vitest';
import { Channels, ChordScheduler, Seed } from '../src/index.js';
import { makeState } from './_helpers.js';

const OPTS = makeState();
const SECONDS_PER_CHORD = (60 / 74) * 4 * 2; // 2 bars in 4/4 at 74 BPM

describe('ChordScheduler', () => {
  it('emits chord notes on RHODES and pad notes on PAD at chord time', () => {
    const s = new ChordScheduler(Seed.from(1n), { ...OPTS, currentChord: null });
    const events = s.scheduleUntil(0, 1.0);
    const atZero = events.filter((e) => e.time === 0);
    const rhodes = atZero.filter((e) => e.kind === 'note' && e.channel === Channels.RHODES);
    const pad = atZero.filter((e) => e.kind === 'note' && e.channel === Channels.PAD);
    expect(rhodes.length).toBeGreaterThanOrEqual(3); // 4-note voicing
    expect(pad).toHaveLength(2); // root + fifth
  });

  it('pad pitches are root + perfect fifth (7 semitones)', () => {
    const s = new ChordScheduler(Seed.from(1n), { ...OPTS, currentChord: null });
    const events = s.scheduleUntil(0, 1.0);
    const pad = events.filter((e) => e.kind === 'note' && e.channel === Channels.PAD);
    expect(pad).toHaveLength(2);
    const [a, b] = pad as Array<{ pitch: number }>;
    expect(b.pitch - a.pitch).toBe(7);
  });

  it('chord changes happen every 2 bars (SECONDS_PER_CHORD apart)', () => {
    const s = new ChordScheduler(Seed.from(1n), { ...OPTS, currentChord: null });
    const events = s.scheduleUntil(0, SECONDS_PER_CHORD * 3 + 0.1);
    // Filter to full-chord emissions: main chord notes share a timestamp
    // with the whole voicing (≥ 3 notes); the voicing wobble emits a
    // single RHODES note mid-cycle and would otherwise shorten the gap.
    const rhodesByTime = new Map<number, number>();
    for (const e of events) {
      if (e.kind !== 'note' || e.channel !== Channels.RHODES) continue;
      rhodesByTime.set(e.time, (rhodesByTime.get(e.time) ?? 0) + 1);
    }
    const chordTimes = [...rhodesByTime.entries()]
      .filter(([, n]) => n >= 3)
      .map(([t]) => t)
      .sort((a, b) => a - b);
    expect(chordTimes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < chordTimes.length; i++) {
      expect((chordTimes[i] as number) - (chordTimes[i - 1] as number)).toBeCloseTo(
        SECONDS_PER_CHORD,
        4,
      );
    }
  });

  it('emits no events when called with a window already past', () => {
    const s = new ChordScheduler(Seed.from(1n), { ...OPTS, currentChord: null });
    s.scheduleUntil(0, 10);
    const again = s.scheduleUntil(10, 10);
    expect(again).toHaveLength(0);
  });

  it('reset replays the same first events for the same seed', () => {
    const s = new ChordScheduler(Seed.from(42n), { ...OPTS, currentChord: null });
    const a = s.scheduleUntil(0, 1.0);
    s.reset();
    const b = s.scheduleUntil(0, 1.0);
    expect(b).toEqual(a);
  });

  it('sets state.currentChord on each chord emission', () => {
    const state = { ...OPTS, currentChord: null };
    const s = new ChordScheduler(Seed.from(1n), state);
    s.scheduleUntil(0, 0.1);
    expect(state.currentChord).not.toBeNull();
  });

  it('different seeds produce different perturbed walks (different first chord cycles)', () => {
    const fps = new Set<string>();
    for (let i = 1; i <= 16; i++) {
      const s = new ChordScheduler(Seed.from(BigInt(i)), { ...OPTS, currentChord: null });
      const events = s.scheduleUntil(0, SECONDS_PER_CHORD * 4 + 0.1);
      const rhodes = events
        .filter((e) => e.kind === 'note' && e.channel === Channels.RHODES)
        .map((e) => (e as { pitch: number }).pitch)
        .join(',');
      fps.add(rhodes);
    }
    // 16 seeds × Markov walk + per-seed Dirichlet should produce many
    // distinguishable harmonic openings.
    expect(fps.size).toBeGreaterThanOrEqual(5);
  });
});
