import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import { Fbm1D } from '../../noise/fbm.js';
import { FbmParam } from '../../params/param-stream.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import {
  type Archetype,
  ARCHETYPES,
  blendChordWeights,
  CHORDS,
  type ChordName,
  type ChordSymbol,
  dropOneVoice,
  HAND_MATRIX,
  MarkovChordWalk,
  modesAtPosition,
  perturbDirichlet,
  perturbMatrix,
  rootlessVoicing,
  type TransitionMatrix,
  voiceChord,
} from './harmony/index.js';

/**
 * Chord comping scheduler. Replaces the prototype's one-sustained-
 * voicing-per-cycle model with rhythmic bar-grid emission. See
 * `stage-list.md` "Next up — chord comping" for the full design
 * and `docs/seed-identity.md` for the per-seed parameter contract.
 *
 * Per-bar emission grid. Within each chord slot (2 or 4 bars):
 *   - Beat 1 of the slot's first bar: always (anchors the harmony).
 *   - Beat 1 of subsequent bars: rolled by `density` fBm stream.
 *   - Beat 3 of every bar: rolled by `density` fBm stream.
 *   - "And of 4" of the slot's last bar: 15% pickup, plays the
 *     *next* chord (anticipates the harmony change).
 *   - Beat 2.5 off-beat syncopation: rare per-seed Beta-drawn rate;
 *     substitutes for that bar's beat-1 hit; 16-bar refractory.
 *
 * Slot length is 2 or 4 bars, drawn per slot biased by a slow fBm
 * stream `chord.slot-bias` (per-seed shape modifies mean + range).
 *
 * Pad emits root + fifth at slot start, sustaining the slot length.
 *
 * Voicing variation (C — landed 2026-06-17):
 *   - Per-slot **archetype**: close / spread / rootless / quartal,
 *     rolled per slot from per-seed Dirichlet-perturbed weights
 *     `[0.55, 0.20, 0.20, 0.05]` (α=20).
 *   - Within-slot voice-leading only applies when consecutive slots
 *     share an archetype (close-to-close, etc.). Archetype transitions
 *     reset voicing — each archetype emits its natural voicing form.
 *   - **Micro-variation**: bars 2+ of any slot have a 30% chance of
 *     dropping one inner voice (the "thinned re-articulation" feel).
 *     Bar 1 of every slot is always full.
 *   - **Pickup** uses the next slot's archetype voicing with the
 *     bottom voice dropped — rootless preview (the next downbeat
 *     anchors the root).
 *
 * Per-seed identity: this scheduler exercises three layers of
 * `docs/seed-identity.md`:
 *   - §1 universal fBm drift: density + slot-bias both drift.
 *   - §2 per-seed fBm shape: mean + depth modifiers per seed.
 *   - "Rare-event carve-out": off-beat sync rate is a per-seed
 *     Beta-drawn fixed value (drift would be invisible at ~70 bar
 *     mean interval).
 *
 * Determinism: seed children
 *   - `markov-config`              — Dirichlet perturbation of HAND_MATRIX
 *   - `markov-walk`                — Markov walk's step decisions
 *   - `voicing-register-config`    — per-seed home register
 *   - `chord-slot-bias-fbm`        — fBm noise for slot-length bias
 *   - `chord-slot-bias-config`     — per-seed mean + depth modifiers
 *   - `chord-slot-length`          — per-slot {2, 4} rolls
 *   - `chord-density-fbm`          — fBm noise for beat-1/beat-3 firing
 *   - `chord-density-config`       — per-seed mean + depth modifiers
 *   - `chord-pickup`               — pickup rolls (per slot transition)
 *   - `chord-sync-config`          — per-seed Beta-drawn sync rate
 *   - `chord-sync`                 — per-bar sync rolls
 *   - `chord-velocity`             — velocity jitter
 *   - `chord-archetype-config`     — per-seed Dirichlet archetype weights
 *   - `chord-archetype`            — per-slot archetype rolls
 *   - `chord-micro`                — per-bar drop-a-voice rolls (bars 2+)
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

/** Slot-bias fBm: probability of a 4-bar (vs 2-bar) slot.
 * Universal range. Per-seed mean offset + depth modifier on top. */
