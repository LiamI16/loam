import { describe, expect, it } from 'vitest';
import { Channels, ChordScheduler, Seed } from '../src/index.js';
import { makeState } from './_helpers.js';

const OPTS = makeState();
const SECONDS_PER_BEAT = 60 / 74; // 74 BPM
const SECONDS_PER_BAR = SECONDS_PER_BEAT * 4;

describe('ChordScheduler (comping)', () => {
  it('emits chord voicing on RHODES and pad root+fifth on PAD at t=0', () => {
    const s = new ChordScheduler(Seed.from(1n), { ...OPTS, currentChord: null });
    const events = s.scheduleUntil(0, 1.0);
    const atZero = events.filter((e) => e.time === 0);
    const rhodes = atZero.filter((e) => e.kind === 'note' && e.channel === Channels.RHODES_CHORD);
    const pad = atZero.filter((e) => e.kind === 'note' && e.channel === Channels.PAD);
    // First bar of first slot always anchors beat 1 (voicing emitted)
    expect(rhodes.length).toBeGreaterThanOrEqual(3);
    expect(pad).toHaveLength(2);
  });

  it('pad pitches are root + perfect fifth (7 semitones)', () => {
    const s = new ChordScheduler(Seed.from(1n), { ...OPTS, currentChord: null });
    const events = s.scheduleUntil(0, 1.0);
    const pad = events.filter((e) => e.kind === 'note' && e.channel === Channels.PAD);
    expect(pad).toHaveLength(2);
    const [a, b] = pad as Array<{ pitch: number }>;
    expect(b.pitch - a.pitch).toBe(7);
  });

  it('chord-change boundaries land on bar grid (multiples of one bar)', () => {
    // Each chord slot is 2 or 4 bars; PAD events mark slot starts.
    // Therefore every PAD-event time is an integer multiple of secondsPerBar.
    const s = new ChordScheduler(Seed.from(7n), { ...OPTS, currentChord: null });
    const events = s.scheduleUntil(0, SECONDS_PER_BAR * 12);
    const padTimes = [
      ...new Set(
        events.filter((e) => e.kind === 'note' && e.channel === Channels.PAD).map((e) => e.time),
      ),
    ].sort((a, b) => a - b);
    expect(padTimes.length).toBeGreaterThanOrEqual(3);
    for (const t of padTimes) {
      const barUnits = t / SECONDS_PER_BAR;
      expect(barUnits).toBeCloseTo(Math.round(barUnits), 6);
    }
  });

  it('slot lengths come only from {2, 4} bars', () => {
    const s = new ChordScheduler(Seed.from(11n), { ...OPTS, currentChord: null });
    const events = s.scheduleUntil(0, SECONDS_PER_BAR * 40);
    const padTimes = [
      ...new Set(
        events.filter((e) => e.kind === 'note' && e.channel === Channels.PAD).map((e) => e.time),
      ),
    ].sort((a, b) => a - b);
    for (let i = 1; i < padTimes.length; i++) {
      const gapBars = ((padTimes[i] as number) - (padTimes[i - 1] as number)) / SECONDS_PER_BAR;
      const rounded = Math.round(gapBars);
      expect([2, 4]).toContain(rounded);
      expect(gapBars).toBeCloseTo(rounded, 6);
    }
  });

  it('first bar of each slot always emits beat-1 voicing (anchor rule)', () => {
    const s = new ChordScheduler(Seed.from(3n), { ...OPTS, currentChord: null });
    const events = s.scheduleUntil(0, SECONDS_PER_BAR * 20);
    const padTimes = [
      ...new Set(
        events.filter((e) => e.kind === 'note' && e.channel === Channels.PAD).map((e) => e.time),
      ),
    ];
    // Each pad time should have a simultaneous Rhodes voicing (≥3 notes).
    for (const t of padTimes) {
      const rhodesAtT = events.filter(
        (e) =>
          e.kind === 'note' && e.channel === Channels.RHODES_CHORD && Math.abs(e.time - t) < 1e-6,
      );
      expect(rhodesAtT.length).toBeGreaterThanOrEqual(3);
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

  it('different seeds produce different harmonic openings', () => {
    // 16 seeds × Markov walk + per-seed Dirichlet + per-seed slot
    // lengths + per-seed comping density should produce distinguishable
    // outputs in the first 8 bars.
    const fps = new Set<string>();
    for (let i = 1; i <= 16; i++) {
      const s = new ChordScheduler(Seed.from(BigInt(i)), { ...OPTS, currentChord: null });
      const events = s.scheduleUntil(0, SECONDS_PER_BAR * 8);
      const fp = events
        .filter((e) => e.kind === 'note' && e.channel === Channels.RHODES_CHORD)
        .map((e) => `${(e as { pitch: number }).pitch}@${e.time.toFixed(2)}`)
        .join(',');
      fps.add(fp);
    }
    expect(fps.size).toBeGreaterThanOrEqual(8);
  });
});
