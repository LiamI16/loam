import { Channels } from '../../channels.js';
import type { EngineEvent } from '../../events.js';
import { Fbm1D } from '../../noise/fbm.js';
import { FbmParam, type ParamStream, StaticParam } from '../../params/param-stream.js';
import type { Rng } from '../../rng/rng.js';
import type { Seed } from '../../rng/seed.js';
import type { EngineState, SubScheduler } from './ember.js';
import { type ChordSymbol, chordPitchClasses } from './harmony/index.js';

/**
 * Bass voice — a separate instrument from the pad, providing rhythmic
 * low-end content keyed to the chord schedule. Sparse pattern: chord
 * root on beat 1 of every bar (always), root-or-fifth on beat 3 (often,
 * not always). Real-lofi sparse-bass aesthetic — leaves space for the
 * kick and pad to breathe.
 *
 * **Stickiness** (interpretation A + pedal blending). On each chord
 * change, the bass *might* stay on its current note instead of moving
 * to the new chord's root — provided the current note is still a chord
 * tone of the new chord. This blends two real lofi techniques: clear
 * chord-root motion (low stickiness) and pedal-tone foundation (high
 * stickiness).
 *
 * **Two per-seed modes**:
 *   - 70% of seeds (fixed): one stickiness value, used for the whole
 *     session. Clear bass identity per seed ("anchorer" vs "wanderer").
 *   - 30% of seeds (drifting): stickiness varies slowly (fBm, ~3–5 min
 *     slowest octave) around a per-seed mean. Bass has an internal
 *     narrative arc — sometimes moving, sometimes pedaling.
 *
 * Reads `state.chordSchedule` (populated by `ChordScheduler` earlier in
 * the same scheduleUntil pass) to find the active chord at each beat.
 *
 * Determinism: seed children
 *   - `bass`                        — per-beat decisions (jitter, beat-3 rolls)
 *   - `bass-mode`                   — fixed vs drifting choice
 *   - `bass-stickiness-config`      — fixed value OR drift mean + freq
 *   - `bass-stickiness-fbm`         — fBm noise (drifting mode only)
 */

/** Bass register, MIDI: C2 (36) — C3 (48). One octave; covers all
 * 12 pitch classes uniquely. */
const BASS_LOW = 36;
const BASS_HIGH = 48;

/** Probability that beat 3 of a bar gets a bass hit (root or fifth). */
const BEAT_3_PROB = 0.55;

/** Of the beat-3 hits, this fraction play the fifth instead of the
 * root. Keeps bass mostly on the root (genre-aligned). */
const BEAT_3_FIFTH_PROB = 0.3;

/** ±5% velocity jitter for humanization (mirrors drum-scheduler). */
const JITTER_AMOUNT = 0.05;

/** Per-emission base velocities. */
const BEAT_1_VEL = 0.65;
const BEAT_3_VEL = 0.48;

/** Note durations in ms. Beat-1 root is the "thump", beat-3 the
 * "thud". Short by design — sustained low sines excite room/speaker
 * resonance (the "phone on table" effect); short notes stay
 * percussive and let the kick drum cut through. */
const BEAT_1_DURATION_MS = 700;
const BEAT_3_DURATION_MS = 350;

/** Probability that a seed is in "drifting stickiness" mode (vs fixed). */
const DRIFTING_MODE_PROB = 0.3;

/** Fixed-mode stickiness range. 0.2 = mostly moves with chords;
 * 0.65 = often pedals on the current note. */
const FIXED_STICKINESS_MIN = 0.2;
const FIXED_STICKINESS_MAX = 0.65;

/** Drifting-mode mean range — narrower than fixed so drifting seeds
 * still have a recognizable home behavior. */
const DRIFT_MEAN_MIN = 0.25;
const DRIFT_MEAN_MAX = 0.6;

/** Drifting-mode depth around the mean. */
const DRIFT_DEPTH = 0.2;

/** Hard clamps on drifting stickiness — prevent extremes that would
 * flip the seed's identity entirely. */
const DRIFT_MIN_VALUE = 0.05;
const DRIFT_MAX_VALUE = 0.85;

/** Drift base frequency range: slowest octave ~3.3–5.5 min. Faster
 * than position-stream's 12 min because bass behavior is more
 * cognitively salient than register, so drift needs to be felt over
 * minutes (not the whole session). */
const DRIFT_BASE_FREQ_MIN = 0.003;
const DRIFT_BASE_FREQ_MAX = 0.005;

export class BassScheduler implements SubScheduler {
  private rng!: Rng;
  private nextBeat = 0;
  /** The bass pitch currently being held (the stuck-or-moved root).
   * Set at each chord change; beat-1 emits it; beat-3 derives from it. */
  private currentBassRoot: number | null = null;
  /** The chord active at the last bass-root recomputation. Used to
   * detect chord changes between beats. */
  private lastChord: ChordSymbol | null = null;
  private readonly secondsPerBeat: number;
  private readonly stickinessStream: ParamStream;

