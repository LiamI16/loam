import { describe, expect, it } from 'vitest';
import { Channels, DrumScheduler, Seed } from '../src/index.js';
import { makeState } from './_helpers.js';

const OPTS = makeState({ bpm: 60 }); // 60 BPM → 0.25 s / 16th
const SECONDS_PER_STEP = 0.25;
// Per-voice micro-timing offsets (must mirror drum-scheduler.ts).
const SNARE_OFFSET_S = 0.015;
const HAT_OFFSET_S = -0.003;

function stepOf(time: number, offset = 0): number {
  return Math.round((time - offset) / SECONDS_PER_STEP);
}

describe('DrumScheduler', () => {
  it('kicks land on the base pattern grid (0, 6, 10) plus optional sync', () => {
    const s = new DrumScheduler(Seed.from(1n), OPTS);
    const events = s.scheduleUntil(0, SECONDS_PER_STEP * 16);
    const kicks = events.filter((e) => e.kind === 'note' && e.channel === Channels.KICK);
    const kickSteps = kicks.map((e) => stepOf((e as { time: number }).time));
    // Base steps always present; sync (step 14) may or may not fire.
    expect(kickSteps).toContain(0);
    expect(kickSteps).toContain(6);
    expect(kickSteps).toContain(10);
    for (const k of kickSteps) expect([0, 6, 10, 14]).toContain(k);
  });

  it('back-beat snares land on steps 4 and 12, dragged behind the grid', () => {
    const s = new DrumScheduler(Seed.from(1n), OPTS);
    const events = s.scheduleUntil(0, SECONDS_PER_STEP * 16);
    // Back-beat snares are the loudest snare hits (vs ghost snares which
    // are << 0.5 velocity). Filter for vel > 0.4 to isolate back-beats.
    const backBeats = events
      .filter(
        (e) =>
          e.kind === 'note' &&
          e.channel === Channels.SNARE &&
          (e as { velocity: number }).velocity > 0.4,
      )
      .map((e) => stepOf((e as { time: number }).time, SNARE_OFFSET_S));
    expect(backBeats).toContain(4);
    expect(backBeats).toContain(12);
  });

  it('hat-drop variation rate is well below baseline (rare event)', () => {
    // Test the statistical property across many seeds rather than
    // depending on one seed's roll: across N seeds × M bars each, the
    // hat-drop rate should be far below 25% (it's 8% by design).
    let totalBars = 0;
    let dropBars = 0;
    for (let seedIdx = 1; seedIdx <= 8; seedIdx++) {
      const s = new DrumScheduler(Seed.from(BigInt(seedIdx)), OPTS);
      const events = s.scheduleUntil(0, SECONDS_PER_STEP * 16 * 16); // 16 bars
      const hatsByBar = new Map<number, Set<number>>();
      for (const e of events) {
        if (e.kind !== 'note' || e.channel !== Channels.HAT) continue;
        const step = stepOf((e as { time: number }).time, HAT_OFFSET_S);
        const bar = Math.floor(step / 16);
        const localStep = ((step % 16) + 16) % 16;
        if (!hatsByBar.has(bar)) hatsByBar.set(bar, new Set());
        (hatsByBar.get(bar) as Set<number>).add(localStep);
      }
      // Bars with zero hats are drop bars (only mechanism to produce
      // a no-hat bar in this scheduler).
      for (let b = 0; b < 16; b++) {
        totalBars++;
        if (!hatsByBar.has(b) || (hatsByBar.get(b) as Set<number>).size === 0) {
          dropBars++;
        }
      }
    }
    const rate = dropBars / totalBars;
    expect(rate).toBeLessThan(0.25); // way below 25% (design is 8%)
  });

  it('hat accents follow the beat-1 > beat-3 > and-of pattern', () => {
    // Average hat velocities over many bars to wash out jitter and pick
    // up the accent-pattern signal cleanly.
    const s = new DrumScheduler(Seed.from(7n), OPTS);
    const events = s.scheduleUntil(0, SECONDS_PER_STEP * 16 * 32);
    const sums = new Map<number, { total: number; count: number }>();
    for (const e of events) {
      if (e.kind !== 'note' || e.channel !== Channels.HAT) continue;
      const step = stepOf((e as { time: number }).time, HAT_OFFSET_S);
      const localStep = ((step % 16) + 16) % 16;
      if (localStep % 2 !== 0) continue;
      const cur = sums.get(localStep) ?? { total: 0, count: 0 };
      cur.total += (e as { velocity: number }).velocity;
      cur.count += 1;
      sums.set(localStep, cur);
    }
    const avg = (step: number) => {
      const v = sums.get(step) as { total: number; count: number };
      return v.total / v.count;
    };
    // Beat 1 (1.0 accent × 0.5 base) > beat 3 (0.92 × 0.5) > and-of-1
    // (0.78 × 0.32). Jitter washes out across 32 bars.
    expect(avg(0)).toBeGreaterThan(avg(8));
    expect(avg(8)).toBeGreaterThan(avg(2));
  });

  it('odd-step ghost hats are pushed late by 16th-note swing', () => {
    // Strict filter: only true ghost hats (velocity ~0.18 × jitter); avoid
    // catching off-beat downbeat hats whose accent can dip near 0.25.
    const s = new DrumScheduler(Seed.from(42n), OPTS);
    const events = s.scheduleUntil(0, SECONDS_PER_STEP * 16 * 8);
    const ghostHats = events.filter(
      (e) =>
        e.kind === 'note' &&
        e.channel === Channels.HAT &&
        (e as { velocity: number }).velocity < 0.2,
    );
    expect(ghostHats.length).toBeGreaterThan(0);
    for (const g of ghostHats) {
      const rawStep = ((g as { time: number }).time - HAT_OFFSET_S) / SECONDS_PER_STEP;
      const frac = rawStep - Math.floor(rawStep);
      // 0.55 swing ratio → odd step lands at 55% into the pair → frac
      // ≈ 0.1 (since odd step "should be" at integer +1, swung to +1.1).
      // Just verify it's pushed off integer, not on the grid.
      expect(frac).toBeGreaterThan(0.02);
    }
  });

  it('reset replays the same events for the same seed', () => {
    const s = new DrumScheduler(Seed.from(42n), OPTS);
    const a = s.scheduleUntil(0, 8);
    s.reset();
    const b = s.scheduleUntil(0, 8);
    expect(b).toEqual(a);
  });

  it('same seed produces identical streams across instances', () => {
    const a = new DrumScheduler(Seed.from(7n), OPTS);
    const b = new DrumScheduler(Seed.from(7n), OPTS);
    expect(b.scheduleUntil(0, 16)).toEqual(a.scheduleUntil(0, 16));
  });
});
