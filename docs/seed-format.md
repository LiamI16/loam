# Seed format & PRNG derivation

> The contract behind "same seed → same soundscape." Everything random in
> the engine — every noise channel, every Markov decision, every ornament
> timer — pulls from a deterministic stream derived from one root seed.

---

## 1. Surface form

**Root seed: 64-bit unsigned integer.** Minecraft-style.

- **In code:** `bigint` (`123456789n`). 64 bits is plenty of entropy and
  avoids JavaScript's 32-bit bitwise quirks.
- **In the UI:** displayed and accepted as either decimal or a short
  base36 string for shareability (`"k3d8j2f4a1"`). Same value either way.
- **Default:** when no seed is supplied, generate one from
  `crypto.getRandomValues` and show it to the user so they can save / share
  the one they liked.

Single integer in, deterministic 2-hour session out.

---

## 2. Stream PRNG: PCG32

[**PCG32**](https://www.pcg-random.org/) — 64-bit internal state, 32-bit
output, ~50 lines of code, well-studied statistics, no dependencies.

- **Why not `Math.random()`:** not seedable; implementation-defined; not
  reproducible across browsers.
- **Why not xorshift / xoshiro:** PCG has better statistical properties at
  similar speed, and the implementation is canonical.
- **Why not crypto PRNGs:** overkill for non-adversarial use; slower; and
  no seed-based reproducibility.

Output API:
```ts
class Rng {
  next(): number;                // uint32
  nextFloat(): number;           // [0, 1)
  nextRange(a: number, b: number): number;
  pick<T>(xs: readonly T[]): T;
  bernoulli(p: number): boolean;
  // ...
}
```

---

## 3. Sub-seed derivation: splitmix64

The root seed never gets used directly. Every subsystem asks for its own
named child seed:

```ts
const root  = Seed.from(123456789n);
const melodyDensityRng  = root.child("melody/density-fbm").rng();
const chordMarkovRng    = root.child("harmony/markov").rng();
const ornamentGlobalRng = root.child("ornaments/global-rate").rng();
const lorenzRng         = root.child("attractors/lorenz-init").rng();
// ... one per consumer, dozens total
```

Internally, `.child(label)` returns a new `Seed` whose value is
`splitmix64(root, hash64(label))`. Splitmix64 is the standard hash for this
purpose — used by Java's `SplittableRandom`, fast, well-mixed.

**Why named children matter:**

1. **Two consumers never share a stream.** Without this, drawing one extra
   random number in subsystem A shifts everything subsystem B sees from
   then on — a brittle coupling that breaks tests.
2. **Adding new subsystems doesn't perturb old ones.** Same root seed
   yields the same melody whether or not the engine now also has an
   ornament module, because melody pulls from `"melody/..."` and
   ornaments pull from `"ornaments/..."`.
3. **Labels are stable contracts.** Rename a label and you've changed the
   output for every saved seed. So label strings get versioned only
   intentionally.

---

## 4. Determinism scope

**What is guaranteed:** same seed → same event sequence emitted by
`@loam/core` on any browser, any platform. Integer math throughout; no
floats in the PRNG path; no reliance on `Math.random`, `Date.now`, or
anything time-dependent inside the deterministic core.

**What is *not* guaranteed:** byte-exact audio output across machines.
Floating-point rounding in the Web Audio synthesis layer differs slightly
between browsers and architectures. The *notes and parameter trajectories*
are identical; the rendered samples may differ at the LSB. This is fine —
shareability is about the soundscape's character, not bit-exact WAV files.

If we ever want byte-exact rendering (e.g. for offline server-side WAV
export), it gets done in Python via an offline render, not in the browser.

---

## 5. Persistence

Engine state that needs to survive pause/resume (and that the validation
harness needs to snapshot):

- Root seed (immutable for the session)
- Engine-time elapsed (so all derived clocks resume correctly)
- Current state of each long-lived PRNG (PCG32 state is two 64-bit ints —
  trivial to serialize)
- Current state of each Markov chain (one integer — current node)
- Current attractor coordinates (3 floats per attractor)
- fBm phase per channel (one float per channel)
- Ornament last-fire timestamps (global + per-type, in engine-time)

Total persistent state is small (low kilobytes); serialize to JSON for
save/restore.

---

## 6. Implementation note

`Seed`, `Rng`, splitmix64, and PCG32 are the first code written in
`@loam/core`. They go in by themselves with a `vitest` test that pins a
known seed to a known sequence of outputs. That test is the seed-
determinism contract for the entire project — if it ever breaks, every
saved seed is invalidated.

---

## 7. Design assumptions baked in

### 7.1 PCG32 is a one-way door once seeds are published

The hard-coded determinism test in `packages/core/test/determinism.test.ts`
pins splitmix64 + PCG32 forever. Anyone we share a seed with — in the
hosted demo, in the architecture writeup, in a tweet — gets bound to *this*
PRNG algorithm.

**Implication:** swapping to a higher-precision PRNG later (PCG64,
xoshiro256**, etc.) is a breaking change that invalidates every saved seed.
PCG32 is the right call for v1 (excellent statistics, fast, tiny, plenty of
period for any musical use), but the choice doesn't have take-backs without
a v2 seed format. Treat the moment we publish the first shareable seed as a
soft commitment to this PRNG.

### 7.2 Label hashing uses UTF-16 code units, not UTF-8 bytes

`hash64String` (FNV-1a) iterates over `s.charCodeAt(i)` rather than
encoding to UTF-8 first. Avoids pulling `TextEncoder` (and the lib types
that come with it) into `@loam/core`. Stable across platforms because JS
strings are always UTF-16.

**Implication:** all current seed labels are dev-controlled ASCII
identifiers (`"melody/density-fbm"`, `"ornaments/global-rate"`, etc.),
where UTF-16 code units == ASCII bytes. **If the "note title → seed"
growth-space idea is ever implemented**, the title-derived seeds must hash
the same way (code units, not UTF-8 bytes), or seeds derived from non-
ASCII titles will differ between hashing schemes. Stick with this hash
function for any seed-derivation path.

### 7.3a Multi-layered determinism contracts (Stage 5+)

As Phase 2 adds layers on top of the PRNG (value noise, fBm, Markov,
soon-to-be attractors / L-systems), each layer gets its *own* locked-
sequence test. Current set:

- `ValueNoise1D.sample(x)` (Stage 5) — known floats for `Seed.from(42n)`
  at fixed positions; locks the splitmix-on-demand gradient + Hermite
  smoothstep formula.
- `Fbm1D.sample(x)` (Stage 5) — known floats summing 4 octaves with
  persistence 0.5 / lacunarity 2; locks the octave-stacking math.
- `MarkovChordWalk.next()` (Stage 6) — known 16-chord walk from `Am7`
  with `Seed.from(42n).child('harmony/markov')`; locks `HAND_MATRIX`
  weights and the walk's CDF-roll formula.
- `perturbMatrix` (Stage 6) — known floats for the `Am7` row of the
  α=20 perturbation under `Seed.from(42n).child('harmony/markov-config')`;
  locks the Marsaglia–Tsang gamma sampler, Box–Muller normal, and
  Dirichlet normalization.
- `PositionStream.evaluate(t)` (Stage 7a) — known `(x, y)` floats at
  `t = 0, 60, 120` under `Seed.from(42n).child('position')`; locks the
  two-independent-fBm composition that drives all position-derived
  biases (voicing register drift, future mode/key drift).

**Implication:** each layer's contract pins that layer specifically.
A failing PRNG contract means the PRNG changed; a failing fBm contract
with passing PRNG and ValueNoise contracts means the fBm summation
changed; etc. Diagnosing regressions is fast. Every layer-locked test
is also a v2-seed-format breaker if intentionally changed — they're
the project's compatibility contract surface.

**Engine fingerprint resets (history).** The `EmberEngine` whole-
engine fingerprint in `test/ember-engine.test.ts` is *deliberately*
reset whenever a sub-scheduler rewrite shifts the RNG sequence. Each
reset is a v2 break for any saved seed. Recorded:

- 2026-06-XX (drums): per-voice timing + accents + per-bar variation.
- 2026-06-XX (bass): bass scheduler with stickiness.
- 2026-06-17 (chord comping): chord-scheduler rewritten as a bar-grid
  comping scheduler. Adds seed children `chord-slot-bias-fbm/-config`,
  `chord-slot-length`, `chord-density-fbm/-config`, `chord-pickup`,
  `chord-sync-config/-` and `chord-velocity`. Removes
  `voicing-wobble`. Locked initially at count 116; the same-day
  "beat 1 anchored every bar" tightening kept count at 116.
- 2026-06-17 (chord voicing variety C): adds four voicing archetypes
  (close / spread / rootless / quartal) selected per slot from per-
  seed Dirichlet-perturbed weights, plus drop-a-voice micro-variation
  on bars 2+ and rootless-preview pickup. Adds seed children
  `chord-archetype-config`, `chord-archetype`, `chord-micro`.
  Fingerprint reset to count 112 with first 6 events
  `hat / pad×2 / rhodes×3` — seed 42's first archetype roll is
  quartal, producing a 3-voice (D-G-C) opening voicing rather than
  the previous 4-voice close (C-E-G-A).
- 2026-06-17 (chord echo): adapter-side `Tone.FeedbackDelay` on the
  keys path, output routed into the shared reverb bus. Engine emits
  a one-shot `fx.chordEcho.time` ParamEvent at t=0 = `60 / bpm`
  seconds (quarter note locked to seed BPM). Fingerprint count
  113; first slot's last rhodes voice rotates out of the 6-element
  slice as the new ParamEvent takes its place.
- 2026-06-17 (chord comping rework — pattern menu): the chord
  scheduler's per-beat probability model replaced by a per-slot
  comping-pattern menu (pure-hold / hold-with-refresh / call-response
  / light-comping / active-comping) with per-seed Dirichlet weights
  tilted by a renamed `chord-activity` fBm stream. The previous
  beat-3 "density" stream is gone — its role split cleanly:
  pattern selection (activity-stream-tilted Dirichlet) replaces
  per-beat firing, and "density" no longer exists as a concept.
  Sync (per-seed Beta-drawn off-beat substitution) dropped — the
  pattern menu covers the design intent more cleanly. Seed children
  renamed: `chord-density-fbm/-config` → `chord-activity-fbm/-config`;
  added `chord-pattern-config`, `chord-pattern`; removed
  `chord-sync-config`, `chord-sync`. Fingerprint count holds at 113;
  first 6 events unchanged because seed 42's first pattern still
  fires beat 1 at t=0 with the same archetype voicing.
- 2026-06-17 (RHODES channel split): `Channels.RHODES` removed,
  replaced by `Channels.RHODES_CHORD` and `Channels.RHODES_MELODY`.
  Chord scheduler emits on the former; melody scheduler on the
  latter. Lets the adapter mix chord (−13 dB) and melody (−9 dB)
  independently — preparation for melody rewrite. Fingerprint count
  stays at 113; first 6 event signatures change `rhodes` →
  `rhodes_chord` (string-level only).
- 2026-06-22 (melody Commit H — per-emission timing jitter): Phase 3
  complete. Every emitted melody note (germ-derived OR fresh) gets a
  uniform `[-7ms, +7ms]` offset applied on top of any swing offset.
  Drawn per-emission from the new `melody-jitter` seed child (its own
  rng stream so jitter doesn't perturb other rngs). Absolute ms, not
  percentage, per `docs/melody.md` F2 — keeps humanization at "barely
  perceptible" magnitude regardless of BPM (a percentage-of-quarter
  jitter would scale to sloppy ranges at slow tempi). 7 ms is the
  midpoint of the spec'd 5–10 ms range. Engine fingerprint unchanged.
- 2026-06-22 (melody swing range — final tuning): two-step
  adjustment to the Commit G default.
  First step: widened from `[0.50, 0.55]` to `[0.50, 0.60]` because
  the original spec was inaudible (drum kit uses 0.55).
  Second step (same day, after user ear test): re-narrowed to
  `[0.50, 0.57]`. The 0.60 cap was using a Dilla-pocket 16n reference
  inappropriately — we apply **8n** swing, not 16n, so the same
  numeric value produces ~2× the perceptual offset. 0.60 on 8n is
  jazz-piano territory. Final range is lofi-canonical 8n swing
  (0.52–0.57), audible per-seed character without crossing into
  jazz feel. Max offset ~28 ms at BPM 74. Fingerprint unchanged.
- 2026-06-22 (melody Commit G — swing): per-seed swing ratio drawn
  from `uniform[0.50, 0.55]` at construction (fixed for the session)
  via the new `melody-swing-config` seed child. Per `docs/melody.md`
  F2: swing is a performance habit, not a creative free parameter, so
  drift was rejected. Applied as a forward time-offset on 8n off-beat
  melody notes only — fragment-start (always on a quarter boundary)
  and notes at on-beat or triplet positions are untouched.
  `offset = (swing − 0.5) · eighth-duration`; at BPM 74 a max-swing
  seed adds ~20 ms, a tight-feeling seed adds ~0 ms. Fingerprint still
  113 for seed 42 in [0, 5s); no other RNG state changes since the
  swing draw lives on its own seed child.
- 2026-06-21 (melody Commit F — compound 2-chain): Phase 2 complete.
  After the first transformation is applied (transform / buffer rule
  only — germ verbatim and fresh-note don't trigger compound), a
  Bernoulli against the per-seed `pCompound` decides whether to chain
  a second transformation. Second-kind selection from the same Dirichlet
  weights, with the first kind excluded (weight redistributed
  proportionally across the rest) to avoid degenerate same-kind
  compositions (e.g. transpose-then-transpose collapsing to a larger
  transpose). At structural moments retrograde joins both menus.
  Composition is left-to-right: `result = secondKind(firstKind(source))`.
  Per-seed `pCompound = Beta(2, 5) · 0.5` (mean ~0.143, max ~0.5)
  sampled via 6-uniform order statistic from `melody-compound-config`.
  Adds seed children `melody-compound`, `melody-compound-config`.
  Determinism: `compoundRoll` always-consumed inside fire branch;
  second-kind selection roll consumed only when compound fires.
  Fingerprint still 113 for seed 42 in [0, 5s).
- 2026-06-21 (melody activity rate retune): post-Commit-E ear test
  flagged the main melody as "firing too often" even on calm seeds.
  Root cause: when Commit C swapped per-quarter single-note Bernoulli
  for per-quarter multi-note fragments, the firing rate stayed at
  the chord-activity-stream default (mean 0.35) — but each fire now
  emits 3–5 notes instead of 1, so total melody note density was 5×
  the pre-rewrite engine. Pulled `MELODY_ACTIVITY_MEAN` from 0.35
  to 0.22 (slightly above the legacy `density` default of 0.18 to
  acknowledge that fragments are richer events), and tightened range
  from [0.10, 0.70] to [0.08, 0.50] to cap busy seeds at moderate
  activity. Calm seeds (42, 1) now produce ~14 notes/min (close to
  pre-rewrite ~11/min); active seeds (1012746201732607284, 7) produce
  ~42 notes/min (well below the previous 80+/min for the same per-seed
  character). No new seed children; no RNG count/order changes. Engine
  fingerprint still 113 for seed 42 in [0, 5s).
- 2026-06-21 (melody Commit E tuning — germ identifiability): post-E
  ear test (seed 42 / T10 arpeggio) showed the underlying germ shape
  was too recognisable across the supposedly-varied transformation
  outputs. Three tunings applied together:
  (1) Four-way emission weights shifted from `[0.35, 0.30, 0.20, 0.15]`
      to `[0.25, 0.40, 0.20, 0.15]` — germ-verbatim cut from 35 % to
      25 %; transform absorbs the delta.
  (2) Transformation menu weights re-balanced from
      `[0.27, 0.27, 0.13, 0.07, 0.10, 0.16]` to
      `[0.18, 0.40, 0.09, 0.05, 0.06, 0.22]` (transpose / fragment /
      augment / diminish / invert / ornament). The shape-preserving
      four (transpose / invert / augment / diminish) lose ~half their
      weight; fragment + ornament absorb it.
  (3) `fragment` transformation length distribution biased to 2-note
      slices (70 %) vs 3 (25 %) vs full-length (5 %); was uniform.
  (4) Buffer rule locked to the `fragment` transformation regardless
      of the per-seed Dirichlet selection (transformRoll still
      consumed for determinism). Buffer's job is local-coherence via
      *short slices*, not full-length recurrence.
  No new seed children; all RNG draws unchanged in count/order, only
  the weights they sample against. Every seed's audio shifts. Engine
  fingerprint still 113 for seed 42 in [0, 5s) (no melody firings in
  that window under any tuning).
- 2026-06-21 (melody Commit E — transformations + retrograde
  gating): the `transform` and `buffer` branches of the four-way
  emission rule now route through `melody/transformations.ts`. Six
  transformations always available (transpose / fragment / augment /
  diminish / invert / ornament) with base weights
  `[0.27, 0.27, 0.13, 0.07, 0.10, 0.16]`; retrograde joins the menu at
  fixed weight 0.15 (others scaled to 0.85) when a fragment-start
  falls within 0.5 beats of any `state.structuralMomentTimes` entry.
  Per-seed Dirichlet α=20 on the six. Adds seed children
  `melody-transformation`, `melody-transformation-config`,
  `melody-transformation-param`. Determinism roll order inside the
  fire branch: fireRoll, ruleRoll, transformRoll (always), then
  transform-internal param rolls (consumed only by the transformation
  that needs them). Audio for every seed shifts substantially —
  perceived monotony from the Commit D verbatim-germ fallback is the
  main thing this fixes. Engine fingerprint stays at count 113 for
  `Seed.from(42n)` in [0, 5s) because seed 42 still doesn't fire
  melody in that window.
- 2026-06-21 (melody Commit D — fragment emission + 4-way rule
  + buffer): per-firing emission switches from single-note to
  multi-note fragment. The 4-way decision (germ / transform / buffer
  / fresh) is rolled at each fragment-start opportunity from per-seed
  Dirichlet-perturbed weights `[0.35, 0.30, 0.20, 0.15]`. In this
  commit `transform` and `buffer` fall back to germ verbatim — they
  light up in Commit E with the transformation library. `fresh`
  emits a single chord-aware pitch via the pre-Commit-C clash-filter
  helper. A rolling buffer (per-seed size `[4, 12]`) accumulates
  emitted notes for E to consume. Adds seed children
  `melody-emission`, `melody-emission-config`, `melody-buffer-config`.
  Determinism discipline shifts: per-firing now always-consumes
  `fireRoll` + `ruleRoll`; per-note velocity rolls are confined to
  the fire branch (fragment length varies, so they can't be
  pre-rolled uniformly). Engine fingerprint count holds at 113 for
  `Seed.from(42n)` at `bpm: 74` in [0, 5s) — coincidence: seed 42
  doesn't fire melody in this window under either scheme. Every seed's
  emission scheme has fundamentally shifted; the lock test happens to
  not catch it (incomplete by design — see Commit C entry).
- 2026-06-21 (melody Commit C — germ + min-cap coupling): melody
  scheduler rewritten from a density-driven pentatonic Bernoulli to a
  germ-driven scheduler gated by the F1 min-cap chord-melody coupling
  formula. Every seed's melody track changes substantially (new pitch
  selection: germ scale-degree offsets projected onto the dominant
  mode bag; new firing rate: per-seed `melody-activity-fbm` × coupling
  with `chordActivityStream`). Adds seed children
  `melody-template-config`, `melody-template`, `melody-germ` (Commit B,
  scaffold) and `melody-activity-fbm/-config`,
  `melody-chord-coupling-fbm/-config` (Commit C). The legacy
  `state.densityStream` and `density` engine option are now a no-op for
  melody (and unused engine-wide); kept around for now for back-compat
  with the web demo's existing slider but slated for removal /
  repurposing in a follow-up. Engine fingerprint count happens to
  stay at 113 for `Seed.from(42n)` at `bpm: 74` in [0, 5s) — pure
  coincidence (the new emission rate cancels the old density rate at
  this seed/window). The audio contract changes for every seed; the
  whole-engine fingerprint lock is necessarily incomplete here. Phase
  2 (transformations + 4-way emission rules + recent buffer) and
  Phase 3 (swing + jitter) will each introduce further resets.
- 2026-06-19 (pattern Markov): the per-slot comping pattern is now a
  Markov walk on a transition matrix conditioned on the previous
  slot's pattern, rather than independent rolls from a single weight
  vector. Patterns stick (calm-leaning self-loops) and drift musically
  (adjacent-activity transitions favoured over jumps). Base weights
  shifted `[0.40, 0.30, 0.15, 0.10, 0.05] → [0.55, 0.28, 0.10, 0.05,
  0.02]` after a family-listening review flagged "random mash" feel
  — calmer target distribution + Markov memory together produce
  thought-out-feeling pattern flows. Adds seed child
  `chord-pattern-matrix-config` (per-row Dirichlet perturbation at
  α=20). First slot still uses base weights via `selectPattern`;
  subsequent slots use `selectNextPattern`. Engine fingerprint count
  stays at 113 (5 s window covers only the first slot, which is
  pre-Markov path; new seed child doesn't shift existing children's
  RNG sequences).

### 7.3 Derived methods aren't separately contract-locked

The determinism test pins the `uint32` sequence emitted by `Rng.next()`.
Derived methods (`nextFloat`, `nextInt`, `pick`, `bernoulli`) are
*implementations on top of* `next()` — if their internal formulas change,
the same seed produces different musical decisions even though the locked
`uint32` sequence is unchanged.

**Implication:** treat the wrapper formulas in `rng.ts` as part of the
contract too, even though only `next()` is hard-pinned. If anyone refactors
`nextFloat` (e.g. to use 53-bit float precision instead of 32-bit), every
in-use seed shifts. Probably worth adding a second locked-sequence test for
`nextFloat` and `nextInt` when ornaments start consuming them seriously.
