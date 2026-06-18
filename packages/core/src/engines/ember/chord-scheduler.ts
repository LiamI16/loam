import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import { Fbm1D } from '../../noise/fbm.js';
import { FbmParam } from '../../params/param-stream.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import {
  applyThinness,
  type Archetype,
  ARCHETYPES,
  type BarPlan,
  blendChordWeights,
  CHORDS,
  type ChordName,
  type ChordSymbol,
  dropOneVoice,
  HAND_MATRIX,
  type HitSpec,
  MarkovChordWalk,
  modesAtPosition,
  perturbDirichlet,
  perturbMatrix,
  planSlot,
  rootlessVoicing,
  selectPattern,
  SLOT_PATTERN_BASE_WEIGHTS,
  type SlotPattern,
  type TransitionMatrix,
  voiceChord,
} from './harmony/index.js';

/**
 * Chord comping scheduler. Pattern-menu model: each chord slot rolls
 * a `SlotPattern` from per-seed Dirichlet-perturbed weights, tilted by
 * the slow `chord-activity` fBm stream. The pattern declares a per-bar
 * plan of articulations; this scheduler interprets the plan, applies
 * the slot's archetype voicing at the requested thinness, and emits
 * `EngineEvent`s.
 *
 * Pattern menu (see `harmony/comping-patterns.ts`):
 *   - `pure-hold`         — one strong hit at slot start, rings whole slot
 *   - `hold-with-refresh` — strong slot-start + alternating soft taps
 *   - `call-response`     — every bar: strong beat 1, soft beat 3 response
 *   - `light-comping`     — beat 1 every bar + beat 3 on alternating bars
 *   - `active-comping`    — beat 1 + beat 3 every bar (Nujabes flavour)
 *
 * Base weights `[0.40, 0.30, 0.15, 0.10, 0.05]` lean calm; per-seed
 * Dirichlet (α=20) shifts each seed slightly. The activity stream
 * gently tilts pattern selection: calm stretches bias `pure-hold`,
 * active stretches bias the comping patterns. Per `seed-identity.md`
 * §1 (universal fBm) + §2 (per-seed shape) + §3 (couplings).
 *
 * Voicing archetype (close / spread / rootless / quartal) is a
 * separate per-slot roll — patterns don't override archetype. Within-
 * archetype voice-leading still smooths consecutive same-archetype
 * slots; archetype transitions reset.
 *
 * Pickup ("and of 4" of slot's last bar) is preserved as a per-slot
 * 15% roll, voicing the next chord (rootless preview). Independent of
 * pattern — composes with any of them.
 *
 * Slot length is 2 or 4 bars, drawn per slot biased by a slow fBm
 * stream `chord-slot-bias` (per-seed shape modifies mean + range).
 *
 * Pad emits root + fifth at slot start, sustaining the slot length.
 *
 * Determinism: seed children
 *   - `markov-config`              — Dirichlet perturbation of HAND_MATRIX
 *   - `markov-walk`                — Markov walk's step decisions
 *   - `voicing-register-config`    — per-seed home register
 *   - `chord-slot-bias-fbm`        — fBm noise for slot-length bias
 *   - `chord-slot-bias-config`     — per-seed mean + depth modifiers
 *   - `chord-slot-length`          — per-slot {2, 4} rolls
 *   - `chord-activity-fbm`         — fBm noise for pattern-selection tilt
 *   - `chord-activity-config`      — per-seed mean + depth modifiers
 *   - `chord-pickup`               — pickup rolls (per slot transition)
 *   - `chord-velocity`             — velocity jitter
 *   - `chord-archetype-config`     — per-seed Dirichlet archetype weights
 *   - `chord-archetype`            — per-slot archetype rolls
 *   - `chord-pattern-config`       — per-seed Dirichlet pattern weights
 *   - `chord-pattern`              — per-slot pattern rolls
 *   - `chord-micro`                — per-bar drop-a-voice rolls
 */

/** Bass register for the pad root, MIDI C2 (36) – D3 (50). */
const BASS_LOW = 36;
const BASS_HIGH = 50;

