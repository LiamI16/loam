import { Channels } from '@loam/core';
import * as Tone from 'tone';
import type { ToneAudioAdapter } from '../adapter.js';
import { installSamplerCrush } from './sampler-crush.js';

/**
 * Builds the v1 lo-fi signal chain. Registers channels and parameter
 * targets with the adapter; consumers don't need to know what's inside.
 *
 * Send/return mixer architecture: each instrument has its own panner and
 * its own send-level into one shared reverb bus. Dry path goes through
 * `warmth → master`; wet path goes through `reverb → warmth → master`.
 * Per-instrument pan + send levels are tuned per the table in
 * `stage-list.md`.
 *
 * Exposed parameter targets (UI sliders / engine `ParamEvent`s):
 *   - `master.warmth`    — warmth filter cutoff (Hz)
 *   - `master.volume`    — adapter master gain (linear)
 *   - `bed.rain.level`   — rain bed volume (dB)
 *   - `fx.evoFilter.cutoff`, `fx.chorus.depth`, `fx.drumBus.cutoff`
 */
/**
 * Render-side options for the lofi chain (docs/audio-cpu-plan.md Phase 2).
 *
 * These were A/B'd by ear + offline render-timing and found audibly identical
 * to the old stereo/decay-7 chain while cutting ~12% of total DSP, so they are
 * now the **defaults**. Each option is left overridable (the web demo exposes
 * `?monoverb=0` / `?reverbdecay=7` / `?monobed=0`) so the pre-Phase-2 sound can
 * be restored for regression comparison without a rebuild. Omitted → default.
 */
export interface LofiChainOptions {
  /** Mono reverb IR (centered tail, ~half the convolution cost) vs Tone's
   * stereo IR. Task 3. Default true; pass false for the old stereo IR. */
  monoReverb?: boolean;
  /** Reverb tail length in seconds (IR length → convolution cost). Applies to
   * both the mono and stereo paths. Task 4. Default 3 (was 7). */
  reverbDecay?: number;
  /** Drop the always-on brown-bed StereoWidener (slightly narrower bed) for a
   * small always-on saving. Task 5. Default true; pass false to re-widen. */
  monoBed?: boolean;
  /** Vintage-sampler treatment on the keys (chord + melody): linear-hold
   * sample-rate reduction + 12-bit dithered quantization via a minimal
   * AudioWorklet. AESTHETIC, default off. Recipe locked by offline A/B —
   * see docs/sampler-character.md. */
  keysCrush?: boolean;
  /** Integer decimation factor for `keysCrush` (effective rate = context
   * rate / factor; 4 ⇒ 8 kHz at the 32 kHz default). Clamped to 1–8.
   * Default 4. Ear-tuning knob. */
  keysCrushRate?: number;
  /** Quantization bit depth for `keysCrush` (1–16, clamped). Default 12. */
  keysCrushBits?: number;
  /** Drive into the quantizer (linear gain, inverted after) — staging so the
   * bit depth is honest for a below-full-scale signal. Must be a positive
   * finite number; anything else falls back to `KEYS_CRUSH_DRIVE_DEFAULT`. */
  keysCrushDrive?: number;
}

const REVERB_DECAY_DEFAULT = 3;
const REVERB_PREDELAY = 0.02;
/** Quantizer staging (see `keysCrushDrive`): the keys sit well below 0 dBFS,
 * so without a boost the quantizer only sees the noise-floor regime.
 * Ear-test history: docs/sampler-character.md. */
const KEYS_CRUSH_DRIVE_DEFAULT = 4;
const KEYS_CRUSH_BITS_DEFAULT = 12;
const KEYS_CRUSH_RATE_DEFAULT = 4;

