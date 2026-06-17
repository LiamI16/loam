import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import {
  blendChordWeights,
  CHORDS,
  type ChordName,
  HAND_MATRIX,
  MarkovChordWalk,
  modesAtPosition,
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

/** Voicing register characteristics. Stage 6 set this as a fixed
 * per-seed shift in [-11, +13]. Stage 7a splits the same total
 * envelope into two contributions: a per-seed base shift (chosen at
 * construction, defines the seed's home register) and a position-y
 * driven drift (slow exploration around that home during playback).
 * Combined reach: [-11, +13] semitones around MIDI 64, unchanged.
 *
 * Split: base ∈ [-5, +7], drift = ±6 → total ∈ [-11, +13]. Base range
 * shrunk from [-11, +13] to leave drift headroom while preserving the
 * proven envelope. See `current-stage-list.md` Stage 7a notes for the
 * tradeoff vs option C ("no per-seed base, register entirely
 * position-driven") which is parked for a future tuning pass — more
 * philosophically aligned with the position-space framing but loses
 * the per-seed register identity at t=0. */
const REGISTER_WIDTH = 24;
const REGISTER_CENTER_DEFAULT = 64;
const REGISTER_CENTER_MIN_SHIFT = -5;
const REGISTER_CENTER_MAX_SHIFT = 7;
const REGISTER_DRIFT_AMPLITUDE = 6;

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
  /** Per-seed home register center, in MIDI semitones. The drift from
   * `state.position.y` rides on top of this at chord-change time. */
  private readonly homeCenter: number;

  constructor(
    private readonly seed: Seed,
    private readonly state: EngineState,
  ) {
    this.secondsPerChord = (60 / state.bpm) * 4 * 2; // 2 bars in 4/4
    this.perturbed = perturbMatrix(HAND_MATRIX, seed.child('markov-config').rng(), { alpha: 20 });
    // Per-seed voicing register fingerprint: integer base shift so the
    // chord pitches fall on whole semitones at t=0. Drift is added per
    // chord change from position.y (float OK there — register low/high
    // are computed as Math.floor / Math.ceil bounds).
    const registerRng = seed.child('voicing-register-config').rng();
    const baseShift = registerRng.nextInt(REGISTER_CENTER_MIN_SHIFT, REGISTER_CENTER_MAX_SHIFT);
    this.homeCenter = REGISTER_CENTER_DEFAULT + baseShift;
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
      // that, step the walk before voicing the new chord. Stage 7c.2:
      // mode weights at the current position.x bias the Markov pick
      // toward chords native to the currently-active mode (Aeolian at
      // the engine's home; brighter modes during negative-x excursions;
      // Phrygian during positive-x). The first chord (start state =
      // Am7) is not mode-weighted — keeps the engine anchored at the
      // lofi home; subsequent chords drift toward the active mode.
      const positionX = this.state.position.evaluate(time).x;
      const modeWeights = blendChordWeights(modesAtPosition(positionX));
      let chordName: ChordName;
      if (this.nextChordIdx === 0) {
        chordName = this.walk.peek();
      } else {
        chordName = this.walk.next(modeWeights);
      }
      const chord = CHORDS[chordName];
      // Position-driven register drift: sampled at the chord-change
      // boundary (not mid-chord — re-voicing held notes mid-cycle
      // would be a salient event). position.y is roughly in [-1, 1];
      // scaled by ±6 semitones around the seed's home center.
      const center =
        this.homeCenter + this.state.position.evaluate(time).y * REGISTER_DRIFT_AMPLITUDE;
      const register = {
        low: Math.floor(center - REGISTER_WIDTH / 2),
        high: Math.ceil(center + REGISTER_WIDTH / 2),
      };
      const voicing = voiceChord(this.prevVoicing, chord, { register });
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
