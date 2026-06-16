import type { EngineEvent } from './events.js';

/**
 * Anything that can be driven by an external scheduling clock. The adapter
 * calls `scheduleUntil(t)` periodically; the engine returns all events whose
 * `time` is in `[lastCursor, t)` and advances its internal cursor to `t`.
 *
 * Engine-time is monotonic seconds starting at 0 when the engine begins
 * playback. The adapter is responsible for translating engine-time into the
 * audio-context timeline. See docs/event-protocol.md §2–§3.
 */
export interface Engine {
  /**
   * Emit every event in `[cursor, until)`, sorted by ascending `time`.
   * Advances the cursor to `until`. Calling again with the same or smaller
   * `until` is a no-op and returns `[]`.
   */
  scheduleUntil(until: number): EngineEvent[];

  /** Reset cursor and any internal state. Safe to call before each `start`. */
  reset(): void;
}
