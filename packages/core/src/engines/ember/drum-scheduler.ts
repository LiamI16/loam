import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import { clamp01 } from './util.js';

/** 16-step boom-bap kick pattern (per prototype). */
const KICK_SEQ: ReadonlyArray<0 | 1> = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
/** 16-step snare pattern (per prototype) — back-beat on 5 and 13. */
const SNARE_SEQ: ReadonlyArray<0 | 1> = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
/** Probability of a ghost hat on an off-beat (odd) 16th. */
const GHOST_HAT_PROB = 0.18;

/** Per-voice constant micro-timing offsets (seconds). Kick stays on
 * grid; snare drags behind the beat (Dilla / J-Dilla pocket idiom);
 * hat sits slightly ahead, giving the groove forward momentum.
 * Targets: snare drag 10–25 ms, hat ahead 0–8 ms. */
const KICK_OFFSET_S = 0;
const SNARE_OFFSET_S = 0.015;
const HAT_OFFSET_S = -0.003;

/** 16th-note swing ratio for odd-step hits (ghost hats, ghost snares,
 * kick syncopations). 0.5 = perfectly straight; 0.55 = mild swing;
 * 0.62 = Dilla pocket; 0.67 = triplet swing. Base hits land on even
 * steps so they're unaffected — swing colors the *embellishments*. */
const GHOST_SWING_RATIO = 0.55;

/** Velocity accent multipliers per step index 0..15. Beat 1 (step 0)
 * is the strongest, beat 3 (step 8) is second-strongest, beats 2 and 4
 * (steps 4, 12) are medium, "and"s (steps 2/6/10/14) softer,
 * "e"s and "a"s (odd steps) softest. Real drummer groove pattern. */
const ACCENT_MULT: ReadonlyArray<number> = [
  1.0, 0.65, 0.78, 0.65, 0.88, 0.65, 0.78, 0.65, 0.92, 0.65, 0.78, 0.65, 0.88, 0.65, 0.78, 0.65,
];

/** Per-instrument base velocities (pre-accent, pre-jitter). */
const KICK_BASE_VEL = 0.9;
const SNARE_BASE_VEL = 0.7;
const GHOST_SNARE_VEL = 0.22;
const HAT_DOWNBEAT_VEL = 0.5;
const HAT_OFFBEAT_VEL = 0.32;
const GHOST_HAT_VEL = 0.18;

/** ±5% velocity jitter for humanization. */
const JITTER_AMOUNT = 0.05;

/** Per-bar variation roll probabilities. Each bar gets one roll per
 * variation type at its start; the rolled flags hold for the whole bar. */
const KICK_SYNC_BAR_PROB = 0.15; // extra kick on "and-of-4" (step 14)
const HAT_DROP_BAR_PROB = 0.08; // no hats this bar (the "drop")
const OPEN_HAT_BAR_PROB = 0.25; // longer-sustain hat on step 6 or 14
const GHOST_SNARE_BAR_PROB = 0.4; // bar has 1-2 ghost snare hits

/** Open-hat sustained duration in ms (vs 40 ms closed). */
const OPEN_HAT_DURATION_MS = 200;
const CLOSED_HAT_DURATION_MS = 40;

interface BarVariations {
  kickSync: boolean;
  hatDrop: boolean;
  /** Step index (6 or 14) where an open hat replaces the closed hat;
   * null if no open hat this bar. */
  openHatStep: number | null;
  /** Off-16th step indices (subset of [3, 7, 11, 15]) where a ghost
   * snare fires; empty if no ghost snare this bar. */
  ghostSnareSteps: ReadonlyArray<number>;
}

/**
 * Boom-bap drum kit with per-bar variation, per-voice micro-timing,
 * velocity accents, and mild 16th-note swing on off-step hits. The base
 * grid (kick on 1, 7, 11; snare on 5, 13; hat every 8th) is preserved
 * from the prototype, but every layer above it (which bars get ghosts /
 * opens / drops, how loud each hit is, where exactly it sits in time)
 * varies bar-to-bar from a deterministic per-seed roll.
 *
 * Determinism: all rolls come from one rng. Per-bar variations roll
 * first (at the start of each bar), then per-step decisions. Order is
 * stable so the locked-sequence test pins all randomness.
 */
export class DrumScheduler implements SubScheduler {
  private rng!: Rng;
  private nextStep = 0;
  private currentBar = -1;
  private barVar: BarVariations = emptyBarVar();
  private readonly secondsPerStep: number;

  constructor(
    private readonly seed: Seed,
    state: EngineState,
  ) {
    this.secondsPerStep = 60 / state.bpm / 4; // sixteenth note
    this.reset();
  }

  reset(): void {
    this.nextStep = 0;
    this.currentBar = -1;
    this.barVar = emptyBarVar();
    this.rng = this.seed.rng();
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    while (this.nextStep * this.secondsPerStep < to) {
      const stepIdx = this.nextStep % 16;
      const barIdx = Math.floor(this.nextStep / 16);

      // Roll bar variations at the start of each new bar. Always rolls
      // the same 4 values in the same order so the rng cursor is stable.
      if (barIdx !== this.currentBar) {
        this.currentBar = barIdx;
        this.barVar = this.rollBarVariations();
      }

      // Time with per-voice offset + optional 16th swing for odd steps.
      const swungBase = this.swungStepTime(stepIdx);

      this.emitKick(stepIdx, swungBase, events);
      this.emitSnare(stepIdx, swungBase, events);
      this.emitHat(stepIdx, swungBase, events);

      this.nextStep++;
    }
    return events;
  }

