import { describe, expect, it } from 'vitest';
import { BassScheduler, Channels, CHORDS, Seed } from '../src/index.js';
import { makeState } from './_helpers.js';

const BPM = 60;
const SECONDS_PER_BEAT = 1; // 60 BPM → 1 s / beat
const SECONDS_PER_BAR = 4;
const SECONDS_PER_CHORD = 2 * SECONDS_PER_BAR; // ChordScheduler's 2-bar cycle

function makeStateWithChords(): ReturnType<typeof makeState> & {
  chordSchedule: Array<{ time: number; chord: (typeof CHORDS)[keyof typeof CHORDS] }>;
} {
  const state = makeState({ bpm: BPM, seed: 1n });
  // Two chord cycles in the test window: Am7 from 0–8s, Dm7 from 8s.
  state.chordSchedule = [
    { time: 0, chord: CHORDS.Am7 },
    { time: SECONDS_PER_CHORD, chord: CHORDS.Dm7 },
  ];
  return state;
}

describe('BassScheduler', () => {
  it('emits a bass root on beat 1 of every bar', () => {
    const state = makeStateWithChords();
    const s = new BassScheduler(Seed.from(42n), state);
    const events = s.scheduleUntil(0, 16); // 4 bars
    const beat1Events = events.filter(
      (e) =>
        e.kind === 'note' &&
        e.channel === Channels.BASS &&
        Math.abs(((e as { time: number }).time % SECONDS_PER_BAR) - 0) < 1e-6,
    );
    // 4 bars * 1 beat-1-per-bar = 4 beat-1 hits.
    expect(beat1Events.length).toBe(4);
  });

  it('first chord uses its lowest root (interpretation A)', () => {
    const state = makeStateWithChords();
    const s = new BassScheduler(Seed.from(42n), state);
    const events = s.scheduleUntil(0, SECONDS_PER_BAR);
    const firstBeat1 = events.find(
      (e) => e.kind === 'note' && e.channel === Channels.BASS,
    ) as { pitch: number };
    // Am7 (rootPc 9), lowest A in [36, 48] = 45.
    expect(firstBeat1.pitch).toBe(45);
  });

  it('on chord change, bass either moves to new chord root OR stays on a chord tone', () => {
    const state = makeStateWithChords();
    const s = new BassScheduler(Seed.from(42n), state);
    const events = s.scheduleUntil(0, 16); // 4 bars, chord change at bar 2
    for (const ev of events) {
      if (ev.kind !== 'note' || ev.channel !== Channels.BASS) continue;
      const time = (ev as { time: number }).time;
      const pitch = (ev as { pitch: number }).pitch;
      const pc = ((pitch % 12) + 12) % 12;
      // Chord is Am7 (pcs 9, 0, 4, 7) for t < 8, Dm7 (pcs 2, 5, 9, 0) for t >= 8.
      // Beat 1 always plays the held root.
      if (Math.abs((time % SECONDS_PER_BAR) - 0) > 1e-6) continue;
      const chordPcs = time < SECONDS_PER_CHORD ? [9, 0, 4, 7] : [2, 5, 9, 0];
      expect(chordPcs).toContain(pc);
    }
  });

  it('all bass pitches sit in the C2–C3 register [36, 48]', () => {
    const state = makeStateWithChords();
    const s = new BassScheduler(Seed.from(42n), state);
    const events = s.scheduleUntil(0, 16);
    for (const ev of events) {
      if (ev.kind !== 'note' || ev.channel !== Channels.BASS) continue;
      const pitch = (ev as { pitch: number }).pitch;
      expect(pitch).toBeGreaterThanOrEqual(36);
      expect(pitch).toBeLessThanOrEqual(48);
    }
  });

  it('beat-3 bass hits are softer than beat-1', () => {
    // Long window so we get many beat-3 fires.
    const state = makeStateWithChords();
    state.chordSchedule = [
      { time: 0, chord: CHORDS.Am7 },
      { time: SECONDS_PER_CHORD, chord: CHORDS.Dm7 },
      { time: 2 * SECONDS_PER_CHORD, chord: CHORDS.Fmaj7 },
      { time: 3 * SECONDS_PER_CHORD, chord: CHORDS.G7 },
    ];
    const s = new BassScheduler(Seed.from(7n), state);
    const events = s.scheduleUntil(0, 32);
    const beat1Vels: number[] = [];
    const beat3Vels: number[] = [];
    for (const ev of events) {
      if (ev.kind !== 'note' || ev.channel !== Channels.BASS) continue;
      const time = (ev as { time: number }).time;
      const inBar = time % SECONDS_PER_BAR;
      const v = (ev as { velocity: number }).velocity;
      if (Math.abs(inBar - 0) < 1e-6) beat1Vels.push(v);
      if (Math.abs(inBar - 2) < 1e-6) beat3Vels.push(v);
    }
    expect(beat1Vels.length).toBeGreaterThan(0);
    expect(beat3Vels.length).toBeGreaterThan(0);
    const avg1 = beat1Vels.reduce((a, b) => a + b, 0) / beat1Vels.length;
    const avg3 = beat3Vels.reduce((a, b) => a + b, 0) / beat3Vels.length;
    expect(avg1).toBeGreaterThan(avg3);
  });

  it('emits nothing when chord schedule is empty', () => {
    const state = makeState({ bpm: BPM });
    state.chordSchedule = [];
    const s = new BassScheduler(Seed.from(42n), state);
    const events = s.scheduleUntil(0, 16);
    expect(events.length).toBe(0);
  });

  it('reset replays the same events for the same seed', () => {
    const state = makeStateWithChords();
    const s = new BassScheduler(Seed.from(42n), state);
    const a = s.scheduleUntil(0, 16);
    s.reset();
    const b = s.scheduleUntil(0, 16);
    expect(b).toEqual(a);
  });
});