export function buildLofiChain(adapter: ToneAudioAdapter, opts: LofiChainOptions = {}): void {
  // ── master & shared reverb return ───────────────────────────────
  const warmth = new Tone.Filter({
    type: 'lowpass',
    frequency: warmHz(0.7),
    rolloff: -24,
  }).connect(adapter.master);
  // Shared reverb bus. wet=1 because reverb is now a send/return:
  // dry signal travels its own path; each instrument's `*Send` gain
  // controls how much of it is fed to the reverb input. The reverb
  // output is 100% wet and gets summed back into warmth.
  //
  // The convolution reverb is the dominant *always-on* DSP cost (~43% of the
  // floor in Phase-0 profiling). A mono IR ≈ halves its convolution and a
  // shorter decay shortens the IR proportionally; profiling + ear-check found
  // mono + decay-3 audibly indistinguishable from the old stereo/decay-7 tail
  // (the removed tail is all below −66 dB — see docs/audio-cpu-plan.md), so
  // both are on by default. `?monoverb=0` / `?reverbdecay=7` restore the old
  // stereo path for comparison.
  const reverbDecay = opts.reverbDecay ?? REVERB_DECAY_DEFAULT;
  const reverb =
    (opts.monoReverb ?? true)
      ? buildMonoReverb(reverbDecay, REVERB_PREDELAY)
      : new Tone.Reverb({ decay: reverbDecay, preDelay: REVERB_PREDELAY, wet: 1 });
  reverb.connect(warmth);

  // ── keys (chord voicings + sparse melody) ────────────────────────
  // Keys keep the chorus + evoFilter coloring from the prototype.
  // Evo filter frequency is driven by engine `ParamEvent`s (Stage 5).
  const evoFilter = new Tone.Filter({ type: 'lowpass', frequency: 1800, rolloff: -24 });
  const chorus = new Tone.Chorus({ frequency: 0.4, delayTime: 3.5, depth: 0.3, wet: 0.35 }).start();
  const keysPan = new Tone.Panner(-0.15);
  const keysSend = new Tone.Gain(0.45);
  // Chord-echo send: feedback delay tapping post-evoFilter so echoes
  // carry the same colour as the dry signal. Output feeds into the
  // shared reverb bus — echoes share the room with the dry hit (the
  // standard dub / lofi convention). Delay time is BPM-locked via a
  // one-shot `fx.chordEcho.time` ParamEvent the engine emits at t=0
  // (`60 / bpm` seconds = one quarter note). 30% feedback gives ~3
  // audible repeats before the tail fades; 0.18 send gain keeps the
  // echo gentle (clearly heard but not dominating). Both chord and
  // melody hits get the tail because they share the keys synth —
  // that's lofi-correct (melody echoes are a genre staple) and
  // avoids splitting the synth before counter-melody lands.
  const chordEcho = new Tone.FeedbackDelay({
    delayTime: 60 / 74, // placeholder; engine overrides with BPM-correct value
    feedback: 0.3,
    wet: 1,
  }).connect(reverb);
  const chordEchoSend = new Tone.Gain(0.2);
  chordEchoSend.connect(chordEcho);
  chorus.connect(evoFilter);
  // Vintage-sampler keys treatment (design + iteration history:
  // docs/sampler-character.md). Code-local constraints: it must sit
  // *upstream* of every keys tap (dry, reverb send, chord-echo send) so the
  // sends carry the crushed signal, but *downstream* of evoFilter — the
  // character is imaging around the reduced rate (~8 kHz at defaults), which
  // an LP 1800 before the taps would erase (the failure mode of the original
  // pre-evoFilter quantizer). Knob values are validated here — a malformed
  // flag must fall back to defaults, never break or silence the keys. The
  // worklet loads async; crushIn→crushOut passes audio through until then
  // (and permanently if worklets are unavailable).
  if (opts.keysCrush) {
    const rawDrive = opts.keysCrushDrive ?? KEYS_CRUSH_DRIVE_DEFAULT;
    const rawBits = opts.keysCrushBits ?? KEYS_CRUSH_BITS_DEFAULT;
    const rawRate = opts.keysCrushRate ?? KEYS_CRUSH_RATE_DEFAULT;
    const crushIn = new Tone.Gain(1);
    const crushOut = new Tone.Gain(1);
    evoFilter.connect(crushIn);
    crushIn.connect(crushOut);
    crushOut.connect(keysPan);
    crushOut.connect(chordEchoSend);
    void installSamplerCrush(crushIn, crushOut, {
      factor: Number.isFinite(rawRate)
        ? Math.min(Math.max(Math.round(rawRate), 1), 8)
        : KEYS_CRUSH_RATE_DEFAULT,
      bits: Number.isFinite(rawBits) ? Math.min(Math.max(rawBits, 1), 16) : KEYS_CRUSH_BITS_DEFAULT,
      drive: Number.isFinite(rawDrive) && rawDrive > 0 ? rawDrive : KEYS_CRUSH_DRIVE_DEFAULT,
    });
  } else {
    evoFilter.connect(keysPan);
    evoFilter.connect(chordEchoSend);
  }
  keysPan.connect(warmth);
  keysPan.connect(keysSend);
  keysSend.connect(reverb);
  // Release tuned for the chord-comping scheduler. The prototype's
  // 2.6 s caused successive comping hits to ring on top of each
  // other (sustained-drone reading); 0.5 s read as "chopped." 0.8 s
  // is the middle ground — hits decay smoothly without piling up
  // into the next bar's beat 1 at lofi tempos (74 BPM bar ≈ 3.25 s,
  // so a 0.8 s release leaves > 2 s of clear space).
  //
  // Chord + melody share the same FM Rhodes patch shape but with
  // different envelope sustain levels: chord sustains at 0.55 so the
  // pattern menu's pure-hold / hold-with-refresh modes actually ring
  // audibly during the multi-second sustain phase; melody sustains
  // at 0.28 to keep single-note phrases percussive and forward.
  // Both are split into two PolySynths so the mix can sit melody
  // forward (-9 dB) and chord behind (-13 dB) — a 4 dB gap that
  // reads as "melody leads, chord supports" without forcing extreme
  // separation. Both feed the same chorus → evoFilter → pan →
  // reverb-send path so the colour stays consistent. A future
  // "Timbre swaps + counter-melody" stage is where the melody patch
  // may diverge from the chord patch.
  const keysSharedShape = {
    harmonicity: 3,
    modulationIndex: 7,
    oscillator: { type: 'sine' as const },
    modulation: { type: 'triangle' as const },
    modulationEnvelope: { attack: 0.02, decay: 0.4, sustain: 0.1, release: 0.6 },
  };
  // maxPolyphony caps voices to measured need + ~50% margin. Tone defaults to
  // 32, and a voice's oscillators keep running once started (the envelope only
  // gates amplitude), so idle-but-running voices inflate the always-on floor.
  // Phase-0 profiling (scripts/profile-chain.ts) measured the per-synth max
  // concurrent voices across dense seeds; the caps below are measured-max +
  // 50% safety (floor 8). No audible change while the cap ≥ real simultaneous
  // voices. See docs/audio-cpu-plan.md Task 1. maxPolyphony lives on the
  // PolySynth options object, so these use the `{ voice, options }` form.
  const keysChord = new Tone.PolySynth({
    maxPolyphony: 18, // measured max 12 chord voices + 50%
    voice: Tone.FMSynth,
    options: {
      ...keysSharedShape,
      // Sustain raised 0.28 → 0.55 (2026-06-17) so hold-with-refresh and
      // pure-hold patterns' multi-second sustained ring is actually
      // audible. With sustain 0.28, sustained held chords sat at ~0.15
      // amplitude — quieter than the soft refresh taps that punctuated
      // them, producing a "discrete attacks over near-silence" feel
      // (i.e. choppy) instead of "ringing chord with subtle taps."
      envelope: { attack: 0.03, decay: 0.7, sustain: 0.55, release: 0.8 },
      volume: -15,
    },
  }).connect(chorus);
  const keysMelody = new Tone.PolySynth({
    maxPolyphony: 8, // measured max 4 melody voices; floor of 8
    voice: Tone.FMSynth,
    options: {
      ...keysSharedShape,
      envelope: { attack: 0.03, decay: 0.7, sustain: 0.28, release: 0.8 },
      volume: -8,
    },
  }).connect(chorus);

  // ── soft pad (the "blanket") ─────────────────────────────────────
  // Pad goes wide via StereoWidener and is the wettest element.
  const padWidener = new Tone.StereoWidener(0.8);
  const padSend = new Tone.Gain(0.6);
  padWidener.connect(warmth);
  padWidener.connect(padSend);
  padSend.connect(reverb);
  const pad = new Tone.PolySynth({
    // Pad has the longest release (4 s, below) so its voices overlap most, but
    // Phase-0 measured only 4 concurrent pad voices across dense seeds (the
    // engine voices pads sparsely). Floor of 8 doubles that for safety. See
    // docs/audio-cpu-plan.md Task 1.
    maxPolyphony: 8,
    voice: Tone.AMSynth,
    options: {
      harmonicity: 2,
      oscillator: { type: 'triangle' },
      envelope: { attack: 1.4, decay: 0.6, sustain: 0.8, release: 4 },
      volume: -20,
    },
  }).connect(padWidener);

  // ── bass voice (separate from pad's low end) ─────────────────────
  // Sine bass with quick attack, low sustain, fast release — keeps the
  // bass tight and percussive, avoiding sympathetic resonance from
  // sustained low-end content (the "phone on table" effect). Stays
  // center-panned and fully dry (no reverb send) — that's the lofi
  // bass aesthetic (think MF Doom's basslines, not a synth pad).
  const bassPan = new Tone.Panner(0).connect(warmth);
  const bassFilter = new Tone.Filter({ type: 'lowpass', frequency: 800 }).connect(bassPan);
  const bass = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.28 },
    volume: -15,
  }).connect(bassFilter);

  // ── drums: per-voice pan + per-voice reverb send ─────────────────
  // Shared drumBus lowpass preserves the listen-distance cutoff drift
  // (Stage 7b). Each voice pans individually before the bus so the kit
  // has stereo width without breaking the shared filter modulation.
  const drumBus = new Tone.Filter({ type: 'lowpass', frequency: 4200, rolloff: -12 }).connect(
    warmth,
  );
  // Kick: center, dry.
  const kickPan = new Tone.Panner(0).connect(drumBus);
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
    volume: -9,
  }).connect(kickPan);
  // Snare: slight right, medium reverb send.
  const snarePan = new Tone.Panner(0.15);
  const snareSend = new Tone.Gain(0.3);
  snarePan.connect(drumBus);
  snarePan.connect(snareSend);
  snareSend.connect(reverb);
  const snare = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
    volume: -20,
  }).connect(snarePan);
  // Hat: further right, tiny reverb send (just to glue it into the space).
  const hatPan = new Tone.Panner(0.4);
  const hatSend = new Tone.Gain(0.08);
  hatPan.connect(drumBus);
  hatPan.connect(hatSend);
  hatSend.connect(reverb);
  const hatFx = new Tone.Filter({ type: 'highpass', frequency: 7000 }).connect(hatPan);
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
    volume: -28,
  }).connect(hatFx);

  // ── texture beds ─────────────────────────────────────────────────
  // Texture beds bypass the warmth filter and route straight to the master,
  // so the warmth slider only muffles musical content. Otherwise (as in the
  // prototype) "warmth = dark" silently attenuates rain/crackle too, which
  // reads as a UX bug.

  // Always-on brown noise blanket — widened to fill the stereo field
  // (mono brown noise dead-center would feel narrower than the rest of
  // the kit now that everything else pans).
  const brownBed = new Tone.Noise('brown').start();
  const brownBedFilter = new Tone.Filter({ type: 'lowpass', frequency: 480 });
  const brownBedVol = new Tone.Volume(-30);
  // monoBed (Task 5) drops the always-on StereoWidener's mid/side math for a
  // small saving, at the cost of a slightly narrower bed. On by default (it was
  // a bigger always-on cost than expected — ~5% of total DSP — and the width
  // change is imperceptible); `?monobed=0` re-widens.
  if (opts.monoBed ?? true) {
    brownBed.chain(brownBedFilter, brownBedVol, adapter.master);
  } else {
    const brownBedWidener = new Tone.StereoWidener(0.9);
    brownBed.chain(brownBedFilter, brownBedWidener, brownBedVol, adapter.master);
  }

  // Toggleable rain (starts silent). Two parallel bandpasses on pink noise:
  // a low/mid "wash" (~1.8 kHz, broad) and a high "sparkle" (~4.5 kHz,
  // narrower). No LFO — any periodic modulation reads as a voiced sweep,
  // which is exactly what rain isn't. Stochasticity comes from the noise
  // itself. True per-droplet synthesis is Stage 5+ scope.
  const rain = new Tone.Noise('pink').start();
  const rainLow = new Tone.Filter({ type: 'bandpass', frequency: 1800, Q: 0.8 });
  const rainHigh = new Tone.Filter({ type: 'bandpass', frequency: 4500, Q: 1.5 });
  const rainSum = new Tone.Gain(0.8);
  rain.connect(rainLow);
  rain.connect(rainHigh);
  rainLow.connect(rainSum);
  rainHigh.connect(rainSum);
  const rainVol = new Tone.Volume(-Number.POSITIVE_INFINITY);
  rainSum.chain(rainVol, adapter.master);

  // Toggleable vinyl crackle (engine-driven via Channels.BELL for now).
  // Deliberately louder than the prototype's -20 dB bus + 3.5 kHz highpass,
  // which A/B-tested as effectively inaudible. -6 dB bus + 2 kHz highpass
  // sits in the "noticeable on, clearly off, doesn't kill the hat" zone.
  const crackleVol = new Tone.Volume(-6).connect(adapter.master);
  const crackleFilter = new Tone.Filter({ type: 'highpass', frequency: 2000 }).connect(crackleVol);
  const crackle = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.012, sustain: 0 },
    volume: -4,
  }).connect(crackleFilter);

  // ── register channels (engine-emitted note dispatch) ─────────────
  adapter.registerChannel(Channels.RHODES_CHORD, {
    trigger: (event, audioTime) => {
      const freq = Tone.Frequency(event.pitch, 'midi').toFrequency();
      keysChord.triggerAttackRelease(freq, event.durationMs / 1000, audioTime, event.velocity);
    },
    releaseAll: () => keysChord.releaseAll(),
  });
  adapter.registerChannel(Channels.RHODES_MELODY, {
    trigger: (event, audioTime) => {
      const freq = Tone.Frequency(event.pitch, 'midi').toFrequency();
      keysMelody.triggerAttackRelease(freq, event.durationMs / 1000, audioTime, event.velocity);
    },
    releaseAll: () => keysMelody.releaseAll(),
  });

  adapter.registerChannel(Channels.PAD, {
    trigger: (event, audioTime) => {
      const freq = Tone.Frequency(event.pitch, 'midi').toFrequency();
      pad.triggerAttackRelease(freq, event.durationMs / 1000, audioTime, event.velocity);
    },
    releaseAll: () => pad.releaseAll(),
  });

  adapter.registerChannel(Channels.BASS, {
    trigger: (event, audioTime) => {
      const freq = Tone.Frequency(event.pitch, 'midi').toFrequency();
      bass.triggerAttackRelease(freq, event.durationMs / 1000, audioTime, event.velocity);
    },
    releaseAll: () => bass.triggerRelease(),
  });

  adapter.registerChannel(Channels.KICK, {
    trigger: (event, audioTime) => {
      // Membrane kick uses a base pitch; engine sends the velocity that matters.
      kick.triggerAttackRelease('C1', '8n', audioTime, event.velocity);
    },
  });

  adapter.registerChannel(Channels.SNARE, {
    trigger: (event, audioTime) => {
      snare.triggerAttackRelease('16n', audioTime, event.velocity);
    },
  });

  adapter.registerChannel(Channels.HAT, {
    trigger: (event, audioTime) => {
      hat.triggerAttackRelease('32n', audioTime, event.velocity);
    },
  });

  // Repurpose BELL channel for vinyl crackle one-shots. (Real "bell" ornament
  // gets its own channel name when ornaments land in Stage 5.)
  adapter.registerChannel(Channels.BELL, {
    trigger: (event, audioTime) => {
      crackle.triggerAttackRelease('64n', audioTime, event.velocity);
    },
  });

  // ── register UI / engine-controllable params ─────────────────────
  // Wrap Tone Params at the boundary so the adapter stays Tone-agnostic.
  adapter.registerParam('master.warmth', {
    set: (v) => {
      warmth.frequency.value = v;
    },
    ramp: (v, t, startTime) => {
      warmth.frequency.rampTo(v, t, startTime);
    },
  });
  // master.volume is in dB now (master is a Tone.Volume). UI should send
  // values via `volToDb`, not `volToGain`.
  adapter.registerParam('master.volume', {
    set: (v) => {
      adapter.master.volume.value = v;
    },
    ramp: (v, t, startTime) => {
      adapter.master.volume.rampTo(v, t, startTime);
    },
  });
  // Rain source gating (docs/audio-cpu-plan.md Task 2). The pink-noise buffer
  // is ~free, but the two always-on bandpass biquads + gain aren't — and rain
  // defaults off, so most sessions pay for them for nothing. When the target
  // level settles at/below the silent floor we `stop()` the source (after any
  // fade completes, so there's no abrupt cut); when it rises back above we
  // restart it before ramping up. Tone.Noise recreates its internal
  // BufferSource on each `start()` (verified in tone@14.9.17 Noise._start), so
  // stop→start resumes cleanly with no click.
  const RAIN_OFF_THRESHOLD_DB = -110;
  let rainPlaying = true; // constructed with .start()
  let rainStopTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelPendingStop = (): void => {
    if (rainStopTimer !== null) {
      clearTimeout(rainStopTimer);
      rainStopTimer = null;
    }
  };
  const ensureRainPlaying = (): void => {
    cancelPendingStop();
    if (!rainPlaying) {
      rain.start();
      rainPlaying = true;
    }
  };
  const stopRain = (): void => {
    if (rainPlaying) {
      rain.stop();
      rainPlaying = false;
    }
  };
  adapter.registerParam('bed.rain.level', {
    set: (v) => {
      rainVol.volume.value = v;
      if (v <= RAIN_OFF_THRESHOLD_DB) stopRain();
      else ensureRainPlaying();
    },
    ramp: (v, t, startTime) => {
      const off = v <= RAIN_OFF_THRESHOLD_DB;
      if (!off) ensureRainPlaying();
      rainVol.volume.rampTo(v, t, startTime);
      if (off) {
        // Stop only after the fade-out has fully elapsed.
        cancelPendingStop();
        rainStopTimer = setTimeout(
          () => {
            rainStopTimer = null;
            stopRain();
          },
          t * 1000 + 50,
        );
      }
    },
  });
  // Engine-driven evo-filter sweep (Stage 5 — replaces the static LFO).
  adapter.registerParam('fx.evoFilter.cutoff', {
    set: (v) => {
      evoFilter.frequency.value = v;
    },
    ramp: (v, t, startTime) => {
      evoFilter.frequency.rampTo(v, t, startTime);
    },
  });

  // Stage 7b: listen-distance fBm — "how you hear it" evolves alongside
  // "what's being played." Two perceptually-distinct axes, each driven
  // by its own slow fBm stream in the engine (independent of the
  // structural position-space substrate).
  //
  // Reverb wet was originally a third channel here but was dropped
  // after a lofi-alignment review: reverb-wet drift is an *ambient*
  // music convention (Eno, Stars of the Lid) — lofi sits at a fixed,
  // intimate, dry-leaning perceptual distance. A drifting wetness
  // would read as "wait, am I in a different room now?" which is the
  // salient transition we don't want. When authentic lofi texture
  // nodes land (wow/flutter, tape hiss, bitcrush — none currently in
  // the chain), those become the right drift targets.
  adapter.registerParam('fx.chorus.depth', {
    set: (v) => {
      chorus.depth = v;
    },
    ramp: (v, _t, _startTime) => {
      // Chorus.depth is a plain number, not a Tone.Param — no ramp API and
      // no way to schedule at a future `startTime`, so this one param glides
      // (and applies) at dispatch rather than time-locked like the rest.
      // The engine's 250 ms emission cadence is slow enough that stepping
      // doesn't audibly zipper at the slow fBm rates Stage 7b uses, and the
      // depth drift is subtle enough that the small lead is imperceptible.
      chorus.depth = v;
    },
  });
  adapter.registerParam('fx.drumBus.cutoff', {
    set: (v) => {
      drumBus.frequency.value = v;
    },
    ramp: (v, t, startTime) => {
      drumBus.frequency.rampTo(v, t, startTime);
    },
  });
  // Chord echo: time is BPM-locked (engine emits one-shot at t=0);
  // feedback and wet are exposed for future fBm drift.
  adapter.registerParam('fx.chordEcho.time', {
    set: (v) => {
      chordEcho.delayTime.value = v;
    },
    ramp: (v, t, startTime) => {
      chordEcho.delayTime.rampTo(v, t, startTime);
    },
  });
  adapter.registerParam('fx.chordEcho.feedback', {
    set: (v) => {
      chordEcho.feedback.value = v;
    },
    ramp: (v, t, startTime) => {
      chordEcho.feedback.rampTo(v, t, startTime);
    },
  });
  adapter.registerParam('fx.chordEcho.wet', {
    set: (v) => {
      chordEchoSend.gain.value = v;
    },
    ramp: (v, t, startTime) => {
      chordEchoSend.gain.rampTo(v, t, startTime);
    },
  });
}

