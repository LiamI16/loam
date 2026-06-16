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

Two implementations in Stage 5:

- **`StaticParam`** — constant. Used for params that don't move yet
  (`bpm`, `vinylEnabled` in tests, evo-cutoff default of 1800 Hz when
  not wired through fBm). Mutable `.value` field.
- **`FbmParam`** — fBm motion around a mutable `mean`. Constant `depth`
  and `baseFreq`, both seed-derived (see §4). Optional `[minValue,
  maxValue]` clamp.

```ts
new FbmParam(fbm1d, {
  mean: 0.18,        // mutable — UI sliders update this
  depth: 0.15,       // seed-locked
  baseFreq: 0.012,   // seed-locked
  minValue: 0,       // hard floor
  maxValue: 1,       // hard ceiling
});
```

The pattern lets streams compose interchangeably — switching a param
from `StaticParam` to `FbmParam` is a one-line change at the engine
construction site, and consumers don't change.

## 3. Time-and-space contract for fBm sampling

Sub-schedulers evaluate streams at the **engine-time of the decision**,
not at constant intervals. Example from `MelodyScheduler`:

```ts
while (this.nextQuarter * this.secondsPerQuarter < to) {
  const time = this.nextQuarter * this.secondsPerQuarter;
  const density = this.state.densityStream.evaluate(time);
  if (this.rng.bernoulli(density)) { ... }
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

Current ranges (`packages/core/src/engines/ember/ember.ts`):

| Param | Depth range | Base-freq range (Hz) | Period (s) |
|---|---|---|---|
| `densityStream` | 0.05 – 0.30 | 0.005 – 0.025 | 40 – 200 |
| `evoCutoffStream` | 600 – 1400 Hz | 0.015 – 0.04 | 25 – 65 |

**Why seed-driven, not slider-controlled** (see also
`docs/dynamics-brainstorm.md` §6 and Stage 5 q&a):

1. Reinforces the Minecraft-style "seed *is* the world" identity.
2. Free dimension of variation while progressions are limited to 4.
3. No "I broke it" state — every seed produces an in-range, vetted
   trajectory.
4. Adding the knob later (for power users) is opt-in expansion;
   removing it later would break every saved configuration.

**UI sliders update `mean`**, never the instantaneous value. So a user
sliding density doesn't fight the fBm motion — they shift its
centerpoint while motion continues around it.

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
- `densityStream` depth was originally 0.06–0.22. Bumped to 0.05–0.30 to
  widen the perceived difference between seeds.
- `PARAM_TICK_SEC = 0.25` chosen so the rate is comfortably below the
  ramp's own time constant (giving smooth interpolation between samples)
  and well above the fBm's slowest motion (~0.005 Hz base freq → 200 s
  cycle → 800 samples per cycle, plenty).

## 7. What `setOption('density', 0)` actually does

Stage 4 (when density was static): density goes to 0, melody silenced.

Stage 5 (density is fBm-driven): density's *mean* goes to 0; fBm motion
around the mean can still pull it positive (clamped at the configured
`minValue = 0`). So melody fires *much* less but not zero.

The Stage-5 test asserts the weaker invariant: `melodyCount(mean=0) <
0.3 × melodyCount(mean=1)`. If we ever need hard-mute semantics, add a
separate `melodyEnabled: boolean` engine option (same shape as
`vinylEnabled`) — don't conflate "mean = 0" with "off."

## 8. Multi-layered determinism contracts

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

## 9. What's intentionally NOT in Stage 5

For reference when Stages 6–10 hit:

- **Markov chord transitions** — Stage 6. Still hard-coded 4
  progressions.
- **Voice-leading solver** — Stage 6.
- **Lorenz macro mood** — Stage 7. No long-timescale state biasing
  anything yet.
- **Ornament process** — Stage 8. `Channels.BELL` still reused for vinyl
  crackle.
- **L-system melody contour** — Stage 9. Melody is still
  pure-pentatonic-Bernoulli, just with a breathing density.
- **CA drum drift** — Stage 10. Drum grid is still fixed boom-bap.
- **Engine-driven warmth / master volume** — punted (UI conflict with
  user sliders, deferrable).
- **Python validation harness for 1/f spectrum check** — punted, not
  urgent for two-knob dynamics.