/** Voicing register characteristics (carried over from prototype). */
const REGISTER_WIDTH = 24;
const REGISTER_CENTER_DEFAULT = 64;
const REGISTER_CENTER_MIN_SHIFT = -5;
const REGISTER_CENTER_MAX_SHIFT = 7;
const REGISTER_DRIFT_AMPLITUDE = 6;

/** Slot-length palette. Per-slot rolled between {2, 4} bars. */
const SHORT_SLOT_BARS = 2;
const LONG_SLOT_BARS = 4;

/** Slot-bias fBm: probability of a 4-bar (vs 2-bar) slot. */
const SLOT_BIAS_MEAN = 0.4;
const SLOT_BIAS_MIN = 0.2;
const SLOT_BIAS_MAX = 0.6;
const SLOT_BIAS_BASE_FREQ = 1 / 120;
const SLOT_BIAS_MEAN_SHAPE_RANGE = 0.1;
const SLOT_BIAS_DEPTH_SHAPE_RANGE: [number, number] = [0.1, 0.25];

/** Activity fBm: scalar in [0, 1] tilting the per-slot pattern roll
 * via `selectPattern`. Low values bias `pure-hold`; high values bias
 * the comping patterns. Mean 0.35 keeps the seed's default behaviour
 * calm-leaning; the tilt strength is gentle (see comping-patterns.ts)
 * so per-seed Dirichlet shape still dominates identity. Per-seed
 * mean + depth modifiers give each seed its own activity-narrative
 * arc. */
const ACTIVITY_MEAN = 0.35;
const ACTIVITY_MIN = 0.15;
const ACTIVITY_MAX = 0.75;
const ACTIVITY_BASE_FREQ = 1 / 90;
const ACTIVITY_MEAN_SHAPE_RANGE = 0.1;
const ACTIVITY_DEPTH_SHAPE_RANGE: [number, number] = [0.15, 0.35];

/** Pickup ("and of 4" of slot's last bar). Universal rate. */
const PICKUP_PROB = 0.15;

/** Per-seed Dirichlet α for archetype + pattern weight perturbation.
 * Mirrors the Markov layer's α=20 (mild). */
const DIRICHLET_ALPHA = 20;

/** Velocity character. Strong = current "beat-1 anchor" velocity;
 * soft = quieter touch for re-articulation / response hits. */
const VEL_STRONG_BASE = 0.55;
const VEL_SOFT_BASE = 0.4;
const VEL_JITTER = 0.08;
const PICKUP_VEL_MULTIPLIER = 0.7;

/** Archetype base weights — close-leaning. Per-seed Dirichlet-perturbed. */
const ARCHETYPE_BASE_WEIGHTS: readonly number[] = [0.55, 0.2, 0.2, 0.05];

/** Drop-a-voice probability per bar (bars 2+ of any slot, on hits that
 * the pattern declares as 'full' thinness). Inherited from C-stage. */
const MICRO_DROP_PROBABILITY = 0.3;

/** Pickup duration. Pickup is short and quiet. */
const PICKUP_DURATION_BEATS = 0.5;

/** Pad velocity. */
const PAD_VELOCITY = 0.4;

export class ChordScheduler implements SubScheduler {
  private slotLengthRng!: Rng;
  private pickupRng!: Rng;
  private velocityRng!: Rng;
  private archetypeRng!: Rng;
  private patternRng!: Rng;
  private microRng!: Rng;
  private walk!: MarkovChordWalk;

  /** Bar counter — advances by 1 each bar emitted. */
  private nextBarIdx = 0;
  /** Bar index where the current chord slot started. */
  private currentSlotStartBar = 0;
  /** Length of the current chord slot in bars (2 or 4). */
  private currentSlotBars = SHORT_SLOT_BARS;
  /** Active chord, voicing, archetype, and pattern for the current slot. */
  private currentChord: ChordSymbol | null = null;
  private currentVoicing: number[] | null = null;
  private currentArchetype: Archetype = 'close';
  private currentPattern: SlotPattern = 'pure-hold';
  private currentPlan: BarPlan[] = [];
  /** Pre-stepped lookahead for the next slot (used by pickups). */
  private nextChord: ChordSymbol | null = null;
  private nextVoicing: number[] | null = null;
  private nextArchetype: Archetype = 'close';
  /** Pad-root continuity tracker for nearest-octave selection. */
  private prevPadRoot: number | null = null;

