import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { ResolvedEmberOptions, SubScheduler } from './ember.js';
import { CHORDS, type ChordName, PROGRESSIONS } from './progressions.js';

/**
 * Two-bar chord vamp + soft AM pad on root + fifth, per prototype.
 *   - Picks a starting progression at random from `PROGRESSIONS`.
 *   - Every 2 bars: voices the next chord. 50 % chance to alter voicing;
 *     if altered, the root has a 40 % chance to drop by an octave.
 *   - At the end of each progression cycle, 45 % chance to switch to a
 *     different progression.
 *
 * Emits `note` events on `Channels.RHODES` (the chord) and `Channels.PAD`
 * (root + fifth, 4-bar duration).
 */
export class ChordScheduler implements SubScheduler {
  private rng!: Rng;
  private nextChordIdx = 0;
  private currentProg!: readonly ChordName[];
  private readonly secondsPerChord: number;

  constructor(
    private readonly seed: Seed,
    private readonly opts: ResolvedEmberOptions,
  ) {
    this.secondsPerChord = (60 / opts.bpm) * 4 * 2; // 2 bars in 4/4
    this.reset();
  }

  reset(): void {
    this.nextChordIdx = 0;
    this.rng = this.seed.rng();
    this.currentProg = this.rng.pick(PROGRESSIONS);
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    while (this.nextChordIdx * this.secondsPerChord < to) {
      const time = this.nextChordIdx * this.secondsPerChord;
      const slot = this.nextChordIdx % this.currentProg.length;
      const name = this.currentProg[slot] as ChordName;
      const voicing = this.voiceChord(CHORDS[name]);

      // Chord notes — release just before the next chord
      const chordDurationMs = (this.secondsPerChord - 0.25) * 1000;
      const chordVelocity = 0.5 + this.rng.nextFloat() * 0.12;
      for (const pitch of voicing) {
        events.push({
          kind: 'note',
          channel: Channels.RHODES,
          pitch,
          velocity: chordVelocity,
          durationMs: chordDurationMs,
          time,
        });
      }

      // Pad on root + 5th, lasting 4 bars (two chord cycles) per prototype
      const root = voicing[0] as number;
      const padDurationMs = this.secondsPerChord * 2 * 1000;
      events.push({
        kind: 'note',
        channel: Channels.PAD,
        pitch: root,
        velocity: 0.4,
        durationMs: padDurationMs,
        time,
      });
      events.push({
        kind: 'note',
        channel: Channels.PAD,
        pitch: root + 7,
        velocity: 0.4,
        durationMs: padDurationMs,
        time,
      });

      this.nextChordIdx++;

      // End of progression — maybe drift to another loop
      if (this.nextChordIdx % this.currentProg.length === 0 && this.rng.bernoulli(0.45)) {
        this.currentProg = this.rng.pick(PROGRESSIONS);
      }
    }
    return events;
  }

  private voiceChord(base: readonly number[]): number[] {
    const v = base.slice();
    if (this.rng.bernoulli(0.5)) {
      // Only the root (index 0) is currently subject to the octave-drop
      // alteration in the prototype; the rest of the loop is here to match
      // the prototype's `.map((n, k) => ...)` structure.
      for (let k = 0; k < v.length; k++) {
        if (k === 0 && this.rng.bernoulli(0.4)) {
          v[k] = (v[k] as number) - 12;
        }
      }
    }
    return v;
  }
}
