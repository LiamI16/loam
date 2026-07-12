# Arrangement controller — design (ACTIVE)

> **⚠️ STATUS 2026-07-11 — core model under reconsideration.** The
> **occupancy-Markov** design below (decisions A–F, numerics) was implemented
> and **failed listen-check**: instruments vanish for far too long (melody up
> to 22 min; bed instruments a *median 71 min*, up to 8 h). Root cause is
> fundamental — in an occupancy model **absence-duration = dwell-duration**,
> and the 1/f energy contour has unbounded low-excursions, so *any* occupancy
> model (Markov, density-threshold, full-connectivity — all tested) has
> unbounded absence. Bounded absence is a hard requirement (melody feedback),
> **Research resolved the direction (2026-07-11 → `docs/arrangement-research.md`):**
> adopt an **event/dropout model = per-role alternating-renewal with a bounded
> off-duration (hard absence cap) + a Cox process where the 1/f energy contour
> modulates drop *rate/depth* but never *duration*.** Keep the curated 8-state
> palette as a **legal-combo *filter*** (veto/resample), not the generator.
> Musicality via serialization (≤1 change/boundary), hysteresis/min-dwell,
> scheduled rare deep multi-drops, quantized crossfade + re-entry. Per-seed
> identity = per-role `{rate, max duration/depth, hysteresis, favored-drop}`.
> Semi-Markov was evaluated and **rejected** (per-state dwell caps don't bound
> per-*instrument* absence). **Next: a design pass on the event-model specifics,
> then re-implement.** Treat A–F + numerics below as *superseded* — but the
> palette, the per-seed axes, and the regression gate
> (`packages/core/test/arrangement-absence.test.ts`, measures contiguous
> absence — the metric the offline validation *missed*) all carry forward.
>
> Plan doc, active. The launch-critical feature: the engine currently plays
> every instrument continuously and nothing ever drops out, which is the
> biggest "tech-demo vs. music" tell. Real lofi *breathes* — 8 bars of pad +
> melody (drums out), then drums + bass alone, then everything but kick. The
> coming-and-going *is* the variation. Follows the documentation-procedure
> lifecycle; collapses to a decision-record at close-out.

## Grounding (current wiring)

- `EmberEngine.scheduleUntil(until)` (`ember.ts:211`) is the **composition
  point**: it calls each sub-scheduler's `scheduleUntil(from, to)` in order
  (chords first — it populates `state.chordSchedule` — then bass, drums,
  melody, crackle), concatenates into `raw`, scales engine-time → audio-time,
  sorts, returns.
- `EngineState` (`ember.ts:45`) is the shared blackboard schedulers read each
  pass (`chordSchedule`, `structuralMomentTimes`, `currentChord`, `position`).
- `SubScheduler` = `{ scheduleUntil(from, to): EngineEvent[]; reset() }`. No
  shared lifecycle hook today.
- Note events carry a `channel`; muting = dropping a channel's events.

## Constraints (not up for debate)

- **Seed-identity hybrid stack** (`docs/seed-identity.md`): arrangement
  decisions are per-seed but must be universal-rule + fBm drift + per-seed
  shape + couplings, never fixed categorical archetypes or a raw per-seed
  knob (except the rare-event carve-out).
- **Smooth handoffs at phrase boundaries** — mutes/unmutes only land on a
  phrase boundary, never mid-phrase.
- **Genuine silences allowed** — the engine may drop to just pad (+ crackle)
  for short windows.
- **Fingerprint**: preserved, not broken (see decision F). Named seed children
  + open-at-`FULL` keep the 5 s `Seed.from(42n)` window byte-identical, so
  arrangement is a non-breaking additive change — no §7.3a entry needed.

## Open questions

Resolved one at a time (see the log at bottom as they close).

## A2 scope (chosen mechanism)

**Decision A → A2: mask-aware schedulers.** Rationale (2026-07-09 adversarial
review of A1): A1 makes arrangement purely *subtractive* — it can hard-gate a
channel but can never let content respond to the arrangement (the §3 couplings
that make it musical), can't cleanly silence sustained voices (pad 4 s / keys
0.8 s / reverb tails ring past an event-filter), and gives arbitrary
re-entries. A2 is more surface but is the version worth building, and the
subtractive-only shortcut would need retrofitting onto every scheduler anyway.

