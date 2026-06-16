import { Channels } from '../channels.js';
import type { Engine } from '../engine.js';
import type { EngineEvent, NoteEvent, TickEvent } from '../events.js';

/**
 * Stage-3 placeholder engine: hard-coded Dm9 → Gmaj7 vamp with one chord
 * every 2 bars. No randomness, no dynamics, no melody. Exists to prove the
 * core ↔ adapter event-flow end-to-end, not to be musical.
 *
 * Will be replaced by the real seed-driven engine in Stage 5+.
 */
export class VampEngine implements Engine {
  private cursor = 0;
  private readonly bpm: number;
  private readonly secondsPerBar: number;
  private readonly secondsPerBeat: number;
  private readonly secondsPerChord: number;

  constructor(opts: { bpm?: number } = {}) {
    this.bpm = opts.bpm ?? 74;
    this.secondsPerBeat = 60 / this.bpm;
    this.secondsPerBar = this.secondsPerBeat * 4;
    this.secondsPerChord = this.secondsPerBar * 2;
  }

  scheduleUntil(until: number): EngineEvent[] {
    if (until <= this.cursor) return [];
    const events: EngineEvent[] = [];

    // Note events on chord boundaries (every 2 bars). The `max(0, ...)` guards
    // against `Math.ceil(-1e-9) = -0`, which would propagate -0 into event times.
    const firstChordIdx = Math.max(0, Math.ceil(this.cursor / this.secondsPerChord - 1e-9));
    let chordIdx = firstChordIdx;
    let chordTime = chordIdx * this.secondsPerChord;
    // The note's release should fade just before the next chord so they
    // don't double on top of each other.
    const noteDurationMs = (this.secondsPerChord - 0.25) * 1000;
    while (chordTime < until) {
      const chord = chordIdx % 2 === 0 ? DM9 : GMAJ7;
      for (const pitch of chord) {
        events.push(noteEvent(pitch, chordTime, noteDurationMs));
      }
      chordIdx++;
      chordTime = chordIdx * this.secondsPerChord;
    }

    // Tick events on every beat (for UI / debug)
    const firstBeatIdx = Math.max(0, Math.ceil(this.cursor / this.secondsPerBeat - 1e-9));
    let beatIdx = firstBeatIdx;
    let beatTime = beatIdx * this.secondsPerBeat;
    while (beatTime < until) {
      events.push(tickEvent(beatIdx, beatTime));
      beatIdx++;
      beatTime = beatIdx * this.secondsPerBeat;
    }

    events.sort((a, b) => a.time - b.time);
    this.cursor = until;
    return events;
  }

  reset(): void {
    this.cursor = 0;
  }
}

// D3 F3 A3 C4 E4 — Dm9 (root voicing, light hand)
const DM9 = [50, 53, 57, 60, 64] as const;
// G3 B3 D4 F#4 — Gmaj7
const GMAJ7 = [55, 59, 62, 66] as const;

function noteEvent(pitch: number, time: number, durationMs: number): NoteEvent {
  return {
    kind: 'note',
    channel: Channels.RHODES,
    pitch,
    velocity: 0.55,
    durationMs,
    time,
  };
}

function tickEvent(beatIdx: number, time: number): TickEvent {
  return {
    kind: 'tick',
    bar: Math.floor(beatIdx / 4),
    beat: beatIdx % 4,
    time,
  };
}
