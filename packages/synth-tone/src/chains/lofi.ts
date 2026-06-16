import { Channels } from '@loam/core';
import * as Tone from 'tone';
import type { ToneAudioAdapter } from '../adapter.js';

/**
 * Builds the v1 lo-fi signal chain — a near-verbatim port of
 * `ember-generative-study.html`. Registers channels and parameter targets
 * with the adapter; consumers don't need to know what's inside.
 *
 * Connections (left to right, sound flows left → right):
 *
 *   keys (FM Rhodes) ─┐
 *   pad  (AM)         ├─► chorus ─► evoFilter ─► reverb ─► warmth ─► master
 *   drum bus ────────────────────────────────────► (lowpass 4200) ─►┘
 *   brown bed ─────────────────────────────────────────────────────►┘
 *   rain bandpass ────────────────────────────────────────────────► (level 0)
 *   vinyl crackle ────────────────────────────────────────────────►┘
 *
 * Exposed parameter targets (UI sliders / engine `ParamEvent`s):
 *   - `master.warmth`    — warmth filter cutoff (Hz)
 *   - `master.volume`    — adapter master gain (linear)
 *   - `bed.rain.level`   — rain bed volume (dB)
 */
export function buildLofiChain(adapter: ToneAudioAdapter): void {
  // ── master & glue ────────────────────────────────────────────────
  const warmth = new Tone.Filter({
    type: 'lowpass',
    frequency: warmHz(0.55),
    rolloff: -12,
  }).connect(adapter.master);
  const reverb = new Tone.Reverb({ decay: 7, preDelay: 0.02, wet: 0.34 }).connect(warmth);
  // Evo filter — its frequency is now driven by `ParamEvent`s from the
  // engine (Stage 5 fBm dynamics). The static `Tone.LFO` the prototype
  // used has been removed; the engine emits ramped cutoff updates ~4 Hz
  // instead, giving fractal motion rather than an obvious sine sweep.
  const evoFilter = new Tone.Filter({ type: 'lowpass', frequency: 1800, rolloff: -24 }).connect(
    reverb,
  );
  const chorus = new Tone.Chorus({ frequency: 0.4, delayTime: 3.5, depth: 0.3, wet: 0.35 })
    .start()
    .connect(evoFilter);

  // ── keys (chord voicings + sparse melody) ────────────────────────
  const keys = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3,
    modulationIndex: 7,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.03, decay: 0.7, sustain: 0.28, release: 2.6 },
    modulation: { type: 'triangle' },
    modulationEnvelope: { attack: 0.02, decay: 0.4, sustain: 0.1, release: 1.2 },
    volume: -11,
  }).connect(chorus);

  // ── soft pad (the "blanket") ─────────────────────────────────────
  const pad = new Tone.PolySynth(Tone.AMSynth, {
    harmonicity: 2,
    oscillator: { type: 'triangle' },
    envelope: { attack: 1.4, decay: 0.6, sustain: 0.8, release: 4 },
    volume: -20,
  }).connect(chorus);

  // ── drums: soft, muffled, mostly dry ─────────────────────────────
  const drumBus = new Tone.Filter({ type: 'lowpass', frequency: 4200, rolloff: -12 }).connect(
    warmth,
  );
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
    volume: -7,
  }).connect(drumBus);
  const snare = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
    volume: -15,
  }).connect(drumBus);
  const hatFx = new Tone.Filter({ type: 'highpass', frequency: 7000 }).connect(drumBus);
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
    volume: -26,
  }).connect(hatFx);

  // ── texture beds ─────────────────────────────────────────────────
  // Texture beds bypass the warmth filter and route straight to the master,
  // so the warmth slider only muffles musical content. Otherwise (as in the
  // prototype) "warmth = dark" silently attenuates rain/crackle too, which
  // reads as a UX bug.

  // Always-on brown noise blanket
  const brownBed = new Tone.Noise('brown').start();
  const brownBedFilter = new Tone.Filter({ type: 'lowpass', frequency: 480 });
  const brownBedVol = new Tone.Volume(-30);
  brownBed.chain(brownBedFilter, brownBedVol, adapter.master);

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
  adapter.registerChannel(Channels.RHODES, {
    trigger: (event, audioTime) => {
      const freq = Tone.Frequency(event.pitch, 'midi').toFrequency();
      keys.triggerAttackRelease(freq, event.durationMs / 1000, audioTime, event.velocity);
    },
    releaseAll: () => keys.releaseAll(),
  });

  adapter.registerChannel(Channels.PAD, {
    trigger: (event, audioTime) => {
      const freq = Tone.Frequency(event.pitch, 'midi').toFrequency();
      pad.triggerAttackRelease(freq, event.durationMs / 1000, audioTime, event.velocity);
    },
    releaseAll: () => pad.releaseAll(),
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
    ramp: (v, t) => {
      warmth.frequency.rampTo(v, t);
    },
  });
  // master.volume is in dB now (master is a Tone.Volume). UI should send
  // values via `volToDb`, not `volToGain`.
  adapter.registerParam('master.volume', {
    set: (v) => {
      adapter.master.volume.value = v;
    },
    ramp: (v, t) => {
      adapter.master.volume.rampTo(v, t);
    },
  });
  adapter.registerParam('bed.rain.level', {
    set: (v) => {
      rainVol.volume.value = v;
    },
    ramp: (v, t) => {
      rainVol.volume.rampTo(v, t);
    },
  });
  // Engine-driven evo-filter sweep (Stage 5 — replaces the static LFO).
  adapter.registerParam('fx.evoFilter.cutoff', {
    set: (v) => {
      evoFilter.frequency.value = v;
    },
    ramp: (v, t) => {
      evoFilter.frequency.rampTo(v, t);
    },
  });
}

/** Map a 0..1 warmth slider to a low-pass cutoff in Hz. */
export function warmHz(v: number): number {
  return 900 * (14000 / 900) ** v;
}

/** Map a 0..1 volume slider to dB, treating ≤0.001 as silence. */
export function volToDb(v: number): number {
  return v <= 0.001 ? -Number.POSITIVE_INFINITY : Math.log10(v) * 26;
}

/** Map a 0..1 volume slider to linear gain (for `adapter.master.gain`). */
export function volToGain(v: number): number {
  return v * v; // squared curve, perceptually flatter than linear
}
