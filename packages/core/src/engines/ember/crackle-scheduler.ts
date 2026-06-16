import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';

/** Per-16th probability of a vinyl crackle when `vinylEnabled` is true. */
const CRACKLE_PROB = 0.22;

/**
 * Vinyl crackle pops on a 16th-note grid. Reused for now on
 * `Channels.BELL` (the lo-fi chain registers the crackle synth there).
 * Stage 5 will add a proper ornament process and likely move crackle
 * to a dedicated channel.
 */
export class CrackleScheduler implements SubScheduler {
  private rng!: Rng;
  private nextStep = 0;
  private readonly secondsPerStep: number;

  constructor(
    private readonly seed: Seed,
    private readonly state: EngineState,
  ) {
    this.secondsPerStep = 60 / state.bpm / 4;
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
      if (this.state.vinylEnabled && this.rng.bernoulli(CRACKLE_PROB)) {
        events.push({
          kind: 'note',
          channel: Channels.BELL,
          pitch: 60, // unused by noise synth; required by schema
          velocity: 0.2 + this.rng.nextFloat() * 0.5,
          durationMs: 20,
          time,
        });
      }
      this.nextStep++;
    }
    return events;
  }
}
