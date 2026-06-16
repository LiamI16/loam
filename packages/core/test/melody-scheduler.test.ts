import { describe, expect, it } from 'vitest';
import { Channels, MelodyScheduler, PENT_MIDI, Seed } from '../src/index.js';
import { makeState } from './_helpers.js';

describe('MelodyScheduler', () => {
  it('every emitted pitch lies in A-minor pentatonic', () => {
    const s = new MelodyScheduler(Seed.from(42n), makeState({ density: 0.6 }));
    const events = s.scheduleUntil(0, 30);
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      expect(PENT_MIDI).toContain((ev as { pitch: number }).pitch);
      expect(ev.kind).toBe('note');
      expect((ev as { channel: string }).channel).toBe(Channels.RHODES);
    }
  });

  it('density 0 emits nothing', () => {
    const s = new MelodyScheduler(Seed.from(42n), makeState({ density: 0 }));
    const events = s.scheduleUntil(0, 30);
    expect(events).toHaveLength(0);
  });

  it('density 1 emits a note on every quarter-note slot', () => {
    const s = new MelodyScheduler(Seed.from(42n), makeState({ bpm: 60, density: 1 }));
    // 60 BPM → 1 second per quarter. Starts on quarter 1 (offset by prototype),
    // so 10 seconds → quarters 1..9 → 9 notes.
    const events = s.scheduleUntil(0, 10);
    expect(events).toHaveLength(9);
  });

  it('reset replays the same first events for the same seed', () => {
    const s = new MelodyScheduler(Seed.from(7n), makeState({ density: 0.5 }));
    const a = s.scheduleUntil(0, 12);
    s.reset();
    const b = s.scheduleUntil(0, 12);
    expect(b).toEqual(a);
  });
});
