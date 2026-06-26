import type { NoteEvent } from '@loam/core';

/**
 * What the adapter does with a `NoteEvent` for a given channel.
 * Chains supply this when calling `registerChannel`.
 *
 * Structural rather than tied to `Tone.PolySynth` because percussion
 * (`NoiseSynth`, `MembraneSynth`) has a different signature — the chain
 * is the only place that knows which call to make for which voice.
 */
export type ChannelTrigger = (event: NoteEvent, audioTime: number) => void;

/** Optional fast-release hook for sustained voices (chords / pad). */
export type ChannelReleaseAll = () => void;

export interface ChannelRegistration {
  trigger: ChannelTrigger;
  releaseAll?: ChannelReleaseAll;
}

/**
 * What the adapter does with a `ParamEvent` for a given target. The chain
 * supplies these closures at `registerParam` time so it can deal with
 * Tone's generic `Param<unit>` typing locally — the adapter only ever
 * sees `(value: number)`. Same shape pattern as `ChannelRegistration`.
 */
export interface ParamSetter {
  /** Immediate value change. Used for one-shot UI slider events. */
  set(value: number): void;
  /**
   * Smooth ramp over `durationSec`. Used for `ParamEvent.rampMs`.
   *
   * `startTime` is an absolute audio-context time (seconds) at which the
   * ramp should *begin*. When omitted the ramp starts "now" — the path UI
   * sliders take. The adapter passes it for engine-emitted `ParamEvent`s so
   * a continuous param stream stays time-locked to the notes it shapes even
   * when scheduled far ahead of the audio clock (see `LOOKAHEAD_SEC`).
   */
  ramp(value: number, durationSec: number, startTime?: number): void;
}