const SLOT_BIAS_MEAN = 0.4;
const SLOT_BIAS_DEPTH = 0.2;
const SLOT_BIAS_MIN = 0.2;
const SLOT_BIAS_MAX = 0.6;
const SLOT_BIAS_BASE_FREQ = 1 / 120; // slowest octave ~120 s
const SLOT_BIAS_MEAN_SHAPE_RANGE = 0.1;
const SLOT_BIAS_DEPTH_SHAPE_RANGE: [number, number] = [0.1, 0.25];

/** Density fBm: probability beat-3 fires. (Beat 1 is anchored on every
 * bar regardless.) Range [0.2, 0.65], slowest octave ~90 s. Calmer
 * than the initial [0.3, 0.9] which made the chord layer feel busier
 * than canonical lofi — beat 3 now fires ~35% on average, leaving
 * meaningful space between hits even in dense stretches. Per-seed
 * mean + depth still apply on top. */
const DENSITY_MEAN = 0.35;
const DENSITY_DEPTH = 0.25;
const DENSITY_MIN = 0.2;
const DENSITY_MAX = 0.65;
const DENSITY_BASE_FREQ = 1 / 90;
const DENSITY_MEAN_SHAPE_RANGE = 0.1;
const DENSITY_DEPTH_SHAPE_RANGE: [number, number] = [0.15, 0.35];

/** Pickup ("and of 4" of slot's last bar). Universal rate. */
const PICKUP_PROB = 0.15;

/** Off-beat syncopation (beat 2.5). Per-seed Beta(2,5)-scaled rate;
 * refractory blocks back-to-back hits within `SYNC_REFRACTORY_BARS`. */
const SYNC_RATE_MAX = 0.05;
const SYNC_REFRACTORY_BARS = 16;
const BETA_A = 2;
const BETA_B = 5;

/** Velocity jitter (matches drum/bass schedulers). */
const VEL_BASE = 0.55;
const VEL_JITTER = 0.08;
const PICKUP_VEL_MULTIPLIER = 0.7;

/** Archetype base weights — close-leaning baseline with quartal as
 * rare colour. Per-seed Dirichlet-perturbed at α=20 (mirrors the
 * Markov layer; mild perturbation that keeps every seed close to
 * the prior). */
const ARCHETYPE_BASE_WEIGHTS: readonly number[] = [0.55, 0.20, 0.20, 0.05];
const ARCHETYPE_DIRICHLET_ALPHA = 20;

/** Drop-a-voice probability per bar (bars 2+ of any slot). 30% gives
 * ~0.9 thinned hits per 4-bar slot — subtle but audible. Bar 1 is
 * always full (anchor). */
const MICRO_DROP_PROBABILITY = 0.3;

/** Hit durations in beats (multiplied by `60 / bpm` at emit). */
const BEAT_1_DURATION_BEATS = 1.0;
const BEAT_3_DURATION_BEATS = 0.75;
const PICKUP_DURATION_BEATS = 0.5;
const SYNC_DURATION_BEATS = 0.75;

/** Pad velocity. */
const PAD_VELOCITY = 0.4;

export class ChordScheduler implements SubScheduler {
  private hitRng!: Rng;
  private slotLengthRng!: Rng;
  private pickupRng!: Rng;
  private syncRng!: Rng;
  private velocityRng!: Rng;
  private archetypeRng!: Rng;
  private microRng!: Rng;
  private walk!: MarkovChordWalk;

  /** Bar counter — advances by 1 each bar emitted. */
  private nextBarIdx = 0;
  /** Bar index where the current chord slot started. */
  private currentSlotStartBar = 0;
  /** Length of the current chord slot in bars (2 or 4). */
  private currentSlotBars = SHORT_SLOT_BARS;
  /** Active chord and its voicing for the current slot. */
  private currentChord: ChordSymbol | null = null;
  private currentVoicing: number[] | null = null;
  private currentArchetype: Archetype = 'close';
  /** Pre-stepped lookahead: the chord starting at the next slot.
   * Computed at current slot start so pickups can voice it ahead. */
  private nextChord: ChordSymbol | null = null;
  private nextVoicing: number[] | null = null;
  private nextArchetype: Archetype = 'close';
  /** Pad-root continuity tracker for nearest-octave selection. */
  private prevPadRoot: number | null = null;
  /** Bar index of the most recent off-beat sync hit; used for
   * the refractory check. Negative sentinel means "never fired". */
  private lastSyncBar = -SYNC_REFRACTORY_BARS - 1;

