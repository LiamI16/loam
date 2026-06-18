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
  planSlot,
  selectPattern,
  SLOT_PATTERN_BASE_WEIGHTS,
  type SlotPattern,
  SLOT_PATTERNS,
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
  type Mode,
  MODE_POOLS,
  MODES_ORDER,
  type ModePool,
  type ModeWeight,
  modeMidiBag,
  modesAtPosition,
} from './modes.js';
export {
  applyThinness,
  type Archetype,
  ARCHETYPES,
  DEFAULT_REGISTER,
  dropOneVoice,
  type Register,
  rootlessVoicing,
  type VoiceOptions,
  voiceChord,
} from './voicing.js';