  private readonly perturbed: TransitionMatrix;
  private readonly secondsPerBeat: number;
  private readonly secondsPerBar: number;
  private readonly homeCenter: number;
  private readonly slotBiasStream: FbmParam;
  private readonly activityStream: FbmParam;
  /** Per-seed Dirichlet-perturbed archetype weights. */
  private readonly archetypeWeights: number[];
  /** Per-seed Dirichlet-perturbed pattern weights. */
  private readonly patternWeights: number[];

  constructor(
    private readonly seed: Seed,
    private readonly state: EngineState,
  ) {
    this.secondsPerBeat = 60 / state.bpm;
    this.secondsPerBar = this.secondsPerBeat * 4;
    this.perturbed = perturbMatrix(HAND_MATRIX, seed.child('markov-config').rng(), { alpha: 20 });

    // Per-seed voicing register fingerprint (unchanged from prototype).
    const registerRng = seed.child('voicing-register-config').rng();
    const baseShift = registerRng.nextInt(REGISTER_CENTER_MIN_SHIFT, REGISTER_CENTER_MAX_SHIFT);
    this.homeCenter = REGISTER_CENTER_DEFAULT + baseShift;

    // Slot-length-bias stream.
    const slotCfgRng = seed.child('chord-slot-bias-config').rng();
    const slotMeanOffset = slotCfgRng.nextRange(
      -SLOT_BIAS_MEAN_SHAPE_RANGE,
      SLOT_BIAS_MEAN_SHAPE_RANGE,
    );
    const slotDepth = slotCfgRng.nextRange(
      SLOT_BIAS_DEPTH_SHAPE_RANGE[0],
      SLOT_BIAS_DEPTH_SHAPE_RANGE[1],
    );
    this.slotBiasStream = new FbmParam(new Fbm1D(seed.child('chord-slot-bias-fbm')), {
      mean: SLOT_BIAS_MEAN + slotMeanOffset,
      depth: slotDepth,
      baseFreq: SLOT_BIAS_BASE_FREQ,
      minValue: SLOT_BIAS_MIN,
      maxValue: SLOT_BIAS_MAX,
    });

    // Activity stream (replaces the old beat-3 "density" stream — now
    // a single-responsibility tilt input to `selectPattern`).
    const actCfgRng = seed.child('chord-activity-config').rng();
    const actMeanOffset = actCfgRng.nextRange(
      -ACTIVITY_MEAN_SHAPE_RANGE,
      ACTIVITY_MEAN_SHAPE_RANGE,
    );
    const actDepth = actCfgRng.nextRange(
      ACTIVITY_DEPTH_SHAPE_RANGE[0],
      ACTIVITY_DEPTH_SHAPE_RANGE[1],
    );
    this.activityStream = new FbmParam(new Fbm1D(seed.child('chord-activity-fbm')), {
      mean: ACTIVITY_MEAN + actMeanOffset,
      depth: actDepth,
      baseFreq: ACTIVITY_BASE_FREQ,
      minValue: ACTIVITY_MIN,
      maxValue: ACTIVITY_MAX,
    });

    // Per-seed Dirichlet-perturbed archetype + pattern weights.
    this.archetypeWeights = perturbDirichlet(
      ARCHETYPE_BASE_WEIGHTS,
      seed.child('chord-archetype-config').rng(),
      DIRICHLET_ALPHA,
    );
    this.patternWeights = perturbDirichlet(
      SLOT_PATTERN_BASE_WEIGHTS,
      seed.child('chord-pattern-config').rng(),
      DIRICHLET_ALPHA,
    );

    this.reset();
  }