### Mechanism

- **`EngineState` gains** a phrase clock (current bar within the active
  N-bar phrase; phrase index) and an **active-mask** (which instrument roles
  play this phrase). Written by the controller, read by every scheduler.
- **New `ArrangementController`** runs *first* in `scheduleUntil` (before
  `chords`, like a pre-scheduler): advances the phrase clock and, **at phrase
  boundaries only**, decides the next phrase's mask + writes it to
  `EngineState`.
- **Each sub-scheduler reads the mask** and: (i) emits nothing when its role
  is muted [subtractive], and (ii) may adapt what it plays to the full mask
  [interactive — the couplings].
- **Clean cuts:** a scheduler transitioning to muted may need to release
  ringing voices (see question E), not just stop emitting.

### Touch points (effort map)

- `ember.ts` — `EngineState` fields; construct + run `ArrangementController`
  first; pass mask through.
- `arrangement-controller.ts` — new; the decision model.
- every `*-scheduler.ts` — read mask, gate emission, optional adaptation.
- Fingerprint **will move** — deliberate seed-format break (`docs/seed-format.md`
  §7.3a + commit).

## Open questions (queue — resolved one at a time)

_(all questions resolved — see decision log)_
- **D — interactive couplings**: which content-modulations the arrangement
  drives (e.g. drums-out → busier bass/melody), and which are launch-scope.
- **E — exit/re-entry + clean cuts**: which instruments get boundary gestures
  (bass resolves to root before dropping; melody re-enters on a downbeat) and
  how muted sustained voices actually go silent (`releaseAll` vs natural tail).
- **F — fingerprint break**: sequencing the seed-format change + §7.3a.

## Decision log

- **A → A2** (mask-aware schedulers), 2026-07-09. Arrangement must be
  interactive, not subtractive-only; see A2 scope above.
- **B → flat 8-bar phrase grid**, 2026-07-09. Grid is not neutral resolution:
  it sets the *minimum recession length* and *which boundaries a change can
  land on*. 8 bars (~26 s @ 74 BPM) guarantees every change lands on a strong
  hypermetric downbeat and makes sub-26 s blips unrepresentable (vs. a 4-bar
  grid, where half the boundaries are weak and 13 s blips must be actively
  suppressed by C). Personality lives in **content + contour**, not the grid,
  so the grid stays fixed (not per-seed). **4-bar "quick breath" carve-out
  dropped** — it needs sub-grid resolution (a parallel finer mechanism) that
  fights the guarantee; the variety it chased (some short, some long
  recessions) is delivered instead by varying recession length in whole-phrase
  multiples (8/16/24 bars), which lives in C at no extra cost.
  Frequency/dwell is a *separate* knob from the grid — target state dwell
  ~1–2 min, changes single-instrument, contour-driven (see C).
