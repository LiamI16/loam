import { type EngineState, PositionStream, Seed, StaticParam } from '../src/index.js';

/** Build a static `EngineState` suitable for sub-scheduler unit tests.
 * Defaults match the engine's defaults; override what you need. */
export function makeState(
  opts: {
    bpm?: number;
    density?: number;
    vinylEnabled?: boolean;
    seed?: bigint;
    chordActivity?: number;
  } = {},
): EngineState {
  const seed = Seed.from(opts.seed ?? 42n);
  return {
    bpm: opts.bpm ?? 74,
    densityStream: new StaticParam(opts.density ?? 0.18),
    evoCutoffStream: new StaticParam(1800),
    vinylEnabled: opts.vinylEnabled ?? true,
    currentChord: null,
    chordSchedule: [],
    chordActivityStream: new StaticParam(opts.chordActivity ?? 0.35),
    structuralMomentTimes: [],
    position: new PositionStream(seed.child('position'), { baseFreq: 0.002, octaves: 3 }),
  };
}
