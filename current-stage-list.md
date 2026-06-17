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

## Stage 6 — Markov chord progressions + voice-leading ✅

**Harmony module (`packages/core/src/engines/ember/harmony/`)**
- [x] `chords.ts` — 15-chord vocabulary as `{ rootPc, intervals, quality }`.
      Diatonic to C major / A minor + `Fm6` and `Bbmaj7` borrowed colors.
- [x] `markov.ts` — sparse `HAND_MATRIX` (hand-tuned per `lofi-study.md`
      §3) + `MarkovChordWalk` class with `peek()` / `next()`.
- [x] `dirichlet.ts` — `perturbMatrix(prior, rng, {alpha})`. Marsaglia–
      Tsang gamma + Box–Muller normal + Stuart reduction for α<1.
      Stage 6 default α=20 (subtle-but-audible).
- [x] `voicing.ts` — pure `voiceChord(prev, chord)` solver. Common-tone
      retention + greedy nearest-pitch in register E3–E5.
- [x] `index.ts`

**Engine wiring**
- [x] `EngineState.currentChord` added (mutated by ChordScheduler, read
      by MelodyScheduler filter).
- [x] `ChordScheduler` rewritten: Markov walk + Dirichlet (seed children
      `markov-config`, `markov-walk`) + voicing solver replace the static
      `PROGRESSIONS` pick + `voiceChord` alteration.
- [x] Pad root computed from `chord.rootPc + 36` (bass-register anchor)
      instead of voicing[0]; root+fifth pattern preserved.
- [x] `MelodyScheduler` blacklists pentatonic notes a semitone away
      from any chord tone; falls back to chord tones in pentatonic's
      register if filter empties. **Marked WIP — Stage 9 supersedes.**

**Tests:** 60 (up from 45). All green.
- 4 Markov tests (locked 16-chord walk + same-seed + reachability + start)
- 5 Dirichlet tests (locked Am7 row at α=20 + same-seed + sum-to-1 +
  support-preserved + α-monotonicity)
- 5 voicing tests (seed voicing + register bounds + common-tone retention
  + greedy octave + ascending output)
- Chord scheduler test updated for new module surface; engine fingerprint
  count unchanged (63) but first 6 events now reflect `Am7` start.

**Design assumptions captured:**
- `docs/harmony.md` (new) — full Stage 6 implementation surface (vocab,
  Markov shape, Dirichlet sampler, voicing algorithm, melody-filter WIP).
- `docs/seed-format.md` §7.3a extended — two new locked-sequence layers.

**Open knobs (tune by listening test as data accumulates):**
- Dirichlet α=20 (Stage 6 default). Bump higher → seeds harmonically
  similar; lower → seeds diverge harder. Subjective.
- `HAND_MATRIX` weights — biased per §3 but not validated against a
  corpus. Python study (e.g. Hooktheory mining) deferred to Stage 7+.

**Done when:** Markov + Dirichlet produce reproducible per-seed
harmonic trajectories ✓; voicing solver gives audibly smooth voice-
leading ✓; melody no longer fights the wider harmony ✓; all green ✓.

## Stage 6.5 — Speed multiplier ✅

A user-facing wall-clock playback scale. `EmberOptions.speedMultiplier`
(default 1.0, clamped ≥ 0.1). Live-mutable via `setOption`. Scales
emitted timestamps and durations only — pitches, sequence, and
determinism are byte-identical at `mult=1.0`.

**Engine wiring (`packages/core/src/engines/ember/ember.ts`)**
- [x] New `speedMultiplier` option + private engine field.
- [x] Dual cursors: `engineCursor` (musical time, sub-schedulers see)
      and `audioCursor` (wall-clock time the caller sees).
- [x] `scheduleUntil(audioUntil)` maps to `engineUntil` via the
      multiplier, runs sub-schedulers untouched, then scales emitted
      `time` / `durationMs` / `rampMs` by `1/mult` before returning.
- [x] `setOption('speedMultiplier', v)` clamps and applies — in-flight
      events keep old scaling, subsequent emissions use new scaling.
- [x] `getOptions()` reports current multiplier.

**Web demo (`apps/web-demo/`)**
- [x] Speed slider (0.5×–2.0×, default 1.0×) in the controls strip.
- [x] `buildEngine` reads the slider so reseeds preserve the user's
      speed choice.
- [x] **BPM slider removed.** Functionally redundant with the speed
      multiplier (this engine fully synthesizes notes; BPM changes
      and speed scaling produce identical observable output). Engine
      BPM is now a hidden constant (`ENGINE_BPM = 74`) — will become
      seed-derived in a future small task so each seed has its own
      home tempo. User-facing tempo control is the speed slider only.