- **C → C1: discrete arrangement-state Markov machine**, 2026-07-09. A curated
  palette of legal states, walked by a Markov matrix (high self-loops =
  persistence) tilted by a slow energy-contour fBm. Direct reuse of the
  chord-comping-pattern architecture that solved the "sounds random" critique
  (2026-06-19). Guarantees fall out structurally: legal floor (illegal combos
  aren't in the palette), single-instrument changes (transitions only between
  adjacent states differing by one instrument), purposeful stickiness
  (self-loop weights). **Per-seed identity = the seed sets the weights**, via a
  per-seed per-instrument **presence-bias vector** that reweights the base
  stationary π (see Implementation numerics) — so per-instrument personality
  (this seed's drums are often absent) emerges from C1's weighting, capturing
  C2's benefit without its illegal-combo / scene-cut risk. Chosen over C2
  (independent per-instrument presence), which reintroduces the random-feel +
  floor-policing we already paid to remove. *(Realization refined 2026-07-09:
  presence-bias reweights π directly — exact per-seed stationary — rather than
  Dirichlet-perturbing the matrix, which would drift the stationary; see
  Implementation numerics "No Dirichlet-on-matrix layer".)*
- **C.2 → pad-only floor + 8-state palette**, 2026-07-09. Pad is the always-on
  harmonic anchor (brown bed + crackle also always-on, uncontrolled); bass /
  chords / melody / drums are arrangement-controlled. Palette (pad implicit):
  `FULL`, `no-melody`, `drums-out`, `pocket` (bass+drums), `warm`
  (bass+chords), `bass-breather` (bass only), `lead-breather` (melody only),
  `deep-breather` (pad only). The "always something underneath" value is a
  *state* (`bass-breather`), not a floor constraint — so pad-only floor keeps
  the deep near-silence too. Verified connected under single-instrument moves
  (C1 requirement); `lead-breather` is a leaf off `deep-breather` (melody
  re-enters first when rising from near-silence). Drums treated as a unit for
  v1 (kick-separability — "everything but kick" — deferred as a drum sub-state).
  Coupling: `warm`/chord-out states lean on pad for harmony, so the backlog
  "pad carries chord harmony" upgrade would strengthen them (not a blocker).
- **C.3 → universal breathing + energy-contour timing + `FULL` ceiling**,
  2026-07-09. `FULL` = today's behavior, so it's the shared known-good ceiling
  (no regression floor; a stay-`FULL` seed just sounds like today) — but the
  point is time spent *below* it. A single slow energy-contour fBm per seed
  (slowest octave ~3–5 min) drives departure below `FULL` over time; walk =
  Boltzmann tilt toward the contour's target fullness × self-loops for
  persistence, single-instrument moves. **Three orthogonal per-seed axes**
  (revised 2026-07-09):
  - **frequency / dwell** — *seed-specific* ("restlessness vs. stability": a
    restless seed reshuffles often, a stable one holds a texture for minutes).
    Per-seed dwell drawn ~45 s…~3 min, realized as a per-seed persistence
    scalar (self-loop strength), §2. Orthogonal to calm/busy — restlessness ≠
    energy.
  - **presence-bias** — *seed-specific*: which instruments a seed thins first.
  - **depth / center-of-gravity** — deliberately *not* independent: only a
    *mild reinforcing* coupling to the existing calm/busy identity (busy seeds
    hug `FULL` slightly more, §3), so arrangement is NOT a second calm/busy
    axis (that's already BPM / melody-activity mean / comping density).

  What's universal is only the *capability* to breathe (every seed does); the
  rate, shape, and instrument-selection are all per-seed.

  **Presence-bias is a soft *weighting*, NOT a hard clamp** — every seed can
  still reach every state; a seed just visits its favored ones more. Do not
  restrict a seed to a sub-palette: arrangement is a *path* dimension, and
  clamping a path causes within-seed repetition over a long single-seed session
  (the dominant use case). Anti-ergodic cross-seed distinctness is loaded onto
  *constant* dimensions (timbre, §4 mix bias) instead — see
  `docs/seed-identity.md` "Where to clamp: constants, not paths." Arrangement
  contributes cross-seed distinctness by *soft weighting + timing*, and accepts
  mild ergodicity as the right price for a journey dimension.
- **D → flagship space-fill (subtle)**, 2026-07-09. One coupling for launch:
  when the beat/harmony thins (`drums-out`, `warm`, `bass-breather`), the
  remaining lead leans *slightly* more present via a gentle bias on the melody
  scheduler's existing F1 activity coupling — a bias, never an override, tuned
  conservatively so a breather doesn't turn hectic. Register-spread + intimacy
  couplings deferred. Proves A2's interactive value with minimal, reversible
  scheduler surface.
- **E → natural cuts, no exit gesture, melody-only fresh re-entry**,
  2026-07-09. Pad-as-floor (C.2) already dissolved the clean-cut problem: the
  only long-release voice (pad, 4 s) is never muted, and every muteable voice
  has a short tail (bass 0.28 s / keys 0.8 s / drums percussive), so natural
  release on mute reads as a musical decay — **no `releaseAll` needed**. No
  exit gesture. Re-entry re-aligns for free for bass/chords/drums (their cycles
  divide the 8-bar grid); **melody** (variable phrase length) re-enters with a
  **fresh germ phrase** rather than mid-fragment — the one intentional re-entry
  gesture, which also moots germ-development-while-muted.
- **F → open-at-`FULL`, fingerprint-preserving**, 2026-07-09. Arrangement is a
  **non-breaking, additive change** — the earlier "will move the fingerprint"
  assumption is wrong. Seed children are named/independent
  (`seed.child('arrangement-…')`), so existing scheduler RNG is untouched. The
  fingerprint is the 5 s window at `Seed.from(42n)`; the first phrase is 8 bars
  ≈ 26 s, so if every seed **opens at `FULL`** there's no masking in that
  window → byte-identical event stream → fingerprint holds (the controller only
  writes `EngineState.mask`, emits nothing; a `FULL` mask is a no-op for every
  scheduler read). Open-at-`FULL` is also musically natural (start playing,
  breathe ~26 s in). Seed-derived sparse openings (a nicety) would break the
  fingerprint and were rejected as not worth it. **Update the stale "will break
  fingerprint" notes** in `stage-list.md` / `CLAUDE.md`-adjacent references.

---

# Implementation numerics + plan (settled 2026-07-09)

Concrete spec for a one-shot build. Values marked **[taste]** are the
judgment dials worth a sanity-check; **[ear]** are placeholder-then-`listen-check`;
the rest are structural / template-derived. Template throughout:
`harmony/comping-patterns.ts` + `harmony/dirichlet.ts` (`perturbDirichlet`).

## States, fullness, base weights

8 states, indexed; bits = (bass, chords, melody, drums), pad implicit-always:

| idx | state | bits | fullness | base π **[taste]** |
|---|---|---|---|---|
| 0 | `FULL` | 1111 | 1.00 | 0.30 |
| 1 | `no-melody` | 1101 | 0.75 | 0.14 |
| 2 | `drums-out` | 1110 | 0.75 | 0.14 |
| 3 | `pocket` | 1001 | 0.50 | 0.10 |
| 4 | `warm` | 1100 | 0.50 | 0.10 |
| 5 | `bass-breather` | 1000 | 0.25 | 0.09 |
| 6 | `lead-breather` | 0010 | 0.25 | 0.08 |
| 7 | `deep-breather` | 0000 | 0.00 | 0.05 |

π sums to 1.0. Distribution ≈ 58 % present (3–4 inst), 20 % mid, 17 % sparse,
5 % near-silent. `fullness` = active-instrument count / 4 (energy-tilt input,
the analogue of `PATTERN_ACTIVITY`).

**Adjacency** (single-instrument moves; verified connected):
`0:[1,2] 1:[0,3,4] 2:[0,4] 3:[1,5] 4:[1,2,5] 5:[3,4,7] 6:[7] 7:[5,6]`

## Transition matrix — construction (not hand-authored)

Build deterministically via **Metropolis-Hastings** on the adjacency graph so
the stationary distribution is exactly the (per-seed presence-biased) π — no
hand-tuned 8×8, no power-iteration:

1. Proposal `q_ij = 1/deg(i)` for neighbours `j`.
2. Acceptance `a_ij = min(1, (π_j·deg(i)) / (π_i·deg(j)))`.
3. `P_ij = q_ij·a_ij` (j≠i); `P_ii = 1 − Σ_{j≠i} P_ij`. Detailed balance holds
   by construction → stationary = π.

Then **per-seed laziness λ** (frequency axis): `P' = λ·I + (1−λ)·P`. A lazy
chain keeps the same stationary π but lengthens dwell. λ ∈ **[0.5, 0.86]
[taste]** drawn from `arrangement-frequency` → dwell ≈ **65 s … 4 min**
(restless → stable). Dwell in state i = 1/((1−λ)(1−P_ii)).

**No Dirichlet-on-matrix layer** (deliberate divergence from chord-comping,
2026-07-09 — flagged by "is base π prone to the same Dirichlet drift?").
Dirichlet-perturbing the transition rows moves the *realized* stationary off
the intended π' — the exact drift chord-comping documents as an identity
*weakener* ("mixes toward a stationary closer to the universal base"). We don't
need it: per-seed identity is carried **exactly** by the presence-biased π'
(which-instruments + time-distribution — and since MH makes the matrix a
deterministic function of π', different seeds already get genuinely different
transition shapes) and by λ (dwell); both preserve the stationary exactly.
Adding Dirichlet would only smear that with uncontrolled drift. Arrangement is
therefore drift-free where chord-comping is not.

## Energy contour + tilt

- One universal `Fbm1D` (`arrangement-energy-fbm`), slowest octave **~4 min**
  (`arrangement-energy-config`; octaves like the bass-stickiness drift). Per-seed
  identity here is only the fBm *phase* (different child) — range is universal
  (C.3: contour is timing, not per-seed amount).
- Map contour → `target ∈ [0,1]` fullness. At each phrase transition, tilt the
  current matrix row by `exp(−K·|fullness_j − target|)`, K=**2 [taste]** (gentle,
  cf. chord-comping K=3), renormalise, sample next state. Same selection-time
  tilt shape as `selectPattern`.

## Per-seed axes (draws)

- **Presence-bias** `b = (bass, chords, melody, drums)` (`arrangement-presence-bias`).
  Each component drawn **log-uniform, multiplicatively symmetric around 1.0** —
  `b = exp(u·ln M)`, `u ~ uniform[−1, 1]`, **`M = 1.6`** (range ≈ [0.63, 1.6];
  validated — see below); **melody uses a smaller downside** (`u ~
  uniform[−0.4, 1]`, floor ≈ 0.83) — signature-protect
  guardrail, never systematically hide the germ. Applied as a *soft reweight of
  π before MH*: `π'_s = π_s · Π_{inst active in s} b_inst`, renormalised. Soft
  weighting, **NOT a clamp** — all states stay reachable (see seed-identity
  "clamp constants, not paths"). *(v1 uses uniform-in-log; a later refinement
  could concentrate most seeds near neutral with rare strongly-biased ones — a
  [taste] dial, deferred.)*
- **Depth coupling** (mild, §3): `target += k·(activityMean − 0.5)`, k=**0.15
  [taste]** — busy seeds hug fuller. Deliberately weak; may ship at k=0 for v1
  and add later.

## Space-fill coupling (flagship, [ear])

When the active state thins the beat/harmony but keeps melody — states
`drums-out`, `warm`(no melody→n/a), `bass-breather`(no melody→n/a) — i.e. states
where melody is present AND (drums OR chords absent): multiply the melody
scheduler's activity target by **SPACE_FILL ≈ 1.2 [ear]**. Subtle bias on the
existing F1 coupling, never an override. (Only `drums-out` qualifies among
melody-present states with something removed — plus `FULL`-minus edge cases;
keep the rule "melody present + not FULL → mild lift".)

## Mechanism refinement — hybrid, minimal scheduler surface

Muting is done by a **composition-point filter** in `ember.ts` (the A1
mechanism): drop note events whose channel maps to a muted role. Only **melody**
is made mask-aware (the A2 part) — for space-fill + fresh re-entry. So *four*
schedulers stay untouched; only melody is edited. Channel→role map:
`RHODES_CHORD→chords, RHODES_MELODY→melody, BASS→bass, KICK/SNARE/HAT→drums`;
`PAD/BELL(crackle)/ticks/params` always pass.

## Seed children (named — fingerprint-safe)

`arrangement-presence-bias`, `arrangement-frequency`,
`arrangement-energy-fbm`, `arrangement-energy-config`. Named ⇒ existing
schedulers' RNG untouched.

## Validation results (offline, 2000 seeds, 2026-07-09)

Ranges were **measured before build**, not asserted — arrangement character is
pure seed-math (no audio). Harness: `packages/core/scripts/arrangement-validate.ts`
(reusable seed-distinctness metric — the tool the Fable review said we lacked).
Run: `node --experimental-strip-types packages/core/scripts/arrangement-validate.ts`
(build `@loam/core` first). All at the final ranges (M=1.6, λ∈[0.5,0.86], base π):

- **Change frequency** (mean time between any state change): median **~2.1 min**
  @74 BPM; p5–p95 spread **82 s … 260 s** (restless → stable seeds). On the
  ~1–2 min target. → **λ∈[0.5,0.86] validated.**
- **Cross-seed distinctness** (fraction of time each instrument present, across
  seeds): drums [0.43, 0.65], chords [0.57, 0.79], melody [0.47, 0.64], bass
  [0.78, 0.93]; mean pairwise L1 = 0.25. Meaningful per-seed variation (a
  "drummy" seed ~65 % vs a "light" one ~43 %). Bass is near-invariant (~87 %,
  foundational — barely an identity axis, as expected). → **M=1.6 chosen by
  sweep**: bumped from an initial 1.4 (L1 0.18) because 1.4 read too timid;
  1.6 gives ~40 % more spread while staying safe. M≥1.8 starts producing
  "half-time-in-one-state" seeds — the degeneracy ceiling.
- **No degeneracy**: worst single-state occupancy **0.47** (most extreme seed
  still breathes 53 % of the time); time-at-`FULL` [0.23, 0.41], time-at-
  `deep-breather` [0.02, 0.08]. No stuck/broken seeds.
- **Zero drift**: stationary-vs-π' L1 error **~9e-14** — confirms the
  presence-bias-not-Dirichlet design gives each seed its *exact* target
  distribution (the whole point of dropping Dirichlet).

Still ear-only (step 6): whether breathing *feels motivated* (contour→mask),
space-fill subtlety, and the base-π *feel* (structurally it yields 32 % `FULL`
/ 5 % near-silent / ~58 % present — sound, but "right amount" is taste).

## Build sequence

1. **`EngineState` fields** — `phraseBar: number`, `arrangementMask: Set<Role>`
   (or a 4-bool record). Palette + adjacency + fullness + base π as module data
   in `arrangement-controller.ts`.
2. **`ArrangementController` skeleton** — construct with seed children; expose
   `advance(engineFrom, engineUntil)` that maintains the phrase-bar clock;
   **initial state = `FULL`**; for now always writes `FULL` mask (no walk yet).
3. **Wire into `ember.ts`** — construct controller; call `advance` *first* in
   `scheduleUntil` (before chords); apply the composition-point mask filter to
   `raw`. **Gate: `pnpm test` — `ember-engine.test.ts` fingerprint MUST be
   unchanged** (open-at-`FULL` + named children + FULL-mask = no-op). This is
   the fingerprint-safety checkpoint before any behaviour lands.
4. **Numerics** — presence-biased π', MH matrix construction, λ laziness,
   energy contour + tilt (no Dirichlet). Unit-test: stationary of the
   constructed `P'` ≈ π' **exactly** (power-iteration assertion — should hold to
   tight tolerance since no Dirichlet drift); dwell in range; all states
   reachable. Phrase boundary → walk picks next state → mask.
5. **Melody mask-awareness** — read `arrangementMask` from `EngineState`:
   fresh germ phrase on muted→active edge; space-fill activity lift when
   melody-present-and-not-`FULL`.
6. **`listen-check`** on several seeds incl. dense — confirm: breathing feels
   *motivated* (contour-driven, not random — the chord-Markov lesson), dwell
   reads ~1–2 min, no popping, space-fill stays subtle, seeds breathe
   distinctly. Tune `[taste]`/`[ear]` dials.
7. **Close-out** — fingerprint moves *only if* step 3's guarantee is somehow
   broken (it shouldn't); document, update stage-list, collapse this doc to a
   decision-record per the documentation-procedure.

## Acceptance

- Fingerprint unchanged (step 3 checkpoint holds through the build).
- Constructed matrix's stationary ≈ presence-biased π (unit test).
- Dwell ~1–2 min at default λ; every state reachable from every state.
- Only `ember.ts`, `arrangement-controller.ts`, `melody-scheduler.ts`,
  `EngineState`, and seed-children touched — bass/chords/drums schedulers
  unedited.
- Ear: motivated, non-popping, subtle space-fill, distinct per-seed breathing.
