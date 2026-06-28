# Dynamics & Transitions — Brainstorm

> **Companion to `docs/dynamics.md`** (which documents what's actually
> built). This doc is the *strategy* — generator primitives, why we
> layer them by timescale, the attractor idea. Read this for design
> intent; read `dynamics.md` to map decisions to code.

> The core bet of the project. "Infinite" is easy (loop forever). "Always
> changing without character drift and without *moments*" is the actual hard
> problem. This is exploratory — capturing the design space, not committing.

---

## 0. Framing the problem

The musical surface needs to **evolve continuously** so a 2-hour session never
feels like the same 4 bars looped 200 times. But it also has to:

1. **Almost never produce a salient moment.** No drops, no fills, no melodic
   hooks. Habituation is the default goal — but a vanishingly thin layer of
   subtle ornaments is *desirable*, otherwise the music tips from
   *unobtrusive* into *soporific* and stops doing its job. The rate is a
   tunable knob, not zero. Mechanics live in `docs/ornaments.md`.
2. **Stay inside the character envelope** the seed picked — a Nujabes-flavored
   session never drifts into a synthwave session by minute 40.
3. **Be deterministic from the seed** — same seed, same output, byte for byte,
   for shareability.
4. **Be computable in real time** in a browser audio thread.

So the architecture has to give us **bounded, character-preserving, locally
smooth, globally surprising, deterministic** parameter trajectories.
That's a tall stack of adjectives. None of the candidate primitives below
hits all five alone — the trick is layering them.

A useful framing: **everything in this engine is a particle moving through a
parameter landscape**. The seed paints the landscape (hills, valleys,
basins). The dynamics choose how the particle moves. We need landscapes that
have *character* (basins where the particle lingers = recognizable feel) and
movers that are *coherent on short scales but exploratory on long ones*.

---

## 1. Generator primitives — what each one is actually good for

A taxonomy of candidate dynamical sources, with what each one's *shape*
naturally gives you.

### 1.1 Seeded PRNG (xorshift, PCG)
- **Shape:** uniform, memoryless, no correlation between samples.
- **Good for:** breaking ties; per-event jitter (velocity humanization, micro
  timing); seeding everything else.
- **Bad for:** anything you want to *evolve*. Two adjacent samples have zero
  relationship, which sounds like white noise on whatever it controls.
- **Verdict:** the substrate, not a feature in itself.

### 1.2 LFSR / cycle generators
- **Shape:** deterministic, periodic with very long period (2^n - 1 for n-bit),
  but locally indistinguishable from random.
- **Good for:** "repeats but you'd never notice" — perfect for a session-long
  texture trigger sequence (e.g. when does the vinyl crackle fire).
- **Bad for:** anything that needs smoothness. Output is bit-twiddling.
- **Verdict:** niche but useful — replaces a PRNG when you want guaranteed
  non-clustering.

### 1.3 Perlin / Simplex / fBm noise
- **Shape:** smooth, locally continuous, multi-scale (fBm = sum of octaves at
  doubling frequencies and halving amplitudes).
- **Good for:** **continuous parameters** — filter cutoff, melody density,
  texture levels, voicing register. fBm naturally approximates a 1/f spectrum,
  which the handoff explicitly calls out as the target.
- **Bad for:** discrete decisions. You have to threshold or quantize, and the
  thresholding is where boredom can creep in (always crosses zero at the same
  amplitude).
- **Verdict:** **default for every continuous knob**. Each knob gets its own
  noise seed and its own evolution rate.

### 1.4 Pink (1/f) noise directly
- **Shape:** equal energy per octave; the Voss-Clarke "musical" spectrum.
- **Good for:** macro envelopes that need to feel "alive" but never settle.
  Density envelopes, pad swells, dropout probability.
- **Same family as fBm** — fBm is one way to *synthesize* 1/f. Worth thinking
  of them together.

### 1.5 Random walks / Brownian motion
- **Shape:** unbounded drift, increments are independent.
- **Problem:** unbounded → the particle wanders off-character given enough
  time. Needs a **restoring force** (Ornstein-Uhlenbeck process: a random walk
  pulled back toward a mean). OU is a great default for "this parameter should
  fluctuate but live near X."
- **Verdict:** OU process is underrated. Use it when "fBm noise around a
  centerpoint" is the actual intent.

