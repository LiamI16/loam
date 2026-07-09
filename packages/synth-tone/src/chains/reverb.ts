import * as Tone from 'tone';

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
export function buildMonoReverb(decay: number, preDelay: number): Tone.Convolver {
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
