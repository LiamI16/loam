export {
  CHORD_NAMES,
  CHORDS,
  type ChordName,
  type ChordSymbol,
  chordPitchClasses,
  type Quality,
} from './chords.js';
export {
  type BarPlan,
  type HitSpec,
  type HitVelocity,
  PATTERN_ACTIVITY,
  PATTERN_TRANSITION_MATRIX,
  perturbPatternMatrix,
  planSlot,
  SLOT_PATTERN_BASE_WEIGHTS,
  SLOT_PATTERNS,
  type SlotPattern,
  selectNextPattern,
  selectPattern,
  type VoicingThinness,
} from './comping-patterns.js';
export { type DirichletOptions, perturbDirichlet, perturbMatrix } from './dirichlet.js';
export {
  HAND_MATRIX,
  MarkovChordWalk,
  type TransitionMatrix,
  type TransitionRow,
} from './markov.js';
export {
  blendChordWeights,
  dominantModeAtPosition,
  MODE_POOLS,
  MODES_ORDER,
  type Mode,
  type ModePool,
  type ModeWeight,
  modeMidiBag,
  modesAtPosition,
} from './modes.js';
export {
  ARCHETYPES,
  type Archetype,
  applyThinness,
  DEFAULT_REGISTER,
  dropOneVoice,
  type Register,
  rootlessVoicing,
  type VoiceOptions,
  voiceChord,
} from './voicing.js';