**Tests:** 64 (up from 60). All green.
- `speedMultiplier=1.0` byte-identical to default.
- `speedMultiplier=2.0` halves all timestamps + durations; pitches /
  channels / param targets unchanged.
- Live `setOption('speedMultiplier', 0.5)` mid-stream — first batch
  stays below the audio boundary, second batch continues past it.
- Out-of-range multiplier clamps to MIN_SPEED (0.1) rather than
  throwing.

**Why this architecture (engine-wrapper scaling, not sub-scheduler change):**
- Sub-schedulers see only musical time — no per-event tempo reads, no
  cached step-size invalidation, no determinism-contract drift.
- Locked sequences (Markov walk, Dirichlet, voicing, drum grid,
  engine fingerprint) all stay valid because the engine generates the
  same events at the same engine-time; only the wrapper rescales.
- Live mutation has clean semantics: the engine never replays already-
  emitted events at a new scale, so there's no audible glitch beyond
  what a normal user slider implies.

**Why this lands before Stage 7:** Stage 7 will need careful listening
tests for the position-space drift. Having a working speed slider
means we can audition slow drift at faster wall-time, accelerating
the tuning loop. Also gives users a knob to escape "this feels too
slow" without us having to commit on a base BPM.

**Done when:** slider audibly speeds/slows the engine ✓; locked
sequences untouched ✓; demo build green ✓.

---

## Stage 7 (sketch) — Position-space drift + listen-distance fBm

> Re-scoped during Stage 6/6.5 planning (2026-06-16). Original "Lorenz
> macro mood" sketch parked in favor of the framing below — see
> conversation history for the design discussion.

A single slow 2D position vector wanders through a seed-defined
parameter landscape, biasing musical surfaces. Driver = two independent
slow fBm streams (Option A — reuses Stage 5 `FbmParam`). No lobe /
regime behavior; continuous smooth drift only (the "cafe music" goal:
chosen vibe + internal exploration + no audible transitions).

**Position biases (Stage 7 scope):**
- **Voicing register center** — slowly drifts the per-seed register
  the voicing solver targets. Trivial — the solver already takes a
  register; just make it time-varying.
- **Mode** — same tonic, different scale degree alteration (Aeolian ↔
  Dorian ↔ Phrygian ↔ Lydian ↔ Mixolydian). Harmony module gains a
  concept of "current mode"; chord vocabulary indexed by mode.

**Listen-distance fBm extension:** more channels of slow drift on
effect / mix parameters layered on top of the position substrate
(reverb wet, stereo width, instrument balance). Cheap perceptual
variation, lives on top of the structural drift.

**Deferred to Stage 7.5:** key drift with pivot-chord modulation
(requires real music-theory work to keep transitions smooth).

## Stage 8 (sketch) — Ornament process

A single Lorenz attractor sampled per phrase, providing slow 3D state
that biases everything else. Lobe selects which Markov chord matrix is
active (Nujabes-y vs sad-lofi vs bossa-leaning); other coords modulate
fBm depths and ornament rates. The "weather" layer from
`docs/dynamics-brainstorm.md` §3.

## Stage 7.5 (sketch) — Key drift with pivot-chord modulation

Extend Stage 7's position-space to also bias the key center
(transposition). Hardest of the position-bias surfaces because raw
key changes mid-progression sound abrupt — needs pivot-chord
modulation logic that times the change to land at a chord common
to both keys. Punted from Stage 7 so the substrate can be auditioned
without the music-theory complexity.

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

---

## Phase 3+ candidates (parked, not committed)

Ideas surfaced during planning that have real merit but were judged
too large / too music-theory-heavy / too architecturally divergent
for Phase 2. Revisit when Phase 2 lands.

- **Theme-and-variations on an invisible germ.** Seed generates a
  tiny musical germ (e.g. a 3-note interval shape + a chord pair).
  Every chord progression, melodic phrase, and voicing the engine
  produces is a *variation* on this germ — never played literally,
  never consciously recognized by the listener, but the secret
  unifier behind every utterance. Vibe = the germ; exploration =
  how it gets rephrased. Closer to how Beethoven's late quartets
  work than to statistical methods. Hard: requires real "is this
  passage a variation of the germ?" music theory, not just
  parameter tuning. Considered and parked during Stage 7 planning
  (2026-06-16) in favor of the position-space + listen-distance
  combo. Worth revisiting after Phase 2 — could be the deepest
  coherence mechanism the engine has.
