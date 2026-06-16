import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { ResolvedEmberOptions, SubScheduler } from './ember.js';

/** 16-step boom-bap kick pattern (per prototype). */
const KICK_SEQ: ReadonlyArray<0 | 1> = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
/** 16-step snare pattern (per prototype) — back-beat on 5 and 13. */
const SNARE_SEQ: ReadonlyArray<0 | 1> = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
/** Probability of a ghost hat on an off-beat (odd) 16th. */
const GHOST_HAT_PROB = 0.18;

/**
 * Boom-bap drum kit at 16-step resolution. Kick + snare are fixed grids;
 * closed hats hit on every 8th, ghost-hats fire probabilistically on
 * off-beats. No swing here — swing belongs to the synth chain / Transport,
 * which we deliberately don't use yet (`docs/adapter.md` §2). Will revisit
 * when Stage 5 adds micro-timing.
 */
export class DrumScheduler implements SubScheduler {
  private rng!: Rng;
  private nextStep = 0;
  private readonly secondsPerStep: number;

  constructor(
    private readonly seed: Seed,
    private readonly opts: ResolvedEmberOptions,
  ) {
    this.secondsPerStep = 60 / opts.bpm / 4; // sixteenth note
    this.reset();
  }

  reset(): void {
    this.nextStep = 0;
    this.rng = this.seed.rng();
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    while (this.nextStep * this.secondsPerStep < to) {
      const time = this.nextStep * this.secondsPerStep;
      const i = this.nextStep % 16;

      if (KICK_SEQ[i] === 1) {
        events.push({
          kind: 'note',
          channel: Channels.KICK,
          pitch: 36, // C2 — unused by membrane synth, present for completeness
          velocity: 0.9,
          durationMs: 250,
          time,
        });
      }
      if (SNARE_SEQ[i] === 1) {
        events.push({
          kind: 'note',
          channel: Channels.SNARE,
          pitch: 38, // unused
          velocity: 0.7,
          durationMs: 160,
          time,
        });
      }

      // Eight-note closed hat; downbeats louder than off-beats.
      if (i % 2 === 0) {
        events.push({
          kind: 'note',
          channel: Channels.HAT,
          pitch: 42,
          velocity: i % 4 === 0 ? 0.5 : 0.32,
          durationMs: 40,
          time,
        });
      } else if (this.rng.bernoulli(GHOST_HAT_PROB)) {
        events.push({
          kind: 'note',
          channel: Channels.HAT,
          pitch: 42,
          velocity: 0.18,
          durationMs: 40,
          time,
        });
      }

      this.nextStep++;
    }
    return events;
  }
}
