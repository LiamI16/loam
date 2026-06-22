# Dynamics — implementation notes

> Companion to `docs/dynamics-brainstorm.md` (which is the *strategy* —
> what generators exist, why we layer them by timescale, the attractor
> idea). This doc is the *implementation* — what's actually built, what
> patterns we follow, which sub-system is in which file.
>
> Grows with each Phase-2 stage. Stage 5 lays down the foundation.

---

## 1. The two primitives

Both live in `@loam/core`.

### `ValueNoise1D` (`packages/core/src/noise/value-noise.ts`)

Deterministic 1D value noise. Smooth Hermite interpolation between
hash-derived gradient values at integer positions.

Key property: **no period.** Each integer's gradient is freshly hashed
from the seed via `splitmix64(seedHash XOR x)`. Unlike a precomputed
gradient table (which repeats every N positions), this produces unique
values for any absolute `x`, regardless of session length.

Output: ~`[-1, 1]`, continuous in `x`.

### `Fbm1D` (`packages/core/src/noise/fbm.ts`)

Fractional Brownian motion — sum of N `ValueNoise1D` octaves at
exponentially increasing frequencies and exponentially decreasing
amplitudes. Approximates a 1/f spectrum (per
`dynamics-brainstorm.md` §1.4).

Defaults: 4 octaves, persistence 0.5, lacunarity 2.0. Output
**normalized** — the sum of amplitudes is divided out so the range stays
in ~`[-1, 1]` regardless of how many octaves stack.

## 2. The `ParamStream` pattern

The interface engine sub-schedulers use to read time-varying values
(`packages/core/src/params/param-stream.ts`):

```ts
interface ParamStream {
  evaluate(time: number): number;  // sample at engine-time (seconds)
}
```

Two implementations:

- **`StaticParam`** — constant. Used for params that don't move yet
  (e.g. evo-cutoff default of 1800 Hz when not wired through fBm).
  Mutable `.value` field.
- **`FbmParam`** — fBm motion around a mutable `mean`. Constant `depth`
  and `baseFreq`, both seed-derived (see §4). Optional `[minValue,
  maxValue]` clamp.

```ts
new FbmParam(fbm1d, {
  mean: 1800,        // mutable — could be exposed as a UI slider
  depth: 800,        // seed-locked
  baseFreq: 0.02,    // seed-locked
  minValue: 200,     // hard floor
  maxValue: 4000,    // hard ceiling
});
```

The pattern lets streams compose interchangeably — switching a param
from `StaticParam` to `FbmParam` is a one-line change at the engine
construction site, and consumers don't change. Sub-schedulers also
build their own `FbmParam` streams (`MelodyScheduler`'s
`activityStream` and `couplingStream`, `ChordScheduler`'s
`activityStream` and `slotBiasStream`) without going through
`EngineState`.

## 3. Time-and-space contract for fBm sampling

Sub-schedulers evaluate streams at the **engine-time of the decision**,
not at constant intervals. Example from `MelodyScheduler` (the F1
min-cap coupling at each fragment-start opportunity):

```ts
while (this.nextQuarter * this.secondsPerBeat < to) {
  const time = this.nextQuarter * this.secondsPerBeat;
  const melody = this.activityStream.evaluate(time);
  const chord = this.state.chordActivityStream.evaluate(time);
  const coupling = this.couplingStream.evaluate(time);
  const effective = (1 - coupling) * melody + coupling * Math.min(melody, 1 - chord);
  if (this.rng.nextFloat() < effective) { ... }
  this.nextQuarter++;
}
```

This matters because: the adapter's pump cadence varies (whatever the
event loop gives us), but engine decisions must be reproducible from the
seed alone. Sampling streams at *event* time decouples reproducibility
from pump scheduling.

## 4. Per-seed liveliness fingerprint (Stage-5 decision)

Decided 2026-06-16. fBm `depth` and `baseFreq` are **not user-facing**.
Each fBm-driven param draws its two parameters from a dedicated
`seed.child('<param>-fbm-config').rng()` at engine construction.

Representative ranges (see the respective scheduler files for the
authoritative numbers — this table is illustrative, not exhaustive):

| Param | Owner | Depth range | Base-freq range (Hz) |
|---|---|---|---|
| `evoCutoffStream` | engine | 600 – 1400 Hz | 0.015 – 0.04 |
| `chordActivityStream` | `ChordScheduler` | 0.15 – 0.35 | 1 / 90 |
| `slotBiasStream` | `ChordScheduler` | 0.10 – 0.25 | 1 / 120 |
| `melodyActivityStream` | `MelodyScheduler` | 0.15 – 0.35 | 1 / 90 |
| `couplingStream` | `MelodyScheduler` | 0.05 – 0.12 | 1 / 240 |
| `chorusDepthStream` | engine | 0.06 – 0.10 | 0.005 – 0.012 |
| `drumBusCutoffStream` | engine | 600 – 1100 Hz | 0.005 – 0.012 |

