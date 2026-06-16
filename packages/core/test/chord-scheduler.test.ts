import { describe, expect, it } from 'vitest';
import { Channels, ChordScheduler, PROGRESSIONS, Seed } from '../src/index.js';

const OPTS = { bpm: 74, density: 0.18, vinylEnabled: true };
const SECONDS_PER_CHORD = (60 / 74) * 4 * 2; // 2 bars in 4/4 at 74 BPM

describe('ChordScheduler', () => {
  it('emits chord notes on RHODES and pad notes on PAD at chord time', () => {
    const s = new ChordScheduler(Seed.from(1n), OPTS);
    const events = s.scheduleUntil(0, 1.0);
    const atZero = events.filter((e) => e.time === 0);
    const rhodes = atZero.filter((e) => e.kind === 'note' && e.channel === Channels.RHODES);
    const pad = atZero.filter((e) => e.kind === 'note' && e.channel === Channels.PAD);
    expect(rhodes.length).toBeGreaterThanOrEqual(3); // 4-note voicing, possibly altered
    expect(pad).toHaveLength(2); // root + fifth
  });

  it('pad pitches are root + perfect fifth (7 semitones)', () => {
    const s = new ChordScheduler(Seed.from(1n), OPTS);
    const events = s.scheduleUntil(0, 1.0);
    const pad = events.filter((e) => e.kind === 'note' && e.channel === Channels.PAD);
    expect(pad).toHaveLength(2);
    const [a, b] = pad as Array<{ pitch: number }>;
    expect(b.pitch - a.pitch).toBe(7);
  });

  it('chord changes happen every 2 bars (SECONDS_PER_CHORD apart)', () => {
    const s = new ChordScheduler(Seed.from(1n), OPTS);
    const events = s.scheduleUntil(0, SECONDS_PER_CHORD * 3 + 0.1);
    const chordTimes = [
      ...new Set(
        events.filter((e) => e.kind === 'note' && e.channel === Channels.RHODES).map((e) => e.time),
      ),
    ].sort((a, b) => a - b);
    expect(chordTimes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < chordTimes.length; i++) {
      expect((chordTimes[i] as number) - (chordTimes[i - 1] as number)).toBeCloseTo(
        SECONDS_PER_CHORD,
        4,
      );
    }
  });

  it('emits no events when called with a window already past', () => {
    const s = new ChordScheduler(Seed.from(1n), OPTS);
    s.scheduleUntil(0, 10);
    const again = s.scheduleUntil(10, 10);
    expect(again).toHaveLength(0);
  });

  it('reset replays the same first events for the same seed', () => {
    const s = new ChordScheduler(Seed.from(42n), OPTS);
    const a = s.scheduleUntil(0, 1.0);
    s.reset();
    const b = s.scheduleUntil(0, 1.0);
    expect(b).toEqual(a);
  });

  it('different seeds choose different starting progressions over many trials', () => {
    const choices = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const s = new ChordScheduler(Seed.from(BigInt(i + 1)), OPTS);
      s.scheduleUntil(0, 0.5);
      // capture the first chord's RHODES pitches as a fingerprint
      const fp = (s.scheduleUntil(0.5, 0.5) ?? []).join(',');
      void fp;
    }
    // Hand-coded sanity: at least 2 of the 4 progressions should appear
    // across 16 seeds.
    const fps = new Set<string>();
    for (let i = 1; i <= 16; i++) {
      const s = new ChordScheduler(Seed.from(BigInt(i)), OPTS);
      const events = s.scheduleUntil(0, 1.0);
      const rhodes = events
        .filter((e) => e.kind === 'note' && e.channel === Channels.RHODES)
        .map((e) => (e as { pitch: number }).pitch)
        .sort((a, b) => a - b)
        .join(',');
      fps.add(rhodes);
    }
    expect(fps.size).toBeGreaterThanOrEqual(2);
    void choices;
    void PROGRESSIONS;
  });
});
