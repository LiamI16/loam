import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import {
  type ChordSymbol,
  chordPitchClasses,
  dominantModeAtPosition,
  modeMidiBag,
} from './harmony/index.js';

/**
 * Sparse incidental melody on A-minor pentatonic. Each quarter-note,
 * fires with probability sampled from the density stream; when it fires,
 * picks a pentatonic note (filtered against the current chord to avoid
 * the worst dissonances), picks 4n or 8n duration 50/50, and emits a
 * soft `note` event on `Channels.RHODES`.
 *
 * Stage 6 — chord-aware filter: when `state.currentChord` is set, blacklist
 * pentatonic notes whose pitch class is a semitone above or below any
 * chord tone (the most jarring clash with the wider Stage-6 harmony,
 * e.g. natural-E pentatonic over an Fm6 containing E♭). If the filter
 * empties the bag, fall back to a chord tone in the pentatonic's
 * register. This is a WIP guardrail — Stage 9 (L-system melody) will
 * subsume it with full chord-aware pitch selection.
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
      const density = this.state.densityStream.evaluate(time);
      if (this.rng.bernoulli(density)) {
        // Stage 7c.2: mode-aware pitch bag. The dominant mode at the
        // current position.x defines the scale; the melody picks from
        // the corresponding hexatonic MIDI set (A4–C6). Chord-tone
        // semitone filter still applies on top.
        const dominantMode = dominantModeAtPosition(this.state.position.evaluate(time).x);
        const bag = modeMidiBag(dominantMode);
        const pitch = this.pickPitch(this.state.currentChord, bag);
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

  private pickPitch(chord: ChordSymbol | null, bag: readonly number[]): number {
    if (!chord) return this.rng.pick(bag);
    const chordPcs = chordPitchClasses(chord);
    const chordPcSet = new Set(chordPcs);
    // Chord tones are always allowed. A semitone-clash only matters for
    // *non-chord-tones* (e.g., melody E over Fm6 is a real clash; melody
    // C over Cmaj7 is the root and must not be filtered out because B is
    // also in the chord).
    const allowed = bag.filter(
      (p) => chordPcSet.has(p % 12) || !semitoneClash(p % 12, chordPcs),
    );
    if (allowed.length > 0) return this.rng.pick(allowed);
    // Scale fully clashes — fall back to a chord tone projected into
    // the melody register (≈A4–C6, MIDI 69–84).
    const fallback: number[] = [];
    for (const pc of chordPcs) {
      let p = pc;
      while (p < 69) p += 12;
      if (p <= 84) fallback.push(p);
    }
    return fallback.length > 0 ? this.rng.pick(fallback) : this.rng.pick(bag);
  }
}

/** True if `pc` is a half-step above or below any pitch class in `chordPcs`. */
function semitoneClash(pc: number, chordPcs: readonly number[]): boolean {
  for (const c of chordPcs) {
    const d = (((pc - c) % 12) + 12) % 12;
    if (d === 1 || d === 11) return true;
  }
  return false;
}