### 1.6 Markov chains
- **Shape:** discrete state + transition matrix. Memoryless (order-1) or with
  context (order-k / variable-order).
- **Good for:** **discrete choices with character** — which chord comes next,
  which voicing archetype, which drum pattern. The transition matrix *is* the
  character.
- **Bad for:** continuous parameters; lack of long-range structure. Standard
  fix: hierarchical Markov (higher level switches which sub-matrix is active).
- **Verdict:** the right tool for the chord-progression and voicing layers.
  Hand-craft the matrices per subgenre archetype (or learn them offline in
  Python, ship the JSON — that's exactly the "Python authors, TS performs"
  pattern from the spec).

### 1.7 Hidden Markov Models
- **Shape:** Markov chain over *hidden* states, with emission distributions.
- **Good for:** "the music has an internal mood (hidden) that biases what
  emits." The mood drifts on its own slow Markov chain; current mood selects
  which chord-transition table is active.
- **Verdict:** elegant way to formalize "slowly shifting harmonic basin."

### 1.8 Mathematical attractors (Lorenz, Rössler, logistic, Hénon, Ikeda, Duffing)
- **Shape:** continuous-time (or discrete-time) dynamical systems whose state
  traces out a fractal in phase space. State revisits regions but never
  repeats. Bounded, deterministic, chaotic.
- The exciting property: **basins / lobes / wells**. A Lorenz trajectory
  spends time in one lobe of the butterfly, then unpredictably switches.
  That's not random — that's *thematic with variation*, which is exactly the
  musical behavior we want.
- **Good for:** macro "mood" or "weather" — a slowly-evolving 2- or 3-D vector
  whose components bias the rest of the engine.
- **Bad for:** anything direct. Mapping Lorenz to pitch is the classic
  trap-it-sounds-aimless mistake the handoff already warns about.
- **Verdict:** **this is the headline idea.** See §3 for how to actually
  integrate it.

### 1.9 L-systems / grammars
- **Shape:** recursive symbol rewriting (Lindenmayer). Produces nested
  self-similar sequences.
- **Good for:** **melodic phrase shape** — generate a phrase as a string of
  motifs that gets rewritten over time. Self-similarity is musically coherent;
  variation comes from rewrite rule mutation.
- **Verdict:** worth prototyping for melodic contour. Use a small alphabet
  (up/down/hold/jump) rather than note names.

### 1.10 Cellular automata
- **Shape:** local rules on a grid, can produce complex global patterns.
- **Good for:** **rhythm grids**. A 16-step drum row treated as 1D CA evolves
  bar-to-bar with controlled mutation rate. Rule selection and birth/death
  density become character knobs.
- **Verdict:** great for drum drift; less obvious for harmony.

### 1.11 Euclidean rhythms (Bjorklund)
- **Shape:** maximally even distributions of N hits in M steps. Captures the
  rhythm of dozens of world-music traditions, including the relevant ones for
  lofi.
- **Good for:** generating a pattern family from `(hits, steps, offset)`
  triples. Three integers → an interesting groove.
- **Verdict:** ideal for non-kit percussion layers (shaker, rim, tambourine).

### 1.12 Genetic / evolutionary drift
- **Shape:** maintain a population of patterns/voicings, mutate slowly, no
  selection (or weak selection toward character).
- **Good for:** session-scale evolution where today's voicings descend from
  this morning's.
- **Verdict:** more architecturally heavy than it needs to be for v1; revisit
  if simpler mechanisms feel static.

### 1.13 Reservoir / echo-state systems
- **Shape:** untrained recurrent network as a high-dimensional dynamical
  reservoir.
- **Verdict:** overkill for v1, but a natural growth direction if the "ML
  later, maybe" path is ever taken.

---

## 2. Timescales — the architectural skeleton

The single most important design decision: **different timescales get
different generators**. Driving everything from one source is the failure mode.

| Timescale | Period | Examples | Best generator family |
|---|---|---|---|
| **Sample** | µs | Anti-alias, dithering | PRNG |
| **Event** | 10–500 ms | Velocity, micro-timing, note jitter | PRNG / OU |
| **Beat / 16th** | 100–800 ms | Ghost hits, crackle triggers, ornament chance | Bernoulli + LFSR |
| **Bar** | 2–4 s | Drum pattern mutation, voicing re-spell | Markov / CA |
| **Phrase** | 8–32 s | Chord change, melody phrase pickup | Markov over chord graph |
| **Section** | 30–120 s | Density envelope, instrument swap-ins, pad change | fBm / pink noise |
| **Macro** | 2–10 min | Mood / mode bias, progression set, subgenre tilt | Attractor (Lorenz/Ikeda) — slow sampled |
| **Session** | 30 min+ | Hidden HMM state for full harmonic basin | Discrete Markov over archetypes |

