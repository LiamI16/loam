import { Channels } from '@loam/core';
import * as Tone from 'tone';
import type { ToneAudioAdapter } from '../adapter.js';

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
export function buildLofiChain(adapter: ToneAudioAdapter): void {
  // ── master & shared reverb return ───────────────────────────────
  const warmth = new Tone.Filter({
    type: 'lowpass',
    frequency: warmHz(0.55),
    rolloff: -12,
  }).connect(adapter.master);
  // Shared reverb bus. wet=1 because reverb is now a send/return:
  // dry signal travels its own path; each instrument's `*Send` gain
  // controls how much of it is fed to the reverb input. The reverb
  // output is 100% wet and gets summed back into warmth.
  const reverb = new Tone.Reverb({ decay: 7, preDelay: 0.02, wet: 1 }).connect(warmth);

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
  const chordEchoSend = new Tone.Gain(0.20);
  chordEchoSend.connect(chordEcho);
  chorus.connect(evoFilter);
  evoFilter.connect(keysPan);
  evoFilter.connect(chordEchoSend);
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
  const keysChord = new Tone.PolySynth(Tone.FMSynth, {
    ...keysSharedShape,
    // Sustain raised 0.28 → 0.55 (2026-06-17) so hold-with-refresh and
    // pure-hold patterns' multi-second sustained ring is actually
    // audible. With sustain 0.28, sustained held chords sat at ~0.15
    // amplitude — quieter than the soft refresh taps that punctuated
    // them, producing a "discrete attacks over near-silence" feel
    // (i.e. choppy) instead of "ringing chord with subtle taps."
    envelope: { attack: 0.03, decay: 0.7, sustain: 0.55, release: 0.8 },
    volume: -13,
  }).connect(chorus);
  const keysMelody = new Tone.PolySynth(Tone.FMSynth, {
    ...keysSharedShape,
    envelope: { attack: 0.03, decay: 0.7, sustain: 0.28, release: 0.8 },
    volume: -9,
  }).connect(chorus);

  // ── soft pad (the "blanket") ─────────────────────────────────────
  // Pad goes wide via StereoWidener and is the wettest element.
  const padWidener = new Tone.StereoWidener(0.8);
  const padSend = new Tone.Gain(0.6);
  padWidener.connect(warmth);
  padWidener.connect(padSend);
  padSend.connect(reverb);
  const pad = new Tone.PolySynth(Tone.AMSynth, {
    harmonicity: 2,
    oscillator: { type: 'triangle' },
    envelope: { attack: 1.4, decay: 0.6, sustain: 0.8, release: 4 },
    volume: -20,
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
  const brownBedWidener = new Tone.StereoWidener(0.9);
  const brownBedVol = new Tone.Volume(-30);
  brownBed.chain(brownBedFilter, brownBedWidener, brownBedVol, adapter.master);

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
    ramp: (v, _t) => {
      // Chorus.depth is a plain number, not a Tone.Param — no ramp API.
      // The engine's 250 ms emission cadence is slow enough that stepping
      // doesn't audibly zipper at the slow fBm rates Stage 7b uses.
      chorus.depth = v;
    },
  });
  adapter.registerParam('fx.drumBus.cutoff', {
    set: (v) => {
      drumBus.frequency.value = v;
    },
    ramp: (v, t) => {
      drumBus.frequency.rampTo(v, t);
    },
  });
  // Chord echo: time is BPM-locked (engine emits one-shot at t=0);
  // feedback and wet are exposed for future fBm drift.
  adapter.registerParam('fx.chordEcho.time', {
    set: (v) => {
      chordEcho.delayTime.value = v;
    },
    ramp: (v, t) => {
      chordEcho.delayTime.rampTo(v, t);
    },
  });
  adapter.registerParam('fx.chordEcho.feedback', {
    set: (v) => {
      chordEcho.feedback.value = v;
    },
    ramp: (v, t) => {
      chordEcho.feedback.rampTo(v, t);
    },
  });
  adapter.registerParam('fx.chordEcho.wet', {
    set: (v) => {
      chordEchoSend.gain.value = v;
    },
    ramp: (v, t) => {
      chordEchoSend.gain.rampTo(v, t);
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
