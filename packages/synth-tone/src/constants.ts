/**
 * Shared numeric constants for the `@loam/synth-tone` adapter that cross a
 * module or package boundary. Per CLAUDE.md "abstract shared values": a value
 * used in more than one place lives here once, never restated. Single-use
 * tuning values (dB levels, cutoffs) stay local to their chain node.
 */

/**
 * Global audio-context render rate (the CPU lever — docs/audio-cpu-plan.md).
 * 32 kHz is a ~21% whole-graph DSP cut that's transparent for lofi (16 kHz
 * Nyquist). Consumed by the web demo (adapter construction) and the offline
 * analysis harness — hence it lives here rather than in either consumer.
 */
export const DEFAULT_SAMPLE_RATE = 32000;

/**
 * Sample rates the web demo will accept from the `?samplerate=` flag. An
 * **allowlist, not a range** — a range check let a typo'd `samplerate=20050`
 * through and silently voided ear-test sessions for days (see the flag-log
 * rationale in the web demo).
 */
export const SAMPLE_RATE_ALLOWLIST: readonly number[] = [22050, 32000, 44100, 48000];

/**
 * Below this rain target level (dB) the chain stops the pink-noise source and
 * its idle bandpass biquads (docs/audio-cpu-plan.md Task 2). Owned here so the
 * web demo's "off" level derives from it instead of restating the number.
 */
export const RAIN_OFF_THRESHOLD_DB = -110;

/**
 * Rain "off" target the web demo ramps to: finite (−∞ would break `rampTo`)
 * but safely below the source-gate threshold so the source actually stops.
 */
export const RAIN_SILENT_DB = RAIN_OFF_THRESHOLD_DB - 10;
