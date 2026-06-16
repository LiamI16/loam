import { describe, expect, it } from 'vitest';
import { Channels, DrumScheduler, Seed } from '../src/index.js';
import { makeState } from './_helpers.js';

const OPTS = makeState({ bpm: 60 }); // 60 BPM → 0.25 s / 16th
const SECONDS_PER_STEP = 0.25;

describe('DrumScheduler', () => {
  it('places kicks on steps 0, 6, 10 within the first bar', () => {
    const s = new DrumScheduler(Seed.from(1n), OPTS);
    const events = s.scheduleUntil(0, SECONDS_PER_STEP * 16);
    const kicks = events.filter((e) => e.kind === 'note' && e.channel === Channels.KICK);
    const kickSteps = kicks.map((e) => Math.round(e.time / SECONDS_PER_STEP));
    expect(kickSteps).toEqual([0, 6, 10]);
  });

  it('places snares on steps 4 and 12 within the first bar', () => {
    const s = new DrumScheduler(Seed.from(1n), OPTS);
    const events = s.scheduleUntil(0, SECONDS_PER_STEP * 16);
    const snares = events.filter((e) => e.kind === 'note' && e.channel === Channels.SNARE);
    const snareSteps = snares.map((e) => Math.round(e.time / SECONDS_PER_STEP));
    expect(snareSteps).toEqual([4, 12]);
  });

  it('always plays closed hat on every even step (0,2,4,…14)', () => {
    const s = new DrumScheduler(Seed.from(1n), OPTS);
    const events = s.scheduleUntil(0, SECONDS_PER_STEP * 16);
    const hats = events
      .filter((e) => e.kind === 'note' && e.channel === Channels.HAT)
      .map((e) => Math.round(e.time / SECONDS_PER_STEP));
    const evens = [0, 2, 4, 6, 8, 10, 12, 14];
    for (const e of evens) expect(hats).toContain(e);
  });

  it('downbeat hats (every 4 steps) are louder than off-8th hats', () => {
    const s = new DrumScheduler(Seed.from(1n), OPTS);
    const events = s.scheduleUntil(0, SECONDS_PER_STEP * 16);
    const hats = events.filter((e) => e.kind === 'note' && e.channel === Channels.HAT);
    const downbeats = hats.filter(
      (e) => Math.round((e as { time: number }).time / SECONDS_PER_STEP) % 4 === 0,
    );
    const off = hats.filter((e) => {
      const step = Math.round((e as { time: number }).time / SECONDS_PER_STEP);
      return step % 4 === 2; // off-8ths
    });
    for (const d of downbeats) expect((d as { velocity: number }).velocity).toBe(0.5);
    for (const o of off) expect((o as { velocity: number }).velocity).toBe(0.32);
  });

  it('reset replays the same first events for the same seed', () => {
    const s = new DrumScheduler(Seed.from(42n), OPTS);
    const a = s.scheduleUntil(0, 4);
    s.reset();
    const b = s.scheduleUntil(0, 4);
    expect(b).toEqual(a);
  });
});
