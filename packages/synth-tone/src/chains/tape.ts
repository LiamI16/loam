import * as Tone from 'tone';
import type { ToneAudioAdapter } from '../adapter.js';
import { finiteOr, posFiniteOr } from './opt-validate.js';

export type OverSampleType = 'none' | '2x' | '4x';

/** Tape-texture stage flags (a subset of `LofiChainOptions`). */
export interface TapeOptions {
  /** Master switch for the tape-texture stage: tanh saturation → wow/flutter
   * placed before `warmth`, plus a parallel tape-hiss bed. AESTHETIC, on by
   * default (baked 2026-07-08). `?tape=0` disables for regression A/B.
   * See docs/tape-texture.md. */
  tape?: boolean;
  /** Linear pre-gain into the saturation waveshaper (inverted after by the
   * makeup gain). Positive finite; else fallback to `TAPE_DRIVE_DEFAULT`. */
  tapeDrive?: number;
  /** Waveshaper oversample factor. `'2x'` expected as the alias-free choice
   * at 32 kHz with gentle drive; `'4x'` is a conservative fallback. */
  tapeOversample?: OverSampleType;
  /** Tape-hiss bed level in dB (Tone.Volume). Finite; else fallback. */
  tapeHissDb?: number;
  /** Scalar multiplier on the three wow/flutter LFO amplitudes (ear-tuning
   * knob without recompile). Positive finite; else fallback to 1. */
  tapeWowDepth?: number;
}

// ── tape stage defaults ───────────────────────────────────────────
// Sweep-1 frozen values (docs/tape-texture.md §Measurement sweeps, 2026-07-08).
// Drive 5 is the highest that passes the bass low-band gate (30-150 Hz band
// stays within the OFF-repeat noise floor) after the A-fallback (bass path
// excluded from tapeInput — see the `bassPan.connect(warmth)` line in lofi.ts).
// Oversample '2x' is the lowest alias-free factor; 4x buys no measurable
// improvement over 2x at drive 5. `none` sits at the noise-floor edge; 2x
// is the conservative choice.
const TAPE_DRIVE_DEFAULT = 5;
const TAPE_OVERSAMPLE_DEFAULT: OverSampleType = '2x';
// Level-match correction on top of the 1/drive makeup base
// (docs/tape-texture.md §"Level-matched makeup gain", 2026-07-08). At drive
// 5 the tanh saturator compresses peaks slightly (initial N=4 measurement
// showed −0.87 dB, but overshot on trim; refined via N=8 measurement to
// −0.35 dB mean RMS drop, SE ≈ 0.10 dB). Multiplying makeup by 10^(0.35/20)
// ≈ 1.041 restores bypass-fair level. Measured via
// `packages/synth-tone/scripts/tape-makeup-match.ts`. Drive-dependent: if
// TAPE_DRIVE_DEFAULT changes, re-run the harness and update this trim.
const TAPE_SAT_MAKEUP_TRIM = 1.041;
// Sweep 2 (2026-07-08): frozen at -72 dB after in-mix ear pass. Much
// quieter than the initial -50 dB placeholder — real cassette hiss is
// meant to sit as barely-perceptible "air" under the mix. Character check
// must be in-mix; solo-auditioning at -72 will sound almost silent.
const TAPE_HISS_DB_DEFAULT = -72;
const TAPE_WOW_DEPTH_DEFAULT = 1;
const TAPE_WOW_BASE_S = 0.005;
const TAPE_WOW_MAX_S = 0.008;
const TAPE_SHAPER_CURVE_LEN = 4096;
// Wow/flutter LFO table: (frequency Hz, target cents peak). Non-integer ratios
// so the composite modulation is aperiodic (docs/tape-texture.md decision C1 —
// a single sine reads as seasick vibrato). Amplitudes derive from cents at
// build time via `centsToDelayAmp` so the target character is honest.
const TAPE_WOW_LFOS: ReadonlyArray<{ freq: number; cents: number }> = [
  { freq: 0.5, cents: 7 },
  { freq: 0.37, cents: 5 },
  { freq: 6.3, cents: 2 },
];
// Tape-hiss spectral recipe (docs/tape-texture.md §4, revised 2026-07-08).
// Broadband, statistically stationary — no AM, no carrier waveshaper. Grain
// lives in the spectrum, not the envelope. HP kills mains sub + DC; HF shelf
// shapes the +3 dB/oct rise; LP with -12 dB/oct rolloff brings 20 kHz near
// the noise floor while leaving 12 kHz audible.
const TAPE_HISS_HP_HZ = 60;
const TAPE_HISS_LP_HZ = 11000;
const TAPE_HISS_LP_ROLLOFF = -12;
const TAPE_HISS_SHELF_HZ = 1000;
const TAPE_HISS_SHELF_GAIN_DB = 4;