The rule: **a parameter is driven by exactly one source at its own
timescale**, and slower sources *bias* faster ones (set their distributions),
they don't override them. A bar-level Markov doesn't yank the chord; a
macro-level attractor reshapes the bar-level Markov's transition probabilities.

This gives you nested coherence: instantaneous decisions feel natural because
they're sampled from a distribution that itself moves smoothly; the macro
shape evolves because the distributions themselves slide.

---

## 3. The attractor idea — concretely

The user's intuition is good. Here's a way to integrate it that doesn't fall
into the "chaos → pitch = aimless noodling" trap.

### 3.1 What an attractor actually gives you

Run, e.g., a Lorenz system continuously in the background:
```
ẋ = σ(y − x)
ẏ = x(ρ − z) − y
ż = xy − βz
```
With standard σ=10, ρ=28, β=8/3, the state (x, y, z) traces the famous
butterfly. Sample it at a very slow rate (say once per bar, or once per 4
bars). You now have a deterministic, bounded, never-exactly-repeating 3D
trajectory.

**The interesting structural property:** the trajectory has two lobes. It
orbits one lobe for a while (often many sampled steps), then unpredictably
jumps to the other. The dwell-time distribution is heavy-tailed. *That* is
the musical behavior you want — long stretches of stable character punctuated
by unpredictable but undramatic shifts.

### 3.2 How to map without making it aimless

**Don't** map attractor coordinates → notes. Map them → *biases on
distributions used by other layers.* Specifically:

- `x` (sign) → which lobe of harmonic mood we're in (e.g. "warm" vs
  "melancholy") → selects which chord-transition Markov matrix is active
- `y` (magnitude) → melody density gain (multiplier on the existing density
  slider)
- `z` → texture profile mix (cassette ↔ vinyl)

Because the attractor is *bounded* and *smooth almost everywhere*, the biases
move continuously most of the time and occasionally cross a threshold (lobe
switch) that nudges a discrete choice. The discrete choice happens at a bar
boundary anyway, so it's invisible.

### 3.3 Why "wells" is the right intuition

A strange attractor's geometry is exactly a set of *wells* the state visits.
A logistic map at r≈3.83 has a chaotic but heavily clustered output — there
are "preferred" regions. Map the dwell-regions to your character archetypes
and the engine naturally lingers in each, with seed-determined timing.

### 3.4 Which attractor for which job

| Attractor | State dim | Character | Use for |
|---|---|---|---|
| **Logistic map** | 1 | 1D, tunable from periodic (r<3.57) through chaos via period-doubling | A single "mood" parameter with adjustable predictability |
| **Lorenz** | 3 | Two-lobed switching, classic | Macro mood; "which harmonic basin" via lobe sign |
| **Rössler** | 3 | Smooth single-loop with rare excursions | Pad evolution, slow texture |
| **Hénon** | 2 discrete | Discrete-time, sharp fractal | Bar-level discrete choices (next voicing archetype) |
| **Ikeda** | 2 discrete | Multiple basins of attraction | "Which subgenre microregion" |
| **Duffing** | 2 | Forced oscillator, period-doubling | Tempo or swing micro-drift |
| **Chua's circuit** | 3 | Double-scroll, like Lorenz with different geometry | Alternative to Lorenz |

