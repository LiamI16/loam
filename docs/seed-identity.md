# Seed identity — the "Minecraft seed" design principle

> Load-bearing design constraint for every per-seed parameter
> decision. Decided 2026-06-17 during chord-comping scoping.
> Supersedes any ad-hoc per-seed-knob patterns established earlier
> (e.g., the bass-stickiness "fixed" mode in
> [stage-list.md](../stage-list.md) "Bass scheduler details").

## The goal

Each seed should have its own **emergent personality** — like
Minecraft seeds. Two random seeds shouldn't sound the same, but no
single feature should be categorically labelable ("this is the jazzy
seed", "this is the dense seed"). Personality lives in the
*aggregate shape* of many small differences, not in any one knob.

## The two principles in tension

These pull against each other and the design has to honour both:

1. **Continuous, non-salient.** This is study/focus music. The user
   should never notice a transition ("now we're in the jazzy
   biome"). All change happens by drift, not by switch. There are no
   biome boundaries.
2. **Per-seed distinctness.** No two seeds should feel
   interchangeable. Even after a long listen on seed A, switching to
   seed B should feel like a different place.

## Why "Minecraft" and what that actually means

Minecraft seeds don't feel distinct because of categorical biome
types alone — two random seeds both contain forests, plains,
deserts, oceans. The distinctness comes from the **specific
arrangement and frequency of structures encountered during
traversal**: this seed has a desert wedged against a jungle with a
ravine between; that seed has three villages clustered near spawn.
Same vocabulary, different sentence.

Translated to music: the **rules and palette are universal**;
identity emerges from the *path each seed traces* through the shared
state space, plus a few orthogonal biases (mix, structure
realization) that compose with each other.

## The hybrid stack (five layers)

Every per-seed parameter decision should reach for some combination
of these. **No single layer is sufficient.** Layered, they produce
emergent identity without any single feature labeling the seed.

### 1. Universal fBm drift

Each parameter has a slow 1/f stream that drifts its value over
time. Universal: every seed gets the same parameter, same
underlying noise process. Continuous (no jumps).

Sufficient on its own? **No.** Pure fBm with identical parameters
across seeds is ergodic — over a long enough listen, every seed
visits every part of the state space and seeds homogenize.

### 2. Per-seed fBm shape

Same fBm streams, but per-seed: the **mean, clamp range, and
slowest-octave timescale**. Seed A's chord-density drifts
continuously in `[0.4, 0.8]` over ~90 s octaves; seed B drifts in
`[0.2, 0.55]` over ~3 min octaves. Different operating regions,
different pacing — still continuous within a seed.

Drawn from continuous distributions, **not discrete buckets**. No
"fast seeds vs slow seeds"; just a continuum of timescale draws.

### 3. Per-seed couplings between streams

Universal streams, per-seed correlations. Seed A's chord-density is
positively correlated with melody-density (busy goes with busy).
Seed B's are anticorrelated (busy melody fills sparse chord gaps).

Emergent and subtle — you can't point at it but you'd recognize a
seed on re-listen. Add couplings sparingly (a handful, not every
pair).

### 4. Per-seed orchestration / mix bias

Identical comping rules and voicings, but per-seed: instrument
volumes, reverb send offsets, hat presence, pad-vs-Rhodes balance.
This is what real lofi producers do — every track on a 50-track
playlist uses essentially the same kit; the *trackness* lives in EQ
and balance.

Truly non-salient (the listener doesn't notice mix, they just feel
it) and enormously perceptible-per-seed. Compose with everything
else — orthogonal to chord-layer decisions.

### 5. Per-seed structured-choice realization

Already largely in place: the Markov walk, mode blend, BPM are
seed-varying. Extending it: which voicing archetypes are reachable,
which altered-dominant colors exist in this seed's vocabulary, etc.
Identity-by-vocabulary-selection on top of identity-by-trajectory.

## Explicitly rejected patterns

### Per-seed fixed value knobs (stair-step) — *with one carve-out*

E.g., "this seed has density=0.7 forever." Violates principle 1
when the parameter is perceptually noticeable enough that
hours-of-monotone-value reads as static. (The bass-stickiness
"fixed mode" is this pattern; it pre-dates this principle and is
not a template to copy forward. Don't extend it; do replace with
§2-style fBm shape if revisited.)

**Carve-out — rare-event parameters.** For parameters that fire
*so rarely* that fBm drift is perceptually invisible (e.g., an
event that triggers once every ~2 minutes), a **continuous-
distribution per-seed fixed draw** is permitted. Two conditions:

1. The draw is from a **continuous distribution** (Beta, Normal,
   etc.) with no discrete buckets — seeds form a continuum, not
   categories.
2. The parameter's expected event interval is long enough that
   "drifting the rate" would be inaudible (~30 s or longer is a
   reasonable floor).

Example: chord-comping off-beat syncopation rate, drawn from
`Beta(2, 5) · 0.05` per seed. Mean ~1.4% (sync once per ~70 bars),
tail to ~4% (once per ~25 bars). Some seeds barely sync; others
sync noticeably more. No category labels because the value is
continuous. Drift would be invisible because consecutive
syncopations are so far apart.

The reasoning: this isn't a categorical knob (it's a continuous
draw) and it isn't a monotone-within-seed problem (the parameter
fires rarely enough that "the rate changing" can't be perceived
even if it did). It's the *only* sensible model for rare events.

If you find yourself reaching for a per-seed fixed value on a
parameter that fires often (every few seconds or faster), the
carve-out doesn't apply — use §2 fBm-shape instead.

### Categorical seed archetypes ("biomes")

E.g., sample at init from `{jazzy, straight, ambient, sparse}`.
Violates principle 1 — even with smooth interpolation, the listener
can label the type. Minecraft's biome categories work for terrain
because you spend hours in one; for ambient study music they read as
labels.

## What every new per-seed parameter must specify

For each parameter introduced into a scheduler or chain:

1. The **universal rule** — what the parameter does and what its
   full range is. Same for every seed.
2. The **fBm stream** that drifts it — universal noise process,
   universal default timescale.
3. The **per-seed shape modifier** — mean / clamp / timescale draw
   from a continuous distribution. Document the distribution.
4. Any **per-seed couplings** to other streams — sparingly, with
   reasoning.
5. The **mix-layer per-seed bias** for the channel this parameter
   affects, if relevant.

If a parameter only specifies (1) you have homogeneous seeds. If it
specifies (1)+(3) without (2) you have stair-step seeds. The
combination is the contract.

## Implementation discipline

- New seed children added to `Seed.child(...)` for each per-seed
  shape draw, with names matching the parameter (e.g.,
  `chord-density-shape`, `chord-density-fbm`).
- Engine fingerprint break is expected when adding seed children;
  document in [seed-format.md](./seed-format.md) §7.3a, reset the
  pinned fingerprint, note in commit message.
- Per-seed shape draws happen once at engine init; fBm streams
  evaluate continuously. Don't re-draw shape mid-session.

## Validation (eventually)

The "validate that two random seeds feel different" question is
real but not yet automatable. For now: A/B listen tests on
hand-picked seed pairs at each scheduler addition. Future:
spectral / statistical-feature distance metrics over rendered
audio (deferred Python harness territory).