**Why seed-driven, not slider-controlled** (see also
`docs/dynamics-brainstorm.md` §6 and Stage 5 q&a):

1. Reinforces the Minecraft-style "seed *is* the world" identity.
2. Free dimension of variation orthogonal to chord/melody choice.
3. No "I broke it" state — every seed produces an in-range, vetted
   trajectory.
4. Adding the knob later (for power users) is opt-in expansion;
   removing it later would break every saved configuration.

The seed-as-identity principle has hardened over time. Stage 6.5
removed the BPM slider for this reason; the 2026-06-22 cleanup
removed the legacy `density` slider for the same reason (every
per-seed parameter — including melody firing rate — is now derived
from the seed; user knobs are restricted to playback-level controls).

## 5. Engine → adapter: continuous-parameter flow

Stage 5 is the first real use of `ParamEvent` from
`docs/event-protocol.md`. Two configurable knobs:

- **`PARAM_TICK_SEC = 0.25`** (4 Hz emission cadence). Sub-audio-rate but
  fast enough to never feel staircased.
- **Each emitted `ParamEvent` carries `rampMs = PARAM_TICK_SEC * 1000`.**
  The adapter linearly ramps between consecutive samples, smoothing the
  discrete-to-continuous boundary.

Stage 5 wires exactly one target this way: `fx.evoFilter.cutoff`. The
chain registered the corresponding `ParamSetter` in
`packages/synth-tone/src/chains/lofi.ts`; the static `Tone.LFO` that
previously swept the same node was removed.

## 6. Tuning record

These numbers come from listening tests, not first principles. Tweak
when warranted, but think hard before doing so — every change to the
ranges shifts every seed's character.

- `evoCutoffStream` depth was originally 200–600 Hz. Bumped to 600–1400
  after user feedback that motion was "really hard to tell." The
  prototype's static LFO swept ±750 Hz, so the new high end exceeds it.
- `PARAM_TICK_SEC = 0.25` chosen so the rate is comfortably below the
  ramp's own time constant (giving smooth interpolation between samples)
  and well above the fBm's slowest motion (~0.005 Hz base freq → 200 s
  cycle → 800 samples per cycle, plenty).
- Melody activity mean was 0.35 (inherited from chord-activity defaults)
  briefly during the melody rewrite; pulled to 0.22 once it became
  clear that *fragment* emissions emit 3–5 notes per fire, not 1, so
  the inherited rate produced ~5× the per-rewrite note density. See
  `docs/seed-format.md` §7.3a for the full retune log.

## 7. Multi-layered determinism contracts

Stage 5 adds two new locked-sequence tests on top of the original PRNG
contract:

- `Rng.next()` (Stage 2) — 8 known uint32s for `Seed.from(42n)`
- `ValueNoise1D.sample()` (Stage 5) — 8 known floats for
  `Seed.from(42n)` at fixed positions
- `Fbm1D.sample()` (Stage 5) — 6 known floats summing 4 octaves
- `EmberEngine` fingerprint (Stage 4 + updated count Stage 5) — 6
  known events at `t=0` plus total event count over 5 s

Each locks a different layer of the noise stack. Breaking one signals a
specific layer regression. Breaking the engine fingerprint can be
either a layer regression *or* a deliberate composition change (e.g.,
new sub-scheduler) — context tells you which. Treat any change to the
PRNG, ValueNoise1D, or Fbm1D fingerprints as a v2 seed-format break.

## 8. What's landed since Stage 5

The dynamics foundation has been built on heavily — most of what the
original Stage-5 doc deferred is now done. Tracking what's *still*
outstanding (see `stage-list.md` for the active backlog):

- **Markov chord transitions** — done (Stage 6, then Markov-walk
  rework for pattern selection).
- **Voice-leading solver** — done (Stage 6, `harmony/voicing.ts`).
- **Position-driven macro mood** — done (`PositionStream`, Stage 7a).
  Slow 2D fBm-driven walk through the seed's parameter landscape;
  consumed by chord-mode blending and voicing register drift.
- **Ornament process** — only vinyl crackle currently uses
  `Channels.BELL` / the point-process model from `docs/ornaments.md`.
  Other ornament surfaces (bell tones, sustained 9ths) still deferred.
- **Melody rewrite** — done (Phases 1–3, 2026-06-21/22). Replaces the
  pentatonic-Bernoulli model with a germ-driven scheduler: F1 min-cap
  chord coupling, 10 templates, 4-way emission rule, six
  transformations + retrograde gating, compound 2-chain, per-seed
  swing, per-emission jitter. Documented in `docs/melody.md`.
- **CA drum drift** — still deferred. Drum grid is fixed boom-bap
  with humanization (per-voice offsets, velocity accents, mild 16n
  swing).
- **Engine-driven warmth / master volume** — punted (UI conflict with
  user sliders, deferrable).
- **Python validation harness for 1/f spectrum check** — punted, not
  urgent for two-knob dynamics.
