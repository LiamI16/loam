import { describe, expect, it } from 'vitest';
import { Channels, VampEngine } from '../src/index.js';

describe('VampEngine', () => {
  it('emits 5 note events on the first chord (Dm9) at time 0', () => {
    const e = new VampEngine({ bpm: 74 });
    const events = e.scheduleUntil(1.0);
    const notes = events.filter((ev) => ev.kind === 'note');
    expect(notes).toHaveLength(5);
    for (const n of notes) {
      expect(n.time).toBe(0);
      expect(n.channel).toBe(Channels.RHODES);
    }
    expect(notes.map((n) => n.pitch)).toEqual([50, 53, 57, 60, 64]);
  });

  it('switches to Gmaj7 (4 notes) on the second chord boundary', () => {
    const e = new VampEngine({ bpm: 74 });
    // secondsPerChord ≈ 6.486s, so [0, 8) covers chord 0 and chord 1
    const events = e.scheduleUntil(8);
    const notes = events.filter((ev) => ev.kind === 'note');
    const secondChord = notes.filter((n) => n.time > 1);
    expect(secondChord).toHaveLength(4);
    expect(secondChord.map((n) => n.pitch)).toEqual([55, 59, 62, 66]);
  });

  it('emits one tick event per beat', () => {
    const e = new VampEngine({ bpm: 60 }); // 1 beat / second
    const events = e.scheduleUntil(4);
    const ticks = events.filter((ev) => ev.kind === 'tick');
    expect(ticks.map((t) => t.time)).toEqual([0, 1, 2, 3]);
    expect(ticks.map((t) => t.beat)).toEqual([0, 1, 2, 3]);
    expect(ticks.map((t) => t.bar)).toEqual([0, 0, 0, 0]);
  });

  it('emits events in non-decreasing time order within a window', () => {
    const e = new VampEngine();
    const events = e.scheduleUntil(20);
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1] as { time: number };
      const cur = events[i] as { time: number };
      expect(cur.time).toBeGreaterThanOrEqual(prev.time);
    }
  });

  it('cursor advances; subsequent calls do not re-emit past events', () => {
    const e = new VampEngine();
    const first = e.scheduleUntil(2);
    const again = e.scheduleUntil(2);
    expect(again).toHaveLength(0);
    expect(first.length).toBeGreaterThan(0);
  });

  it('reset() rewinds the cursor', () => {
    const e = new VampEngine();
    e.scheduleUntil(10);
    e.reset();
    const after = e.scheduleUntil(1);
    expect(after.length).toBeGreaterThan(0);
  });
});
