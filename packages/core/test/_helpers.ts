import { type EngineState, StaticParam } from '../src/index.js';

/** Build a static `EngineState` suitable for sub-scheduler unit tests.
 * Defaults match the engine's defaults; override what you need. */
export function makeState(
  opts: { bpm?: number; density?: number; vinylEnabled?: boolean } = {},
): EngineState {
  return {
    bpm: opts.bpm ?? 74,
    densityStream: new StaticParam(opts.density ?? 0.18),
    evoCutoffStream: new StaticParam(1800),
    vinylEnabled: opts.vinylEnabled ?? true,
    currentChord: null,
  };
}