  private swungStepTime(stepIdx: number): number {
    const baseTime = this.nextStep * this.secondsPerStep;
    if (stepIdx % 2 === 0) return baseTime;
    // Odd step: push later inside the (even, odd) pair by the swing ratio.
    const pairStart = (this.nextStep - 1) * this.secondsPerStep;
    return pairStart + 2 * this.secondsPerStep * GHOST_SWING_RATIO;
  }

  private emitKick(stepIdx: number, time: number, events: EngineEvent[]): void {
    const baseFires = KICK_SEQ[stepIdx] === 1;
    const syncFires = this.barVar.kickSync && stepIdx === 14;
    if (!baseFires && !syncFires) return;
    const jitter = this.velocityJitter();
    events.push({
      kind: 'note',
      channel: Channels.KICK,
      pitch: 36,
      velocity: clamp01(KICK_BASE_VEL * (ACCENT_MULT[stepIdx] as number) * jitter),
      durationMs: 250,
      time: time + KICK_OFFSET_S,
    });
  }

  private emitSnare(stepIdx: number, time: number, events: EngineEvent[]): void {
    const baseFires = SNARE_SEQ[stepIdx] === 1;
    const ghostFires = !baseFires && this.barVar.ghostSnareSteps.includes(stepIdx);
    if (!baseFires && !ghostFires) return;
    const jitter = this.velocityJitter();
    const baseVel = baseFires ? SNARE_BASE_VEL : GHOST_SNARE_VEL;
    // Ghost notes skip the accent multiplier — drummers play them
    // intentionally soft and even, not modulated by bar position.
    const velocity = baseFires
      ? clamp01(baseVel * (ACCENT_MULT[stepIdx] as number) * jitter)
      : clamp01(baseVel * jitter);
    events.push({
      kind: 'note',
      channel: Channels.SNARE,
      pitch: 38,
      velocity,
      durationMs: baseFires ? 160 : 100,
      time: time + SNARE_OFFSET_S,
    });
  }

  private emitHat(stepIdx: number, time: number, events: EngineEvent[]): void {
    // Whole-bar dropout — the "drop" — fires for this bar only.
    if (this.barVar.hatDrop) return;

    if (stepIdx % 2 === 0) {
      const isOpen = this.barVar.openHatStep === stepIdx;
      const baseVel = stepIdx % 4 === 0 ? HAT_DOWNBEAT_VEL : HAT_OFFBEAT_VEL;
      const jitter = this.velocityJitter();
      events.push({
        kind: 'note',
        channel: Channels.HAT,
        pitch: 42,
        velocity: clamp01(baseVel * (ACCENT_MULT[stepIdx] as number) * jitter),
        durationMs: isOpen ? OPEN_HAT_DURATION_MS : CLOSED_HAT_DURATION_MS,
        time: time + HAT_OFFSET_S,
      });
      return;
    }

    // Odd step → maybe a ghost hat.
    if (this.rng.bernoulli(GHOST_HAT_PROB)) {
      const jitter = this.velocityJitter();
      events.push({
        kind: 'note',
        channel: Channels.HAT,
        pitch: 42,
        velocity: clamp01(GHOST_HAT_VEL * jitter),
        durationMs: CLOSED_HAT_DURATION_MS,
        time: time + HAT_OFFSET_S,
      });
    }
  }

  /** Roll all bar-level flags in a fixed order so rng consumption is
   * deterministic and easy to lock in tests. */
  private rollBarVariations(): BarVariations {
    const kickSync = this.rng.bernoulli(KICK_SYNC_BAR_PROB);
    const hatDrop = this.rng.bernoulli(HAT_DROP_BAR_PROB);
    const openHatRoll = this.rng.bernoulli(OPEN_HAT_BAR_PROB);
    const openHatPick = this.rng.bernoulli(0.5);
    const openHatStep = openHatRoll ? (openHatPick ? 6 : 14) : null;
    const ghostSnareRoll = this.rng.bernoulli(GHOST_SNARE_BAR_PROB);
    const ghostSnareSteps = ghostSnareRoll ? this.rollGhostSnareSteps() : [];
    return { kickSync, hatDrop, openHatStep, ghostSnareSteps };
  }

  /** 1–2 ghost snare positions from [3, 7, 11, 15] — the 'e' / 'a'
   * subdivisions where ghost snares sit musically. Two consecutive
   * positions allowed (e.g. 11 and 15 for an end-of-bar pickup). */
  private rollGhostSnareSteps(): number[] {
    const positions: number[] = [];
    const candidates = [3, 7, 11, 15];
    if (this.rng.bernoulli(0.7)) positions.push(this.rng.pick(candidates));
    if (this.rng.bernoulli(0.35)) {
      const second = this.rng.pick(candidates);
      if (!positions.includes(second)) positions.push(second);
    }
    return positions;
  }

  private velocityJitter(): number {
    return 1 + (this.rng.nextFloat() * 2 - 1) * JITTER_AMOUNT;
  }
}

function emptyBarVar(): BarVariations {
  return { kickSync: false, hatDrop: false, openHatStep: null, ghostSnareSteps: [] };
}
