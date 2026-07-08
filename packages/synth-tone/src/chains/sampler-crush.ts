import * as Tone from 'tone';

/**
 * Vintage-sampler keys treatment (docs/sampler-character.md, recipe locked
 * 2026-07-03 after offline A/B): first-order (linear-interpolation) hold at
 * an integer decimation factor + TPDF-dithered quantization. A WaveShaper
 * cannot express this (the hold has memory), so it's a minimal
 * AudioWorklet — deliberately bare, none of `Tone.BitCrusher`'s dry/wet
 * Effect machinery that coloured the signal.
 *
 * Why linear hold, not the "authentic" zero-order hold: ZOH's staircase
 * imaging reads as cricket-like rattle on Loam's clean band-limited keys —
 * sampled records masked that imaging in the classic hardware; pure
 * synthesis doesn't. The linear hold keeps the same image frequencies at a
 * steeper rolloff: same character family, no rattle (ear-tested against
 * ZOH + the hardware-faithful ~10.5 kHz output LP, which still rattled).
 */

/** Standalone processor source, loaded via a Blob URL so no bundler asset
 * config is needed. Keep it dependency-free ES2017 — it runs on the audio
 * thread. */
const PROCESSOR_SRC = `
class SamplerCrushProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.factor = Math.max(1, Math.round(o.factor || 4));
    this.step = 2 ** (1 - (o.bits || 12));
    this.drive = o.drive || 4;
    this.phase = [];
    this.start = [];
    this.target = [];
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    for (let c = 0; c < input.length; c++) {
      const inp = input[c];
      const out = output[c];
      if (!inp || !out) continue;
      let phase = this.phase[c] || 0;
      let start = this.start[c] || 0;
      let target = this.target[c] || 0;
      for (let i = 0; i < inp.length; i++) {
        if (phase === 0) {
          start = target;
          target = inp[i];
        }
        // First-order hold: ramp toward the last captured sample.
        const v = start + ((target - start) * phase) / this.factor;
        // TPDF-dithered quantization at the driven level, inverse after
        // (net-unity; matches the offline recipe, which quantizes the
        // interpolated signal). Dither only when the signal alone would
        // quantize to a nonzero step — otherwise silence stays silent
        // instead of a constant noise floor feeding the reverb/echo sends.
        const scaled = (v * this.drive) / this.step;
        const dithered = Math.abs(scaled) >= 0.5 ? scaled + (Math.random() + Math.random() - 1) : scaled;
        const q = (Math.round(dithered) * this.step) / this.drive;
        out[i] = Math.max(-1, Math.min(1, q));
        phase = (phase + 1) % this.factor;
      }
      this.phase[c] = phase;
      this.start[c] = start;
      this.target[c] = target;
    }
    return true;
  }
}
registerProcessor('sampler-crush', SamplerCrushProcessor);
`;

export interface SamplerCrushConfig {
  /** Integer decimation factor (effective rate = context rate / factor). */
  factor: number;
  /** Quantization bit depth. */
  bits: number;
  /** Linear gain into the quantizer, inverted after (net-unity staging). */
  drive: number;
}

/** One module load per context. Matters for two reasons: chain rebuilds
 * (reseed) must not re-register the processor on the same context (Chrome
 * throws NotSupportedError on duplicate `registerProcessor`), and the blob
 * URL differs per call so URL-level caches never hit. */
const moduleLoads = new WeakMap<BaseAudioContext, Promise<void>>();

function loadModule(raw: BaseAudioContext): Promise<void> {
  let load = moduleLoads.get(raw);
  if (!load) {
    const url = URL.createObjectURL(new Blob([PROCESSOR_SRC], { type: 'application/javascript' }));
    load = raw.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    moduleLoads.set(raw, load);
  }
  return load;
}

/**
 * Splice the sampler-crush worklet between two pass-through gains.
 * `input.connect(output)` must already exist; audio flows uncoloured until
 * the worklet module loads (async), then the pass-through is rerouted. If
 * worklets are unavailable (non-secure context, offline harness), the
 * pass-through simply stays — the chain keeps working, uncrushed.
 *
 * Uses the NATIVE AudioWorklet API on `rawContext`, not Tone's
 * `addAudioWorkletModule`/`createAudioWorkletNode`: the app wraps a native
 * `AudioContext` in `Tone.Context` (the 32 kHz CPU lever — adapter.ts), and
 * Tone's helpers go through standardized-audio-context, whose
 * `AudioWorkletNode` only accepts modules loaded via its own registry —
 * mixing the two throws InvalidStateError (hit 2026-07-04). The native path
 * requires `rawContext` to be a real browser context; anything else (the
 * offline harness's polyfill, s-a-c-managed contexts) lands in the catch
 * and stays bypassed.
 */
export async function installSamplerCrush(
  input: Tone.Gain,
  output: Tone.Gain,
  cfg: SamplerCrushConfig,
): Promise<void> {
  try {
    const raw = Tone.getContext().rawContext as BaseAudioContext;
    if (typeof AudioWorkletNode === 'undefined' || !raw.audioWorklet) {
      throw new Error('AudioWorklet not supported in this environment');
    }
    await loadModule(raw);
    const node = new AudioWorkletNode(raw, 'sampler-crush', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      processorOptions: cfg,
    });
    input.disconnect(output);
    Tone.connect(input, node);
    Tone.connect(node, output);
  } catch (err) {
    console.warn('sampler-crush worklet unavailable — keys crush bypassed', err);
  }
}
