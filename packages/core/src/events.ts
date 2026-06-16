/**
 * Event protocol between @loam/core and the synth adapter.
 * First-draft typed contract. See docs/event-protocol.md for the full spec
 * (time semantics, lookahead scheduling, channel registry, etc.).
 *
 * Adding new event kinds is safe (discriminated union).
 * Renaming or removing existing kinds is a breaking change.
 */

export type EngineEvent = NoteEvent | ParamEvent | TickEvent;

export interface NoteEvent {
  kind: 'note';
  /** Channel name — e.g. 'rhodes', 'pad', 'kick', 'snare', 'hat', 'bass', 'bell'. */
  channel: string;
  /** MIDI note number, 0–127. C4 = 60. */
  pitch: number;
  /** Velocity, 0..1. */
  velocity: number;
  /** Hold time in milliseconds. */
  durationMs: number;
  /** Engine-time in seconds when the event fires. */
  time: number;
}

export interface ParamEvent {
  kind: 'param';
  /** Dotted path: 'warmth.cutoff', 'rhodes.volume', 'fx.chorus.depth'. */
  target: string;
  value: number;
  /** Glide duration in ms. Omit / 0 for instantaneous. */
  rampMs?: number;
  time: number;
}

export interface TickEvent {
  kind: 'tick';
  /** Bar count since play start (0-indexed). */
  bar: number;
  /** Beat within bar (0..3 for 4/4). */
  beat: number;
  time: number;
}
