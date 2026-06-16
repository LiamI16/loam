# Current stage — Phase 2: Dynamics

> Phase 1 (Stages 1–4 — foundation, prototype port) is complete and
> archived in `phase1-stage-list.md`.
>
> Phase 2 makes the engine **breathe**. Same seed, sounds different at
> minute 5 vs minute 50 — but in a way that's character-preserving,
> deterministic, and almost never produces a salient moment.
>
> Plan: Stage 5 detailed; Stages 6–10 sketched. Re-plan each one in
> detail when its turn comes — scope will sharpen as Stage 5 lands.
>
> Linked context: `docs/dynamics-brainstorm.md` (the architecture bet),
> `docs/ornaments.md` (Stage 8 spec), `docs/lofi-study.md` §12 (the full
> ~50-knob seed-parameter space).

---

## Stage 5 — Continuous dynamics via fBm ✅

**Noise primitives (`packages/core/src/noise/`)**
- [x] `value-noise.ts` — 1D value noise; hash-on-demand gradients via
      splitmix64, smoothstep interpolation, no period
- [x] `fbm.ts` — sum-of-octaves wrapper, normalized to ~[-1, 1]
- [x] `index.ts`
- [x] Tests: 5 for ValueNoise1D + 5 for Fbm1D, both with locked
      known-sequence determinism contracts

**`ParamStream` abstraction (`packages/core/src/params/`)**
- [x] `param-stream.ts` — `ParamStream` interface, `StaticParam`,
      `FbmParam` (mutable mean, seed-locked depth/baseFreq, optional
      clamps)
- [x] `index.ts`
- [x] Tests: 6 covering both implementations

**Engine wiring**
- [x] `EmberEngine` constructs `FbmParam` streams for `density` and
      `evoCutoffStream` with seed-derived depth/baseFreq
- [x] `MelodyScheduler` uses `densityStream.evaluate(t)` per event
- [x] `EmberEngine.emitContinuousParams()` emits `ParamEvent` on
      `fx.evoFilter.cutoff` every 250 ms with matching `rampMs`
- [x] `setOption('density', v)` updates the FbmParam's mean
- [x] `ResolvedEmberOptions` renamed to `EngineState`; sub-schedulers
      typed accordingly
- [x] Engine determinism contract updated (count 43 → 63 from param
      events; fingerprint at t=0 unchanged)

**Adapter / chain**
- [x] `chains/lofi.ts` removes the static `Tone.LFO` on evo-filter
- [x] `chains/lofi.ts` registers `fx.evoFilter.cutoff` as a `ParamSetter`

**Web demo**
- [x] Document-level `mousedown` handler prevents buttons from latching
      focus on mouse click (keyboard Tab navigation preserved) — fixes
      spacebar getting re-bound to last-clicked button

**Tests:** 45 (up from 29). All green.

**Design assumptions captured:**
- `docs/dynamics.md` (new) — the full implementation surface (primitives,
  ParamStream pattern, per-seed liveliness, tuning record, multi-layered
  determinism contracts, what's NOT in Stage 5)
- `docs/event-protocol.md` §9.6f-g — engine `ParamEvent` cadence pattern,
  `setOption` mean-vs-mute semantics
- `docs/seed-format.md` §7.3a — multi-layered determinism contracts

**Tuning record (kept for posterity — see `docs/dynamics.md` §6 for context):**
- evo-filter depth range bumped 200–600 Hz → 600–1400 Hz after listening
  test ("really hard to tell"). Now exceeds the prototype's ±750 Hz LFO
  swing on the high end.
- density depth bumped 0.06–0.22 → 0.05–0.30 to widen per-seed audible
  difference.

**Bugs surfaced and fixed mid-stage:**
- "setOption('density', 0) suppresses melody" test broke because density
  is now a centerpoint, not a mute. Rewrote the test to assert the
  weaker (still meaningful) invariant: `count(mean=0) < 0.3 × count(mean=1)`.
- Button-focus-latches-spacebar UX bug — fixed with document-level
  `mousedown.preventDefault()` on `BUTTON` targets.

**Done when:** density audibly breathes ✓; evo-filter sweep is fractal
not sinusoidal ✓ (subtle but present, confirmed by user); same seed
reproducible ✓; all green ✓.

---

## Stage 6 (sketch) — Markov chord progressions + voice-leading

Replace the hard-coded 4 progressions with a Markov walk over a wider
chord vocabulary (the full `docs/lofi-study.md` §2 palette). Add a
minimum-motion voicing solver so chord changes have proper voice-leading
regardless of progression choice.

Big lift; dramatically widens the seed space (from "4 starting
progressions × tiny perturbations" to "tens of thousands of
distinguishable harmonic trajectories"). Probably the most musically
impactful single stage.

## Stage 7 (sketch) — Lorenz macro mood

A single Lorenz attractor sampled per phrase, providing slow 3D state
that biases everything else. Lobe selects which Markov chord matrix is
active (Nujabes-y vs sad-lofi vs bossa-leaning); other coords modulate
fBm depths and ornament rates. The "weather" layer from
`docs/dynamics-brainstorm.md` §3.

## Stage 8 (sketch) — Ornament process

Implement the Cox + refractory point process from `docs/ornaments.md`
for subtle salient events. Per-type inhibitory rates prevent any single
ornament from repeating too quickly. Free `Channels.BELL` from its
temporary crackle reuse and give it its actual bell-tone semantics.

## Stage 9 (sketch) — L-system melody contours

Replace the pure-Bernoulli melody with L-system-driven phrase shapes.
Adds melodic coherence without melodic hooks — phrases have arc rather
than being a sequence of independent random notes.

## Stage 10 (sketch) — CA drum drift

Cellular-automaton-style mutation of the drum grid bar-to-bar so the
beat varies imperceptibly while keeping the boom-bap skeleton intact.

---

## Open scope questions

These could be addressed during Phase 2 or punted to Phase 3+:

- **Engine-driven warmth** — currently warmth is a user slider only.
  Adding fBm motion to it requires resolving the "user slider vs engine
  ParamEvent" conflict (both write to `master.warmth`). Probably a Stage
  6/7 thing once the pattern is proven on density + evo-filter.
- **Engine-driven master volume** — same conflict pattern. Punt.
- **Python validation harness** — render N minutes of a seed offline,
  FFT-check that fBm-driven parameters hit a 1/f spectrum. Build-time
  tool per the spec's "Python authors, TS performs" rule. Useful
  insurance once the dynamics layer is non-trivial; not urgent for
  Stage 5.
- **Track transitions** - currently, transitions are audibly abrupt. 
  Determine how to smoothly transition from one track to another. 