  private readonly perturbed: TransitionMatrix;
  private readonly secondsPerBeat: number;
  private readonly secondsPerBar: number;
  private readonly homeCenter: number;
  private readonly slotBiasStream: FbmParam;
  private readonly densityStream: FbmParam;
  /** Per-seed Beta-drawn sync rate. Drift would be invisible at
   * this event interval — see seed-identity.md carve-out. */
  private readonly syncRate: number;
  /** Per-seed Dirichlet-perturbed archetype weights (sums to 1).
   * Indexed parallel to `ARCHETYPES`. */
  private readonly archetypeWeights: number[];

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

    // Slot-length-bias stream: fBm + per-seed mean offset + per-seed depth.
    const slotCfgRng = seed.child('chord-slot-bias-config').rng();
    const slotMeanOffset = slotCfgRng.nextRange(-SLOT_BIAS_MEAN_SHAPE_RANGE, SLOT_BIAS_MEAN_SHAPE_RANGE);
    const slotDepth = slotCfgRng.nextRange(SLOT_BIAS_DEPTH_SHAPE_RANGE[0], SLOT_BIAS_DEPTH_SHAPE_RANGE[1]);
    this.slotBiasStream = new FbmParam(new Fbm1D(seed.child('chord-slot-bias-fbm')), {
      mean: SLOT_BIAS_MEAN + slotMeanOffset,
      depth: slotDepth,
      baseFreq: SLOT_BIAS_BASE_FREQ,
      minValue: SLOT_BIAS_MIN,
      maxValue: SLOT_BIAS_MAX,
    });
    // Density stream: same structural pattern.
    const densCfgRng = seed.child('chord-density-config').rng();
    const densMeanOffset = densCfgRng.nextRange(-DENSITY_MEAN_SHAPE_RANGE, DENSITY_MEAN_SHAPE_RANGE);
    const densDepth = densCfgRng.nextRange(DENSITY_DEPTH_SHAPE_RANGE[0], DENSITY_DEPTH_SHAPE_RANGE[1]);
    this.densityStream = new FbmParam(new Fbm1D(seed.child('chord-density-fbm')), {
      mean: DENSITY_MEAN + densMeanOffset,
      depth: densDepth,
      baseFreq: DENSITY_BASE_FREQ,
      minValue: DENSITY_MIN,
      maxValue: DENSITY_MAX,
    });
    // Sync rate: per-seed Beta(2,5)·0.05 fixed draw.
    const syncCfgRng = seed.child('chord-sync-config').rng();
    this.syncRate = sampleBeta(syncCfgRng, BETA_A, BETA_B) * SYNC_RATE_MAX;