/** Peak delay-amplitude (seconds) for a sinusoidal delay modulation at
 * frequency `f` Hz that yields a peak pitch deviation of `c` cents.
 * Δ = 2^(c/1200) − 1;  A = Δ / (2π·f). See docs/tape-texture.md §3. */
function centsToDelayAmp(cents: number, freqHz: number): number {
  return (2 ** (cents / 1200) - 1) / (2 * Math.PI * freqHz);
}

/** Nodes/params the tape stage registers back with the adapter. */
export interface TapeStage {
  registerParams(adapter: ToneAudioAdapter): void;
}

/**
 * Insert the tape-texture stage between `tapeInput` and `warmth`, ordered as a
 * real machine — record (saturation) → transport (wow/flutter) → playback
 * losses (`warmth`) — plus a parallel hiss bed straight to `master`. When
 * disabled, `tapeInput → warmth` directly (a unity Gain in series is
 * transparent, so the OFF path is byte-for-byte the pre-tape sound).
 *
 * Returns a `registerParams` hook (rather than registering inline) so the
 * node refs stay encapsulated here instead of threading nullable vars through
 * `buildLofiChain`. The registered params no-op cleanly when the stage is off.
 */
export function installTapeStage(
  deps: { tapeInput: Tone.Gain; warmth: Tone.ToneAudioNode; master: Tone.ToneAudioNode },
  opts: TapeOptions,
): TapeStage {
  const { tapeInput, warmth, master } = deps;

  // Node refs captured by the returned `registerParams`; guards there make the
  // params no-op when the stage isn't built.
  let tapeDriveGain: Tone.Gain | null = null;
  let tapeMakeupGain: Tone.Gain | null = null;
  const tapeWowLfoAmps: number[] = [];
  const tapeWowLfos: Tone.LFO[] = [];
  let tapeHissVol: Tone.Volume | null = null;

  if (opts.tape ?? true) {
    const drive = posFiniteOr(opts.tapeDrive, TAPE_DRIVE_DEFAULT);
    const rawOversample = opts.tapeOversample;
    const oversample: OverSampleType =
      rawOversample === 'none' || rawOversample === '2x' || rawOversample === '4x'
        ? rawOversample
        : TAPE_OVERSAMPLE_DEFAULT;
    const wowDepth = posFiniteOr(opts.tapeWowDepth, TAPE_WOW_DEPTH_DEFAULT);
    const hissDb = finiteOr(opts.tapeHissDb, TAPE_HISS_DB_DEFAULT);

    tapeDriveGain = new Tone.Gain(drive);
    // Symmetric tanh soft-clip. Makeup = (1/drive) × trim, level-matched to the
    // bypass A/B via measured RMS (docs/tape-texture.md).
    const shaper = new Tone.WaveShaper((x) => Math.tanh(x), TAPE_SHAPER_CURVE_LEN);
    shaper.oversample = oversample;
    tapeMakeupGain = new Tone.Gain((1 / drive) * TAPE_SAT_MAKEUP_TRIM);
    const wowDelay = new Tone.Delay(TAPE_WOW_BASE_S, TAPE_WOW_MAX_S);
    tapeInput.chain(tapeDriveGain, shaper, tapeMakeupGain, wowDelay, warmth);

    // Three summed incommensurate sine LFOs modulate delayTime — non-integer
    // ratio ⇒ aperiodic composite ⇒ irregular tape warble rather than a
    // periodic sine wobble (the "rain lesson" — periodic mod reads as voiced
    // sweep). Amps derived from target cents so intent is honest.
    for (const { freq, cents } of TAPE_WOW_LFOS) {
      const baseAmp = centsToDelayAmp(cents, freq);
      tapeWowLfoAmps.push(baseAmp);
      const amp = baseAmp * wowDepth;
      const lfo = new Tone.LFO({ frequency: freq, min: -amp, max: amp, type: 'sine' }).start();
      lfo.connect(wowDelay.delayTime);
      tapeWowLfos.push(lfo);
    }

    // Parallel tape-hiss bed: white → HP → HF shelf → LP → Volume → master.
    // Broadband, statistically stationary. Bypasses tape + warmth (it is the
    // noise floor: must not be wowed / saturated, and warmth's LP must not eat
    // it). Mono, always-on when the stage is on.
    const hiss = new Tone.Noise('white').start();
    const hissHp = new Tone.Filter({ type: 'highpass', frequency: TAPE_HISS_HP_HZ });
    const hissShelf = new Tone.Filter({
      type: 'highshelf',
      frequency: TAPE_HISS_SHELF_HZ,
      gain: TAPE_HISS_SHELF_GAIN_DB,
    });
    const hissLp = new Tone.Filter({
      type: 'lowpass',
      frequency: TAPE_HISS_LP_HZ,
      rolloff: TAPE_HISS_LP_ROLLOFF,
    });
    tapeHissVol = new Tone.Volume(hissDb);
    hiss.chain(hissHp, hissShelf, hissLp, tapeHissVol, master);
  } else {
    tapeInput.connect(warmth);
  }

  return {
    registerParams(adapter: ToneAudioAdapter): void {
      // Drive updates the makeup gain in lockstep so the level-match holds —
      // makeup = (1/drive) × TAPE_SAT_MAKEUP_TRIM (frozen constant that
      // corrects the tanh's peak-compression at the frozen drive; see
      // docs/tape-texture.md §"Level-matched makeup gain"). TRIM was measured
      // at drive 5 and is drive-dependent; a large drive change via this param
      // may drift level-fairness ±1 dB — acceptable for a gradual drift knob,
      // not for wholesale drive changes. All params no-op when the stage is
      // off (nodes are null).
      adapter.registerParam('fx.tape.saturationDrive', {
        set: (v) => {
          if (!tapeDriveGain || !tapeMakeupGain || v <= 0) return;
          tapeDriveGain.gain.value = v;
          tapeMakeupGain.gain.value = (1 / v) * TAPE_SAT_MAKEUP_TRIM;
        },
        ramp: (v, t, startTime) => {
          if (!tapeDriveGain || !tapeMakeupGain || v <= 0) return;
          tapeDriveGain.gain.rampTo(v, t, startTime);
          tapeMakeupGain.gain.rampTo((1 / v) * TAPE_SAT_MAKEUP_TRIM, t, startTime);
        },
      });
      adapter.registerParam('fx.tape.wowDepth', {
        set: (v) => {
          applyWowDepth(tapeWowLfos, tapeWowLfoAmps, v);
        },
        ramp: (v, _t, _startTime) => {
          // LFO.min/max are plain numbers, not Tone.Params — no ramp API. Apply
          // at dispatch; the engine's 250 ms cadence is well below any wow
          // depth drift rate we'd use, so the step is imperceptible.
          applyWowDepth(tapeWowLfos, tapeWowLfoAmps, v);
        },
      });
      adapter.registerParam('bed.hiss.level', {
        set: (v) => {
          if (!tapeHissVol) return;
          tapeHissVol.volume.value = v;
        },
        ramp: (v, t, startTime) => {
          if (!tapeHissVol) return;
          tapeHissVol.volume.rampTo(v, t, startTime);
        },
      });
    },
  };
}

/** Scale all three wow LFOs' peak deviation by `depth` around their base amps. */
function applyWowDepth(lfos: Tone.LFO[], baseAmps: number[], depth: number): void {
  if (lfos.length === 0) return;
  for (let i = 0; i < lfos.length; i++) {
    const base = baseAmps[i] ?? 0;
    const lfo = lfos[i];
    if (!lfo) continue;
    lfo.min = -base * depth;
    lfo.max = base * depth;
  }
}
