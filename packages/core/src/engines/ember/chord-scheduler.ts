import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import {
  CHORDS,
  type ChordName,
  HAND_MATRIX,
  MarkovChordWalk,
  perturbMatrix,
  type TransitionMatrix,
  voiceChord,
} from './harmony/index.js';

/**
 * Two-bar chord vamp + soft pad on root + fifth. Stage 6: chords come from
 * a Markov walk over the harmony vocabulary (seed-perturbed per Dirichlet)
 * with a min-motion voicing solver providing voice-leading.
 *
 *   - `seed.child('markov-config')` → Dirichlet perturbation of `HAND_MATRIX`.
 *   - `seed.child('markov-walk')`   → the walk's step decisions.
 *   - On every chord change, mutates `state.currentChord` so other
 *     sub-schedulers (e.g. melody filter) can read the active harmony.
 *
 * Pad still plays root + 5 for 4 bars per chord change. Voicing solver
 * applies to the Rhodes chord notes only.
 */
/** Bass register for the pad root, MIDI: C2 (36) – D3 (50). Wide enough
 * to give every chord root an in-range octave, narrow enough that the
 * smoothing keeps motion under a tritone per change. Floor is C2 so we
 * never push pad fundamentals into sub-bass (where Web Audio reproduction
 * gets murky on smaller speakers). */
const BASS_LOW = 36;
const BASS_HIGH = 50;

/** Probability a held chord re-articulates an inner voice an octave up
 * at bar 1 (mid-cycle). Per `docs/lofi-study.md` §11 voicing rotation —
 * gives sustained chords a subtle shimmer without changing harmony.
 * Tune by listening test; subtler than 0.3 felt static, busier than 0.3
 * started to feel like comping. */
const WOBBLE_PROBABILITY = 0.3;

export class ChordScheduler implements SubScheduler {
  private rng!: Rng;
  private wobbleRng!: Rng;
  private walk!: MarkovChordWalk;
  private prevVoicing: number[] | null = null;
  private prevPadRoot: number | null = null;
  private nextChordIdx = 0;
  private readonly perturbed: TransitionMatrix;
  private readonly secondsPerChord: number;

  constructor(
    private readonly seed: Seed,
    private readonly state: EngineState,
  ) {
    this.secondsPerChord = (60 / state.bpm) * 4 * 2; // 2 bars in 4/4
    this.perturbed = perturbMatrix(HAND_MATRIX, seed.child('markov-config').rng(), { alpha: 20 });
    this.reset();
  }

  reset(): void {
    this.nextChordIdx = 0;
    this.prevVoicing = null;
    this.prevPadRoot = null;
    this.rng = this.seed.rng();
    this.wobbleRng = this.seed.child('voicing-wobble').rng();
    this.walk = new MarkovChordWalk(this.perturbed, this.seed.child('markov-walk').rng(), 'Am7');
    this.state.currentChord = CHORDS[this.walk.peek()];
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    while (this.nextChordIdx * this.secondsPerChord < to) {
      const time = this.nextChordIdx * this.secondsPerChord;

      // First chord uses the walk's current state (set in reset()); after
      // that, step the walk before voicing the new chord.
      let chordName: ChordName;
      if (this.nextChordIdx === 0) {
        chordName = this.walk.peek();
      } else {
        chordName = this.walk.next();
      }
      const chord = CHORDS[chordName];
      const voicing = voiceChord(this.prevVoicing, chord);
      this.prevVoicing = voicing;
      this.state.currentChord = chord;

      const chordDurationMs = (this.secondsPerChord - 0.25) * 1000;
      const chordVelocity = 0.5 + this.rng.nextFloat() * 0.12;
      for (const pitch of voicing) {
        events.push({
          kind: 'note',
          channel: Channels.RHODES,
          pitch,
          velocity: chordVelocity,
          durationMs: chordDurationMs,
          time,
        });
      }

      // Pad: root + fifth, sustaining 4 bars (two chord cycles). Pick the
      // octave of the new chord's root nearest the previous pad root so
      // the bass doesn't leap up to a 7th between chords. First chord
      // anchors at the lower end of the register.
      const padRoot = nearestRoot(chord.rootPc, this.prevPadRoot);
      this.prevPadRoot = padRoot;
      const padDurationMs = this.secondsPerChord * 2 * 1000;
      events.push({
        kind: 'note',
        channel: Channels.PAD,
        pitch: padRoot,
        velocity: 0.4,
        durationMs: padDurationMs,
        time,
      });
      events.push({
        kind: 'note',
        channel: Channels.PAD,
        pitch: padRoot + 7,
        velocity: 0.4,
        durationMs: padDurationMs,
        time,
      });

      // Voicing wobble (§11 voicing rotation): at bar 1 of the chord
      // cycle, with low probability, re-articulate one inner voice an
      // octave up. The original voicing keeps sustaining underneath so
      // this is additive — a brief shimmer rather than a re-voicing.
      // Only triggers on chords with ≥ 3 voices (need an inner voice to
      // pick). Always rolls the RNG so chord-skip determinism is stable.
      const wobbleFires = this.wobbleRng.bernoulli(WOBBLE_PROBABILITY);
      const innerIdxRoll = this.wobbleRng.nextFloat();
      if (wobbleFires && voicing.length >= 3) {
        const innerIdx = 1 + Math.floor(innerIdxRoll * (voicing.length - 2));
        const wobblePitch = (voicing[innerIdx] as number) + 12;
        const wobbleTime = time + this.secondsPerChord / 2;
        const wobbleDurationMs = (this.secondsPerChord / 2 - 0.1) * 1000;
        events.push({
          kind: 'note',
          channel: Channels.RHODES,
          pitch: wobblePitch,
          velocity: chordVelocity * 0.65,
          durationMs: wobbleDurationMs,
          time: wobbleTime,
        });
      }

      this.nextChordIdx++;
    }
    return events;
  }
}

/** Pick the MIDI pitch in BASS_LOW..BASS_HIGH with pitch class `pc` that's
 * closest to `target`. If `target` is null (first chord), anchor at the
 * lower end of the register — keeps the opening grounded. */
function nearestRoot(pc: number, target: number | null): number {
  if (target === null) {
    let p = pc;
    while (p < BASS_LOW) p += 12;
    while (p > BASS_HIGH) p -= 12;
    return p;
  }
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let p = BASS_LOW; p <= BASS_HIGH; p++) {
    if (((p % 12) + 12) % 12 !== pc) continue;
    const d = Math.abs(p - target);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