    // Per-seed Dirichlet-perturbed archetype weights. α=20 keeps every
    // seed close to the [close, spread, rootless, quartal] = base, while
    // still producing audibly different leans seed-to-seed.
    const archCfgRng = seed.child('chord-archetype-config').rng();
    this.archetypeWeights = perturbDirichlet(
      ARCHETYPE_BASE_WEIGHTS,
      archCfgRng,
      ARCHETYPE_DIRICHLET_ALPHA,
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
    this.nextChord = null;
    this.nextVoicing = null;
    this.nextArchetype = 'close';
    this.prevPadRoot = null;
    this.lastSyncBar = -SYNC_REFRACTORY_BARS - 1;
    this.hitRng = this.seed.rng();
    this.slotLengthRng = this.seed.child('chord-slot-length').rng();
    this.pickupRng = this.seed.child('chord-pickup').rng();
    this.syncRng = this.seed.child('chord-sync').rng();
    this.velocityRng = this.seed.child('chord-velocity').rng();
    this.archetypeRng = this.seed.child('chord-archetype').rng();
    this.microRng = this.seed.child('chord-micro').rng();
    this.walk = new MarkovChordWalk(this.perturbed, this.seed.child('markov-walk').rng(), 'Am7');
    this.state.currentChord = CHORDS[this.walk.peek()];
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    // Reset the per-window chord schedule. ChordScheduler runs first
    // in EmberEngine.scheduleUntil; downstream schedulers (BassScheduler)
    // read state.chordSchedule to know which chord is active when.
    this.state.chordSchedule = [];

    while (this.nextBarIdx * this.secondsPerBar < to) {
      const barTime = this.nextBarIdx * this.secondsPerBar;
      const barInSlot = this.nextBarIdx - this.currentSlotStartBar;

      // Slot boundary: rotate next → current, voice a new "next" chord,
      // roll the new slot length, emit pad and chord-schedule entry.
      if (this.currentChord === null || barInSlot >= this.currentSlotBars) {
        this.advanceSlot(barTime, events);
        // Update bar-in-slot now that the slot has rotated.
      }
      const currentBarInSlot = this.nextBarIdx - this.currentSlotStartBar;
      const isLastBarOfSlot = currentBarInSlot === this.currentSlotBars - 1;
      const isFirstBarOfSlot = currentBarInSlot === 0;
      const chord = this.currentChord;
      const voicing = this.currentVoicing;
      if (chord === null || voicing === null) {
        this.nextBarIdx++;
        continue;
      }

      const density = this.densityStream.evaluate(barTime);

      // Off-beat syncopation: rolled per bar (always consume the RNG so
      // refractory-vs-no doesn't shift downstream RNG state). Substitutes
      // for beat-1 of the bar.
      const syncRoll = this.syncRng.nextFloat();
      const syncRefractoryOK = this.nextBarIdx - this.lastSyncBar >= SYNC_REFRACTORY_BARS;
      const syncFires = syncRoll < this.syncRate && syncRefractoryOK;
      // Beat-1 roll (only matters when not anchored and not displaced by sync).
      const beat1Roll = this.hitRng.nextFloat();
      const beat3Roll = this.hitRng.nextFloat();

      // Per-bar micro-variation roll: bar 1 is always full; bars 2+
      // get a chance to drop one inner voice. Always consume the rng
      // and the index roll to keep determinism stable regardless of
      // which bar this is.
      const microRoll = this.microRng.nextFloat();
      const microIdxRoll = this.microRng.nextFloat();
      const microFires = !isFirstBarOfSlot && microRoll < MICRO_DROP_PROBABILITY;
      const hitVoicing = microFires
        ? dropOneVoice(voicing, 1 + Math.floor(microIdxRoll * Math.max(1, voicing.length - 2)))
        : voicing;

      if (syncFires) {
        const time = barTime + 2.5 * this.secondsPerBeat;
        emitVoicing(events, hitVoicing, time, this.velocity(), SYNC_DURATION_BEATS * this.secondsPerBeat);
        this.lastSyncBar = this.nextBarIdx;
      } else {
        // Beat 1 of every bar always fires. `beat1Roll` is consumed (for
        // determinism stability with prior tuning) but no longer gates
        // the hit — earlier rule of "rolled on subsequent bars" produced
        // up to ~13 s of chord silence in low-density patches on 4-bar
        // slots, which read as "the music stopped." Density still
        // controls busy-ness via beat 3, pickup, and sync. The "space"
        // remains in the silence between beat 1 and beat 3 and the
        // absence-of-beat-3 cases.
        void beat1Roll;
        void isFirstBarOfSlot;
        const time = barTime;
        emitVoicing(events, hitVoicing, time, this.velocity(), BEAT_1_DURATION_BEATS * this.secondsPerBeat);
      }

      const beat3Fires = beat3Roll < density;
      if (beat3Fires) {
        const time = barTime + 2 * this.secondsPerBeat;
        emitVoicing(events, hitVoicing, time, this.velocity(), BEAT_3_DURATION_BEATS * this.secondsPerBeat);
      }

      // Pickup: only on last bar of slot, only if we have a next-chord
      // voicing to anticipate. Always roll for determinism. The pickup
      // is a rootless preview — drop the bottom voice of the next
      // slot's voicing so the next downbeat lands the anchor tone.
      const pickupRoll = this.pickupRng.nextFloat();
      if (isLastBarOfSlot && this.nextVoicing !== null) {
        const pickupFires = pickupRoll < PICKUP_PROB;
        if (pickupFires) {
          const time = barTime + 3.5 * this.secondsPerBeat;
          const previewVoicing = rootlessVoicing(this.nextVoicing);
          emitVoicing(
            events,
            previewVoicing,
            time,
            this.velocity() * PICKUP_VEL_MULTIPLIER,
            PICKUP_DURATION_BEATS * this.secondsPerBeat,
          );
        }
      }

      this.nextBarIdx++;
    }
    return events;
  }