/**
 * Mono drop-in for `Tone.Reverb` (Task 3). `Tone.Reverb` hard-codes a *stereo*
 * IR (independent L/R noise → `OfflineContext(2, …)`), so its ConvolverNode
 * does 2-channel convolution. Feeding a ConvolverNode a **1-channel** IR
 * convolves both input channels with the same response — a centered tail at
 * ~half the cost.
 *
 * The IR is generated exactly like Tone's `Reverb.generate()` (white noise
 * through a gain envelope: silent until `preDelay`, then an exponential
 * approach to 0 over `decay`) but in a mono `OfflineContext`, and normalize is
 * left at the ConvolverNode default (true) to match `Tone.Reverb`'s level. The
 * IR render is async, so — like `Tone.Reverb` — the convolver is silent for the
 * few ms until it resolves; the returned node can be wired immediately.
 *
 * Returned as a bare `Tone.Convolver` (no wet/dry mix), which is equivalent to
 * `Tone.Reverb({ wet: 1 })`: a 100%-wet send/return.
 */
function buildMonoReverb(decay: number, preDelay: number): Tone.Convolver {
  const conv = new Tone.Convolver({ normalize: true });
  void generateMonoIR(decay, preDelay).then((buffer) => {
    conv.buffer = buffer;
  });
  return conv;
}

