# Arrangement controller — design (ACTIVE)

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
  (self-loop weights). **Per-seed identity = the seed sets the weights**, via
  Dirichlet perturbation of a universal base matrix (not free/categorical) plus
  a per-seed per-instrument **presence-bias vector** mapping onto state weights
  — so per-instrument personality (this seed's drums are often absent) emerges
  from C1's weighting, capturing C2's benefit without its illegal-combo /
  scene-cut risk. Chosen over C2 (independent per-instrument presence), which
  reintroduces the random-feel + floor-policing we already paid to remove.
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