  /** Rotate to the next chord slot: pre-stepped next-chord becomes
   * current, walk advances to pre-step a new next, emit pad + chord-
   * schedule entry, roll new slot length. */
  private advanceSlot(barTime: number, events: EngineEvent[]): void {
    const isFirstSlot = this.currentChord === null;
    if (isFirstSlot) {
      // Walk starts at Am7 (peek). First-chord voicing uses no prev.
      const firstName: ChordName = this.walk.peek();
      const firstChord = CHORDS[firstName];
      const firstArchetype = this.rollArchetype();
      this.currentChord = firstChord;
      this.currentArchetype = firstArchetype;
      this.currentVoicing = this.voiceFor(firstChord, null, barTime, firstArchetype);
      // Pre-step the walk so we know the next chord for pickups.
      this.preStepNext(barTime);
    } else {
      // Rotate pre-stepped next → current.
      this.currentChord = this.nextChord;
      this.currentVoicing = this.nextVoicing;
      this.currentArchetype = this.nextArchetype;
      this.currentSlotStartBar = this.nextBarIdx;
      // Now compute the *new* next chord for the upcoming pickup window.
      this.preStepNext(barTime);
    }
    // Roll the new slot length using current slot-bias.
    const bias = this.slotBiasStream.evaluate(barTime);
    this.currentSlotBars = this.slotLengthRng.nextFloat() < bias ? LONG_SLOT_BARS : SHORT_SLOT_BARS;

    const chord = this.currentChord;
    if (chord === null) return;
    this.state.currentChord = chord;
    this.state.chordSchedule.push({ time: barTime, chord });

    // Pad: root + fifth, sustaining the slot length.
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

  /** Pre-step the Markov walk to compute the chord that will start
   * at the *next* slot, roll its archetype, and voice it using the
   * current voicing as `prev` only when the archetype matches (else
   * reset — archetype transitions skip voice-leading per design). */
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

  /** Voice a chord in the supplied archetype with position-driven
   * register; voice-leading from `prev` only applies for `close`. */
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

  /** Roll one archetype from the per-seed Dirichlet-perturbed weights. */
  private rollArchetype(): Archetype {
    const roll = this.archetypeRng.nextFloat();
    let acc = 0;
    for (let i = 0; i < ARCHETYPES.length; i++) {
      acc += this.archetypeWeights[i] ?? 0;
      if (roll < acc) return ARCHETYPES[i] as Archetype;
    }
    return ARCHETYPES[ARCHETYPES.length - 1] as Archetype;
  }

  private velocity(): number {
    return VEL_BASE + this.velocityRng.nextFloat() * VEL_JITTER;
  }

}

function emitVoicing(
  events: EngineEvent[],
  voicing: number[],
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

/** Sample from Beta(α, β) using the Gamma-ratio identity for
 * positive integer shape parameters. X ~ Gamma(k, 1) is the sum of
 * k iid Exponential(1) variates, and Exponential(1) = -log(U). */
function sampleBeta(rng: Rng, alpha: number, beta: number): number {
  let x = 0;
  for (let i = 0; i < alpha; i++) x -= Math.log(1 - rng.nextFloat());
  let y = 0;
  for (let i = 0; i < beta; i++) y -= Math.log(1 - rng.nextFloat());
  return x / (x + y);
}

/** Pick the MIDI pitch in BASS_LOW..BASS_HIGH with pitch class `pc`
 * closest to `target`. Null target anchors at the lower end. */
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
