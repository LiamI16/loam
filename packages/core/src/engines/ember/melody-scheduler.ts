import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import { PENT_MIDI } from './progressions.js';

/**
 * Sparse incidental melody on A-minor pentatonic, per prototype. Each
 * quarter-note, fires with probability `opts.density`; when it fires,
 * picks a pentatonic note, picks 4n or 8n duration 50/50, and emits a
 * soft `note` event on `Channels.RHODES`.
 *
 * Starts on quarter 1 (not 0) — matches the prototype's `'0:1'` start
 * offset so the first downbeat is silent and the melody enters on beat 2.
 */
export class MelodyScheduler implements SubScheduler {
  private rng!: Rng;
  private nextQuarter = 1;
  private readonly secondsPerQuarter: number;

  constructor(
    private readonly seed: Seed,
    private readonly state: EngineState,
  ) {
    this.secondsPerQuarter = 60 / state.bpm;
    this.reset();
  }

  reset(): void {
    this.nextQuarter = 1;
    this.rng = this.seed.rng();
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    while (this.nextQuarter * this.secondsPerQuarter < to) {
      const time = this.nextQuarter * this.secondsPerQuarter;
      // Density wanders — sample the fBm stream at this exact engine-time
      // so reproducible "did the melody fire at quarter N?" decisions stay
      // tied to a deterministic fBm trajectory.
      const density = this.state.densityStream.evaluate(time);
      if (this.rng.bernoulli(density)) {
        const pitch = this.rng.pick(PENT_MIDI);
        const isQuarter = this.rng.bernoulli(0.5);
        const durationMs = (isQuarter ? this.secondsPerQuarter : this.secondsPerQuarter / 2) * 1000;
        const velocity = 0.22 + this.rng.nextFloat() * 0.12;
        events.push({
          kind: 'note',
          channel: Channels.RHODES,
          pitch,
          velocity,
          durationMs,
          time,
        });
      }
      this.nextQuarter++;
    }
    return events;
  }
}