function generateMonoIR(decay: number, preDelay: number): Promise<Tone.ToneAudioBuffer> {
  const context = new Tone.OfflineContext(1, decay + preDelay, Tone.getContext().sampleRate);
  const noise = new Tone.Noise({ context }).start(0);
  const gainNode = new Tone.Gain({ context }).toDestination();
  noise.connect(gainNode);
  // Mirror Tone.Reverb.generate(): predelay gate, then exponential decay.
  gainNode.gain.setValueAtTime(0, 0);
  gainNode.gain.setValueAtTime(1, preDelay);
  gainNode.gain.exponentialApproachValueAtTime(0, preDelay, decay);
  return context.render();
}

/** Map a 0..1 warmth slider to a low-pass cutoff in Hz.
 * Floor (350 Hz) combined with the -24 dB/oct rolloff on the master warmth
 * filter clearly muffles the signal at the dark end (behind-glass) without
 * killing audibility; ceiling (14 kHz) is past the point of diminishing
 * perceptual return so the useful range spans the full slider travel. */
export function warmHz(v: number): number {
  return 350 * (14000 / 350) ** v;
}

/** Map a 0..1 volume slider to dB, treating ≤0.001 as silence. */
export function volToDb(v: number): number {
  return v <= 0.001 ? -Number.POSITIVE_INFINITY : Math.log10(v) * 26;
}

/** Map a 0..1 volume slider to linear gain (for `adapter.master.gain`). */
export function volToGain(v: number): number {
  return v * v; // squared curve, perceptually flatter than linear
}
