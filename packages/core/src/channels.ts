/**
 * Canonical channel names for `NoteEvent.channel`. Use these constants
 * instead of bare strings so typos are caught at type-check time.
 * See docs/event-protocol.md §4 and §9.6.
 */
export const Channels = {
  RHODES: 'rhodes',
  PAD: 'pad',
  KICK: 'kick',
  SNARE: 'snare',
  HAT: 'hat',
  BASS: 'bass',
  BELL: 'bell',
} as const;

export type Channel = (typeof Channels)[keyof typeof Channels];