  reset(): void {
    this.nextBarIdx = 0;
    this.currentSlotStartBar = 0;
    this.currentSlotBars = SHORT_SLOT_BARS;
    this.currentChord = null;
    this.currentVoicing = null;
    this.currentArchetype = 'close';
    this.currentPattern = 'pure-hold';
    this.currentPlan = [];
    this.nextChord = null;
    this.nextVoicing = null;
    this.nextArchetype = 'close';
    this.prevPadRoot = null;
    this.slotLengthRng = this.seed.child('chord-slot-length').rng();
    this.pickupRng = this.seed.child('chord-pickup').rng();
    this.velocityRng = this.seed.child('chord-velocity').rng();
    this.archetypeRng = this.seed.child('chord-archetype').rng();
    this.patternRng = this.seed.child('chord-pattern').rng();
    this.microRng = this.seed.child('chord-micro').rng();
    this.walk = new MarkovChordWalk(this.perturbed, this.seed.child('markov-walk').rng(), 'Am7');
    this.state.currentChord = CHORDS[this.walk.peek()];
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    this.state.chordSchedule = [];

    while (this.nextBarIdx * this.secondsPerBar < to) {
      const barTime = this.nextBarIdx * this.secondsPerBar;
      const barInSlot = this.nextBarIdx - this.currentSlotStartBar;

      if (this.currentChord === null || barInSlot >= this.currentSlotBars) {
        this.advanceSlot(barTime, events);
      }
      const currentBarInSlot = this.nextBarIdx - this.currentSlotStartBar;
      const isLastBarOfSlot = currentBarInSlot === this.currentSlotBars - 1;
      const voicing = this.currentVoicing;
      const plan = this.currentPlan[currentBarInSlot];
      if (voicing === null || plan === undefined) {
        this.nextBarIdx++;
        continue;
      }

      for (const hit of plan) {
        this.emitHit(events, hit, barTime, voicing, currentBarInSlot);
      }

      // Pickup: only on last bar of slot. Always roll for determinism.
      const pickupRoll = this.pickupRng.nextFloat();
      if (isLastBarOfSlot && this.nextVoicing !== null) {
        if (pickupRoll < PICKUP_PROB) {
          const time = barTime + 3.5 * this.secondsPerBeat;
          const previewVoicing = rootlessVoicing(this.nextVoicing);
          emitVoicing(
            events,
            previewVoicing,
            time,
            this.velocity('strong') * PICKUP_VEL_MULTIPLIER,
            PICKUP_DURATION_BEATS * this.secondsPerBeat,
          );
        }
      }

      this.nextBarIdx++;
    }
    return events;
  }

  /** Emit one hit from a pattern's bar plan. Applies thinness to the
   * slot voicing, rolls micro-variation for 'full' hits on bars 2+, and
   * dispatches to `emitVoicing`. */
  private emitHit(
    events: EngineEvent[],
    hit: HitSpec,
    barTime: number,
    voicing: number[],
    barInSlot: number,
  ): void {
    // Always consume both micro rolls so determinism is invariant
    // across pattern selection.
    const microRoll = this.microRng.nextFloat();
    const microIdxRoll = this.microRng.nextFloat();
    let pitches = applyThinness(voicing, hit.thinness);
    if (
      barInSlot > 0 &&
      hit.thinness === 'full' &&
      microRoll < MICRO_DROP_PROBABILITY &&
      voicing.length >= 3
    ) {
      const idx = 1 + Math.floor(microIdxRoll * Math.max(1, voicing.length - 2));
      pitches = dropOneVoice(voicing, idx);
    }
    const time = barTime + hit.beatOffset * this.secondsPerBeat;
    const durationSec = hit.durationBeats * this.secondsPerBeat;
    emitVoicing(events, pitches, time, this.velocity(hit.velocity), durationSec);
  }