  constructor(
    private readonly seed: Seed,
    private readonly state: EngineState,
  ) {
    this.secondsPerBeat = 60 / state.bpm;
    // Seed-mode + stickiness config. cfgRng draws stay deterministic
    // across mode branches because the same child name is consumed
    // either way (different ranges inside each branch are acceptable).
    const drifts = seed.child('bass-mode').rng().bernoulli(DRIFTING_MODE_PROB);
    const cfgRng = seed.child('bass-stickiness-config').rng();
    if (drifts) {
      const mean = cfgRng.nextRange(DRIFT_MEAN_MIN, DRIFT_MEAN_MAX);
      const baseFreq = cfgRng.nextRange(DRIFT_BASE_FREQ_MIN, DRIFT_BASE_FREQ_MAX);
      this.stickinessStream = new FbmParam(
        new Fbm1D(seed.child('bass-stickiness-fbm'), { octaves: 3 }),
        {
          mean,
          depth: DRIFT_DEPTH,
          baseFreq,
          minValue: DRIFT_MIN_VALUE,
          maxValue: DRIFT_MAX_VALUE,
        },
      );
    } else {
      const value = cfgRng.nextRange(FIXED_STICKINESS_MIN, FIXED_STICKINESS_MAX);
      this.stickinessStream = new StaticParam(value);
    }
    this.reset();
  }

  reset(): void {
    this.nextBeat = 0;
    this.currentBassRoot = null;
    this.lastChord = null;
    this.rng = this.seed.rng();
  }

  scheduleUntil(_from: number, to: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    while (this.nextBeat * this.secondsPerBeat < to) {
      const time = this.nextBeat * this.secondsPerBeat;
      const beatInBar = this.nextBeat % 4;
      const chord = chordAtTime(time, this.state.chordSchedule);

      if (!chord) {
        this.nextBeat++;
        continue;
      }

      // Chord change → maybe-stick decision.
      if (chord !== this.lastChord) {
        this.recomputeBassRoot(chord, time);
        this.lastChord = chord;
      }

      const root = this.currentBassRoot;
      if (root === null) {
        this.nextBeat++;
        continue;
      }

      if (beatInBar === 0) {
        // Beat 1: held bass root, long sustain.
        events.push({
          kind: 'note',
          channel: Channels.BASS,
          pitch: root,
          velocity: clamp01(BEAT_1_VEL * this.velocityJitter()),
          durationMs: BEAT_1_DURATION_MS,
          time,
        });
      } else if (beatInBar === 2) {
        // Beat 3: roll always (deterministic rng consumption), emit on
        // success. Plays held root, or fifth-of-held-root.
        const beat3Fires = this.rng.bernoulli(BEAT_3_PROB);
        const useFifth = this.rng.bernoulli(BEAT_3_FIFTH_PROB);
        if (beat3Fires) {
          const pitch = useFifth ? nearestPitchInRange((root + 7) % 12, root) : root;
          events.push({
            kind: 'note',
            channel: Channels.BASS,
            pitch,
            velocity: clamp01(BEAT_3_VEL * this.velocityJitter()),
            durationMs: BEAT_3_DURATION_MS,
            time,
          });
        }
      }
      // Beats 2 and 4: silent — leaves space for the snare.

      this.nextBeat++;
    }
    return events;
  }

  /** At each chord change, decide whether to stay on the current bass
   * note (if it's still a chord tone of the new chord) or move to the
   * new chord's lowest root (interpretation A — lowest available). */
  private recomputeBassRoot(chord: ChordSymbol, time: number): void {
    const newLowestRoot = lowestRoot(chord.rootPc);
    if (this.currentBassRoot === null) {
      // First chord — must move (no current note to stick on).
      this.currentBassRoot = newLowestRoot;
      return;
    }
    const currentPc = ((this.currentBassRoot % 12) + 12) % 12;
    const newChordPcs = new Set(chordPitchClasses(chord));
    const canStay = newChordPcs.has(currentPc);
    if (!canStay) {
      this.currentBassRoot = newLowestRoot;
      return;
    }
    // Roll stickiness. Higher stickiness → more likely to stay.
    const stickiness = this.stickinessStream.evaluate(time);
    const shouldStay = this.rng.bernoulli(stickiness);
    if (!shouldStay) this.currentBassRoot = newLowestRoot;
    // else: keep currentBassRoot (pedal/anchor on previous note).
  }

  private velocityJitter(): number {
    return 1 + (this.rng.nextFloat() * 2 - 1) * JITTER_AMOUNT;
  }
}

/** Lowest MIDI pitch in [BASS_LOW, BASS_HIGH] with pitch class `pc`. */
function lowestRoot(pc: number): number {
  const basePc = ((BASS_LOW % 12) + 12) % 12;
  const offset = (((pc - basePc) % 12) + 12) % 12;
  return BASS_LOW + offset;
}

/** Pick the MIDI pitch in [BASS_LOW, BASS_HIGH] with pitch class `pc`
 * closest to `target`. Used for beat-3 fifth so the fifth-of-root
 * sits near the current bass note. */
function nearestPitchInRange(pc: number, target: number): number {
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

/** Find the chord active at `time` from a time-sorted `chordSchedule`.
 * Schedule entries are chord-change *boundaries* — the chord at time t
 * is the one whose entry has the largest time ≤ t. */
function chordAtTime(
  time: number,
  schedule: ReadonlyArray<{ time: number; chord: ChordSymbol }>,
): ChordSymbol | null {
  let active: ChordSymbol | null = null;
  for (const entry of schedule) {
    if (entry.time > time) break;
    active = entry.chord;
  }
  return active;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