A nice property: you can **couple** two attractors weakly (one's state
perturbs the other's parameters) and get higher-dimensional behavior without
explicitly hand-designing it. Risky, fun.

### 3.5 Implementation realities

- Use a fixed-step integrator (RK4 or even just Euler at fine step) — the
  audio thread doesn't run the attractor, a slow timer does.
- Numerical chaos means tiny floating-point variations between machines could
  diverge after enough steps. For "same seed → same output everywhere," either
  store the trajectory as discrete states with deterministic arithmetic, or
  accept that the divergence is over long enough timescales to be musically
  irrelevant. Probably the latter for v1.
- The attractor is **state**, so it has to survive pause/resume if we want
  exact reproducibility. Easy — it's three floats.

---

## 4. Per-layer dynamics — what drives what

A first-pass mapping. Numbers are illustrative.

### 4.1 Chord progression
- **State:** current chord, current progression slot.
- **Dynamics:** Markov chain over chords in the active mode. Transition matrix
  is keyed by macro mood (HMM hidden state, attractor lobe). Most weight on
  diatonic neighbors; small weight on borrowed/secondary-dominant moves; tiny
  weight on "swap to a different progression entirely" (modal pivot).
- **Why:** Markov captures voice-leading expectation (ii tends to go to V),
  which is the genre's grammar. Mood bias means a session that started
  Nujabes-flavored stays in that neighborhood.

### 4.2 Voicing
- **State:** current voice positions (4–5 pitches).
- **Dynamics:** voice-leading solver — given next chord, pick voicing that
  minimizes total motion from current voicing (or relax to "smoothest of N
  candidates"). Each bar, small probability of injecting a chromatic approach
  or swapping voicing archetype (rootless ↔ quartal).
- **Why:** smooth voice leading is the single most "professional-sounding"
  gesture in jazz piano. Procedural minimum-movement gives it for free.

### 4.3 Melody
- **State:** previous note, current phrase position.
- **Dynamics:** two layers. (a) Phrase shape from a small L-system over an
  abstract alphabet (up-step, down-step, repeat, rest, jump). (b) Per-note
  pitch quantized to the legal scale subset, biased by current chord tones
  and previous-note proximity (smooth contours win). Density and silence
  probability driven by a slow fBm envelope.
- **Why:** L-system gives phrase coherence without melodic hooks. The
  quantization-to-legal-scale is the "music theory disposes" safety rail.

### 4.4 Bass
- **State:** active bass pattern archetype.
- **Dynamics:** pattern-archetype Markov (slow — typically the same archetype
  for many bars). Within an archetype, small per-note jitter (octave jumps,
  glide insertions) driven by Bernoulli with probabilities set by macro
  density.
- **Why:** bass character defines genre more than people realize. Cheap to do
  well, cheap to do badly.

### 4.5 Drums
- **State:** 16-step grid for kick / snare / hat / percussion.
- **Dynamics:**
  - Base grid from a small pattern bank (chosen at session start, swappable
    every N bars with low probability).
  - **CA-style mutation per bar:** each step independently flips/holds with
    low probability, weighted toward keeping the genre-defining hits (kick on
    1, snare on 3) immutable and letting hats / ghosts mutate freely.
  - **Velocity layer:** OU process per voice — fluctuates but lives near a
    target mean. Snare timing offset from another OU pulled toward "behind
    the beat."
  - **Percussion layer:** Euclidean rhythm generator with parameters
    `(hits, steps, offset)` drifting on slow fBm.
- **Why:** drums are the easiest place to introduce surprise-without-event:
  a single ghost hat appears bar 47 and vanishes bar 49 and nobody notices,
  but the pattern feels alive.

### 4.6 Texture / FX
- **State:** levels of wow, flutter, crackle, hiss, saturation, warmth, rain,
  reverb wet, etc.
- **Dynamics:** every effect gets its own independent fBm noise source at its
  own (slow, randomized) rate. Macro attractor optionally biases groups — e.g.
  "high `z` → cassette profile dominant → biases wow/flutter/hiss up,
  bitcrush down."
- **Why:** orthogonal slow movement on many channels = the "always slightly
  different but never new" feel.

### 4.7 Form-scale evolution
- **State:** which progression set is active, which subgenre tilt, current
  hidden mood.
- **Dynamics:** session-scale HMM with hand-tuned transition probabilities
  that strongly favor staying. Attractor lobe-switch can be one trigger; pure
  Markov roll can be another.
- **Why:** explicit, controllable, low-frequency. The only place we *want*
  occasional discrete decisions, because they're spaced minutes apart.

---

## 5. Transition mechanics — how a change happens *without being noticed*

The dynamics generate target values. The transition layer decides how the
system moves from old to new. Several techniques compose:

- **Always ramp, never jump.** Every continuous parameter has a fixed
  smoothing time constant (often hundreds of ms or seconds). Tone.js's
  `rampTo` is the basic primitive.
- **Phase-lock changes to bar boundaries.** Anything discrete (chord change,
  pattern swap) happens on a downbeat, never mid-bar.
- **Stagger correlated changes across bars.** When the macro mood flips, the
  consequences propagate over many bars: chord matrix swaps now, voicing
  archetype next phrase, drum pattern two phrases later. Listener never sees
  the "moment of change," only the after-state.
- **Mask discrete changes behind continuous ones.** The slow filter sweep is
  already moving; route a chord-set swap to land at the cutoff's low point so
  the spectrum is muted during the swap.
- **Probability injection over hard switching.** Don't set "now use chord
  matrix B." Instead crossfade weights from A to B over 16 bars: each new
  chord is drawn from the blended matrix. The transition is *statistical*,
  not instantaneous.
- **Hysteresis on lobe switches.** Add dead-band so the attractor doesn't
  rapidly flip back and forth across a threshold. Schmitt-trigger style.
- **No symmetric returns.** If something fades out, it doesn't reappear
  identically a minute later — listeners notice symmetry. Drift the return
  state slightly.

The collective rule: **the engine never tells the listener that something
changed.** They look up after 15 minutes and notice it sounds different,
without being able to name when.

---

## 6. The character envelope — preventing drift

Bounded dynamics within character is the constraint we keep coming back to.
Some safeguards:

- **Restoring forces.** OU instead of random walk everywhere it matters. The
  particle wobbles around a centerpoint instead of escaping.
- **Hard scale-quantization.** Pitch always falls onto the locked scale. No
  amount of attractor drift can produce a wrong note.
- **Clamped ranges.** Every parameter has min/max. Noise that wants to
  exceed them gets clipped (with soft-clip so the texture doesn't break).
- **Seed-paint the landscape, run the same particle.** The seed determines
  *which* attractor parameters, *which* Markov matrices, *which* archetype
  bias, *which* fBm seeds. The dynamics then play within that fixed scenery.
  This is the architectural separation: seed = landscape, dynamics = motion.
- **Genre invariants as veto layer.** A final pass that rejects any
  generated outcome that violates a hard rule (e.g. "kick on beat 1 is
  immutable for this archetype"). Cheap insurance against the rare bad roll.

---

## 7. What's worth prototyping first

Personal opinion, for triage:

1. **fBm noise on all continuous knobs** — biggest improvement per line of
   code over the current prototype. The existing 40s LFO becomes one of a
   dozen independently-evolving slow shapes.
2. **Markov chord transitions + voice-leading solver** — replaces the
   `rand(PROGRESSIONS)` swap. Adds variation that *still sounds intentional*
   because the matrix encodes voice-leading expectation.
3. **Lorenz/Ikeda macro mood driver** — one attractor, sampled once per phrase,
   biasing the Markov matrices. This is where the "wells" feeling shows up
   and where the engine starts to feel *alive* rather than *random*.
4. **L-system melody contour** — orthogonal to the above; can come later but
   high upside for replacing the current pure-Bernoulli melody.
5. **CA drum mutation** — straightforward, high-variance bang per buck.

Items 1–3 plus the current synth chain probably get us 80% of the way to
"two-hour session that feels alive." 4–5 are the texture variety pass.

---

## 8. Open questions

- **How deterministic do we want to be?** Bit-exact reproducibility (no
  floating-point chaos) is harder and constrains the attractor implementation;
  "qualitatively the same character" is much easier. Probably accept
  qualitative determinism for v1 — the seed picks the *landscape* exactly, the
  particle's exact path is allowed to be machine-precision-dependent.
- **Trained vs hand-tuned Markov matrices.** Training on a MIDI corpus is the
  cleanest way to get authentic chord transitions, but adds a Python build-time
  pipeline. Hand-tuning a few archetype matrices is fast and ships sooner.
  Probably hand-tune for v1, leave hooks for trained matrices later.
- **Per-archetype dynamics, or one engine with archetype-biased parameters?**
  Cleaner if there's one set of dynamics and archetype = parameter preset.
  Worth enforcing as a design constraint even if it costs a little expressive
  range.
- **How exposed is the dynamics layer to the user?** Probably: not at all in
  v1 UI. Seed picks everything. Power users get a JSON config later.
- **Verification.** How do we test that a 2-hour run *actually* has 1/f
  spectrum on its macro parameters and no salient events? Build-time Python
  job: render, analyze, plot. This is the "Python authors, TS performs"
  pattern from the spec applied to validation, not generation.