  /** Rotate to the next chord slot. */
  private advanceSlot(barTime: number, events: EngineEvent[]): void {
    const isFirstSlot = this.currentChord === null;
    if (isFirstSlot) {
      const firstName: ChordName = this.walk.peek();
      const firstChord = CHORDS[firstName];
      const firstArchetype = this.rollArchetype();
      this.currentChord = firstChord;
      this.currentArchetype = firstArchetype;
      this.currentVoicing = this.voiceFor(firstChord, null, barTime, firstArchetype);
      this.preStepNext(barTime);
    } else {
      this.currentChord = this.nextChord;
      this.currentVoicing = this.nextVoicing;
      this.currentArchetype = this.nextArchetype;
      this.currentSlotStartBar = this.nextBarIdx;
      this.preStepNext(barTime);
    }

    // Slot length must precede pattern plan (plan depends on bar count).
    const bias = this.slotBiasStream.evaluate(barTime);
    this.currentSlotBars = this.slotLengthRng.nextFloat() < bias ? LONG_SLOT_BARS : SHORT_SLOT_BARS;

    // Pattern selection, tilted by activity.
    const activityBias = this.activityStream.evaluate(barTime);
    this.currentPattern = selectPattern(this.patternWeights, activityBias, this.patternRng);
    this.currentPlan = planSlot(this.currentPattern, this.currentSlotBars);

    const chord = this.currentChord;
    if (chord === null) return;
    this.state.currentChord = chord;
    this.state.chordSchedule.push({ time: barTime, chord });

    const padRoot = nearestRoot(chord.rootPc, this.prevPadRoot);
    this.prevPadRoot = padRoot;
    const padDurationMs = this.currentSlotBars * this.secondsPerBar * 1000;
    events.push(
      {
        kind: 'note',
        channel: Channels.PAD,
        pitch: padRoot,
        velocity: PAD_VELOCITY,
        durationMs: padDurationMs,
        time: barTime,
      },
      {
        kind: 'note',
        channel: Channels.PAD,
        pitch: padRoot + 7,
        velocity: PAD_VELOCITY,
        durationMs: padDurationMs,
        time: barTime,
      },
    );
  }

  private preStepNext(atTime: number): void {
    const positionX = this.state.position.evaluate(atTime).x;
    const modeWeights = blendChordWeights(modesAtPosition(positionX));
    const nextName = this.walk.next(modeWeights);
    const nextChord = CHORDS[nextName];
    const nextArchetype = this.rollArchetype();
    const prev = nextArchetype === this.currentArchetype ? this.currentVoicing : null;
    this.nextChord = nextChord;
    this.nextArchetype = nextArchetype;
    this.nextVoicing = this.voiceFor(nextChord, prev, atTime, nextArchetype);
  }

  private voiceFor(
    chord: ChordSymbol,
    prev: number[] | null,
    time: number,
    archetype: Archetype,
  ): number[] {
    const center =
      this.homeCenter + this.state.position.evaluate(time).y * REGISTER_DRIFT_AMPLITUDE;
    const register = {
      low: Math.floor(center - REGISTER_WIDTH / 2),
      high: Math.ceil(center + REGISTER_WIDTH / 2),
    };
    return voiceChord(prev, chord, { register, archetype });
  }

  private rollArchetype(): Archetype {
    const roll = this.archetypeRng.nextFloat();
    let acc = 0;
    for (let i = 0; i < ARCHETYPES.length; i++) {
      acc += this.archetypeWeights[i] ?? 0;
      if (roll < acc) return ARCHETYPES[i] as Archetype;
    }
    return ARCHETYPES[ARCHETYPES.length - 1] as Archetype;
  }

  private velocity(kind: 'strong' | 'soft'): number {
    const base = kind === 'strong' ? VEL_STRONG_BASE : VEL_SOFT_BASE;
    return base + this.velocityRng.nextFloat() * VEL_JITTER;
  }
}

function emitVoicing(
  events: EngineEvent[],
  voicing: readonly number[],
  time: number,
  velocity: number,
  durationSec: number,
): void {
  const durationMs = durationSec * 1000;
  const clamped = clamp01(velocity);
  for (const pitch of voicing) {
    events.push({
      kind: 'note',
      channel: Channels.RHODES,
      pitch,
      velocity: clamped,
      durationMs,
      time,
    });
  }
}

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

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
