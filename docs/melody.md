# Melody design

> Load-bearing design decisions for the melody scheduler. Sections
> added incrementally during foundational discussions. Each section
> captures the decision *and* the reasoning so future sessions know
> why we landed where we did and what alternatives were rejected.
>
> Implementation derives from this doc, not the other way around.

## Why melody design is load-bearing

Melody is the **single most identity-load-bearing layer in the
engine.** Motifs are catchy by definition — when listeners point at
a seed and say "I recognize that one," they're pointing at the
melody. This makes melody design more identity-critical than
chord design ever was.

It's also the largest unexploited per-seed identity axis in the
engine. Chord-layer identity is already strong via the eight-axis
stack (BPM, register, chord-Markov, archetypes, pattern weights,
pattern matrix, activity shape, slot-bias shape). Melody currently
has none of this richness — pentatonic Bernoulli draws with no
memory. Filling that gap is the highest-leverage identity work left.

The seed-identity framework (`docs/seed-identity.md`) applies in
full. Every per-seed parameter introduced here must specify its
universal rule, fBm stream, per-seed shape, optional couplings,
and mix bias relationship.

---

## F1 — Role of melody + chord-melody coupling (decided 2026-06-21)

### Role

Melody is a **foreground lead voice** in the mix (already at −9 dB
vs chord at −13 dB after the chord/melody synth split), but it is
also **sparse by design**. Silence is melody's primary tool. The
listener follows the melody when it's there; when it's absent, the
chord layer carries.

This is genre-correct for calm-lofi study music (Idealism /
Tomppabeats / j'san reference) and matches what real ensembles do:
the lead voice has authority but doesn't fill every bar.

Three role-modes were considered:

- **A — Lead voice playing through most slots.** Rejected for
  calm-study fit: continuous foreground melody is attention-grabbing
  and inappropriate for sustained focus.
- **B — Counterweight / breathing partner.** Melody enters when
  chord pulls back. *This is the genre-correct default behaviour.*
- **C — Always-present subtle voice.** Continuous low-intensity
  melody, never grabbing attention. Genre-valid but limits motivic
  expression.

**Decision: not a discrete choice. B and C are endpoints of a
per-seed continuum, with coupling strength as the dial.** Some
seeds lean strongly antiphonal (B-like); others lean more
independent (C-like). No seed is purely one or the other — all
seeds have some chord-awareness AND some independent melodic
identity.

### Chord-melody coupling — the min-cap formula

Melody has its own activity stream (universal §1, per-seed shape
§2). The coupling parameter modulates how much chord activity
suppresses melody activity. The formula:

```
effective_melody_activity =
    (1 − coupling) · melody_activity
  + coupling · min(melody_activity, 1 − chord_activity)
```

This is the **min-cap blending** formula — the "share the acoustic
space" model.

**Edge cases:**

- `coupling = 0`: `effective = melody_activity` (fully independent,
  C-mode behaviour).
- `coupling = 1, chord_activity = 0`: `effective = melody_activity`
  (melody plays freely in chord rests).
- `coupling = 1, chord_activity = 1`: `effective = 0` (silenced
  when chord fully busy).
- `coupling = 0.5, chord_activity = 0.5, melody_activity = 0.3`:
  `effective = 0.3` (chord wasn't crowding, melody plays its own
  quietness).

The key property: **melody plays as it wants UNLESS chord doesn't
leave space.** A sparse-melody seed stays sparse at any coupling
value because chord activity only matters when it crowds. This
preserves per-seed melody character (most importantly: the seed's
density signature) at every coupling value.

### Rejected formulas + reasoning

Six alternatives considered. Recorded for completeness so future
sessions don't relitigate.

**Alt — Pure inverse blending** (the first formula attempted):
```
effective = (1−c) · melody_activity + c · (1 − chord_activity)
```
At `c = 1`, melody's own activity is completely overridden by
inverse-of-chord. Rejected: erases per-seed melody identity at
high coupling.

**Alt — Multiplicative suppression:**
```
effective = melody_activity · (1 − coupling · chord_activity)
```
Mathematically equivalent to a two-stage probabilistic decision
("decide what to play, then yield to chord"). Always proportionally
reduces melody — even when chord has plenty of room. Sparse-melody
seeds get *further* suppressed at coupling > 0 even in chord-quiet
moments. Min-cap preserves per-seed density character better; this
formula homogenises seeds toward "even sparser when coupled."

**Alt — Additive suppression:** `effective = melody_activity − coupling · chord_activity`
(clamped). Sharp cutoffs; sparse melodies get fully silenced even
at moderate chord activity. Rejected.

**Alt — Exponential / Boltzmann:**
```
effective = melody_activity · exp(−K · coupling · chord_activity)
```
Extra parameter K; nonlinearity hard to reason about musically.
Doesn't provide meaningful musical benefit over min-cap.

**Alt — Slow-mean modulation:** coupling drifts melody-activity's
*mean* over minutes rather than reacting per-emission. Removes the
bar-by-bar "fill the silence" feel. Rejected: doesn't deliver the
antiphonal call-and-response intent.

**Alt — Phase coupling (the most-considered alternative):**
```
chord_activity(t) = chord_baseline · 0.5 · (1 + cos(θ_c(t)))
melody_activity(t) = melody_baseline · 0.5 · (1 + cos(θ_m(t)))

effective_melody = melody_baseline · 0.5 ·
    (1 + (1−c)·cos(θ_m) − c·cos(θ_c))
```
Where θ_c, θ_m are fBm-driven angles on the unit circle.

Mathematically elegant. Cyclic streams (no clamping artefacts).
Symmetric coupling. Generalises to 3+ voices via phase
relationships. Was extensively considered as a possible foundation
for counter-melody work.

**Rejected for six musical reasons** despite the elegance:

1. **Eliminates mutual silence at high coupling.** Phase coupling
   forces melody active when chord is quiet — they can never both
   rest simultaneously. Calm lofi reliably has mutual-breath
   moments; they're emotionally load-bearing for the genre.
2. **Loses per-seed melodic rhythm at high coupling.** At c=1,
   melody activity becomes a deterministic function of chord
   activity alone. The seed's own θ_m drift is silenced. Two
   different seeds at high c play identical rhythms (differing
   only in baseline amplitude). Melodic-rhythm identity collapses.
3. **Loses per-seed density character at high coupling.** Density
   is dictated by chord, not seed. Sparse-seed and busy-seed both
   play "everything except what chord is doing." The most important
   melodic-identity dimension collapses at the same coupling values
   that the framework is supposed to express identity.
4. **"Designed" feel over "naturalistic" feel.** Phase relationships
   are exact, deterministic correspondences. Over long listens
   (study music, hours) deterministic structure can read as
   composed-feeling, less organic. Min-cap's looseness wears better
   across infinite-duration sessions.
5. **Mutual peak also impossible at high coupling** (symmetric with
   #1). Both can never be loud together. Less important than mutual
   silence but reinforces the "forced asymmetry" issue.
6. **Counter-melody argument doesn't actually hold up.** I'd
   initially claimed phase coupling was *needed* for elegant
   multi-voice generalisation. On closer inspection, min-cap
   generalises just fine via additional pairwise constraints —
   counter-melody activity capped by `1 − chord_activity` AND
   `1 − melody_activity`, two independent constraints. Less
   mathematically pretty than phase relationships on a triangle but
   functionally equivalent and preserves the naturalistic semantics.

**Conclusion: min-cap is not a "for now" placeholder — it is the
right model for the engine's long-run goals.** The musical losses
of phase coupling (mutual silence, per-seed rhythm, per-seed
density) aren't worth the elegance, especially since min-cap
generalises cleanly to counter-melody when that lands.

### Drift on the coupling parameter — per-seed shape

Coupling itself drifts via fBm — not a fixed per-seed scalar. This
honours seed-identity §2 (per-seed fBm shape) which the framework
prefers for any parameter perceptible enough that hours of monotone
value would feel static.

| Knob | Value |
|---|---|
| Universal coupling range | `[0, 1]` |
| Per-seed coupling mean | Drawn from `[0.2, 0.8]` at construction. No seed fully ignores chord; no seed fully gates. |
| Drift range around mean | ±0.1 (the seed's identity stays clearly in its home region). |
| Per-seed depth modifier | `nextRange(0.05, 0.12)` so some seeds breathe wider, others tighter. |
| Slowest octave | ~4 minutes. Slower than chord-activity (90 s) because coupling is a higher-level *character* trait that should change less often than activity itself. |
| Hard clamp | `[0, 1]`. |

The drift effect is subtle (~6% effect on melody firing rate at
extremes of drift) — non-salient by design. The aggregate feel is
"the relationship between voices is alive, not locked."

### Per-seed parameter audit (against seed-identity.md framework)

For the melody-chord coupling parameter:

1. **Universal rule** — coupling controls how much chord activity
   suppresses melody activity via the min-cap formula. Range
   `[0, 1]`. Same for every seed.
2. **fBm stream** — `melody-chord-coupling-fbm`, slowest octave
   ~4 min.
3. **Per-seed shape modifier** — mean from `[0.2, 0.8]`, depth
   from `[0.05, 0.12]`. Both continuous distributions.
4. **Per-seed couplings to other streams** — this *is* the §3
   coupling parameter. Couples melody-activity to chord-activity.
   First concrete §3 exercise in the engine.
5. **Mix-layer per-seed bias** — melody volume bias deferred to the
   queued "Mix-bias per seed" stage (will also cover per-seed melody
   volume offset).

All five framework layers addressed.

### Implementation notes

**New seed children:**
- `melody-activity-fbm` — fBm noise for melody's own activity drift
- `melody-activity-config` — per-seed mean / depth / timescale shape
- `melody-chord-coupling-fbm` — fBm noise for coupling drift
- `melody-chord-coupling-config` — per-seed mean / depth

**EngineState additions:**
- `chordActivityStream` must be exposed on `EngineState` so the
  melody scheduler can evaluate chord activity at melody emission
  points (faster than chord slot rate). Chord scheduler writes this
  at construction; melody scheduler reads.

**Replacing the old shared density stream:**
- Melody scheduler currently reads `state.densityStream` (legacy
  from the pre-pattern-Markov chord layer). Replace with its own
  `melodyActivityStream` evaluated per emission.
- The "effective" computation happens at each melody-firing
  decision point.

**Engine fingerprint:** expected reset (multiple new seed children,
new state field). Document in `docs/seed-format.md` §7.3a and reset
the pinned fingerprint.

---

## F2 — Phrase concept + germ-based emission (decided 2026-06-21)

### No explicit phrase structure

The melody scheduler has **no explicit phrase boundaries** and **no
explicit strategy menu**. Phrase-like behaviour emerges from the
interaction of three mechanisms — activity drift (F1), a persistent
per-seed germ, and local probabilistic emission rules.

Three paths were considered:

- **Path 1 — Pure activity-driven** (no structure, just effective
  activity + per-emission pitch choice). Rejected: gives the
  "noodling" feel the current implementation already has.
- **Path 2 — Explicit phrases + strategy menu** (chord-slot-aligned
  phrases, Markov walk on melodic strategies like scalar / arpeggio
  / sustained). Rejected for v1: heavyweight architecture; pushes
  toward "composed-feeling" output less aligned with infinite-study
  framing; gives macro variety we may not want.
- **Path Middle (chosen) — persistent germ + local emission rules.**
  L-system framing: small persistent axiom (germ) + simple per-
  emission production rules + recent-buffer continuity. Phrases
  emerge from rule dynamics; never explicitly defined.

The middle path is the right architectural fit because the project's
"infinite generative" framing wants *emergent identity from compact
representation*. A per-seed germ + handful of rules is exactly that:
tiny axiom + ruleset that unfolds into infinite coherent material.

### Per-seed germ — the axiom

At construction, the seed generates a small motivic axiom (3-5
notes with pitch contour and rhythm). This is the seed's signature
melodic material. It persists for the entire session, never decays.
Per-seed identity in the melody layer is *primarily* the germ.

Germ shape determines melodic character without an explicit strategy
menu: an arpeggio-shaped germ produces an arpeggiating seed; a
scalar-walk germ produces a scalar-walking seed; a held-tone-with-
ornament germ produces a sustained-tone seed. Per-seed melodic
character emerges from germ shape, not from runtime strategy
switching.

### Germ generation — hybrid templates (Approach D)

Generation uses **abstract templates + per-seed parameterization**.
Six handwritten templates encode calm-lofi melodic shape vocabulary
(rising-arc-resolution, falling-stepwise-resolution, pivot-tone,
short-leap-and-step, held-then-fill, symmetric arc). Per seed:

- Pick template (Dirichlet-perturbed weights per seed)
- Pick starting pitch (chord-tone choice)
- Pick interval-size bias (some seeds tighter, some wider)
- Pick rhythm jitter
- Pick length within template's range (3 / 4 / 5 notes)

Templates encode the musical-soundness properties (contour, rhythm
shape, resolution); per-seed parameterization provides essentially
unbounded variety across seeds.

### Why D over alternatives

Genuine alternatives considered:

- **E — Evolutionary at construction time** (GA + fitness function).
  Philosophically most aligned with "Minecraft seed, same rules,
  emergent identity." Rejected for v1: fitness function design is
  the entire game and getting it wrong gives consistently mediocre
  output; debuggability concerns; architectural outlier (every
  other layer uses Dirichlet/Markov + hand-tuned weights).
- **F — Living evolutionary** (germ mutates over session). See
  "Future directions" below — kept on the table for v2+.
- **G — Markov chain from handcrafted corpus.** Reasonable; quality
  bounded by corpus. Rejected: corpus-curation overhead exceeds
  template-authoring overhead.
- **H — Context-free grammar.** Often produces stiff academic-
  feeling output. Rejected.
- **I — Pure L-system rules.** Most elegant but rule design is
  notoriously hard to make musically pleasing. Rejected.
- **J — Hybrid templates + per-seed evolutionary refinement.**
  Combines D's quality floor with E's variety. Most complex.
  Architecturally legitimate but overengineered for v1.

The deciding argument is **architectural consistency** — every
other layer of the engine uses weighted-Dirichlet-or-Markov with
hand-tuned weights. Introducing a GA for melody only would be an
outlier that complicates the maintainable mental model.

### Local emission rules

At each emission decision (gated by F1 effective activity):

- With probability `p_germ` → emit a fragment of the germ verbatim
- With probability `p_transform` → emit a transformation of the
  germ (transpose, invert, retrograde, fragment, augment)
- With probability `p_buffer` → emit a transformation of recent
  emissions from the rolling buffer
- With probability `p_fresh` → emit a fresh draw from the chord-
  aware pitch pool

`[p_germ, p_transform, p_buffer, p_fresh]` is Dirichlet-perturbed
per seed at α=20 (mirrors the existing Markov / archetype layers).
Some seeds aggressive (favour fresh + transform); others
conservative (favour germ + verbatim repeat).

The recent buffer (rolling window of last N notes) provides local
coherence — recent material recurring in the near future. Buffer
size N is per-seed in `[4, 12]`.

### Open sub-decisions for later

- **Germ pitch representation**: chord-relative shape (adapts as
  chord changes, jazz-musician-like) vs key-relative pitches
  (simpler, doesn't follow chord motion). Will resolve when
  implementing templates.
- **Per-seed transformation menu weights**: which transformations
  each seed favours.
- **The six template specifications** (concrete pitch contour +
  rhythm cell for each).
- **Rhythm-cell library** for templates.

These can be settled at implementation time; the overall framework
is set.

## F3 — Relationship to chord layer

F3 was effectively decided as part of F1. The per-seed
coupling-strength mechanism IS the chord-relationship knob —
strong-coupling seeds lean antiphonal (melody fills chord rests);
weak-coupling seeds lean independent (melody plays through). No
additional architecture is needed beyond what F1 specifies.

Nothing new to decide here. F3 is closed.

## Future directions (v2+ considerations)

### Living evolutionary germ (F)

Originally considered and prematurely dismissed during the F2
discussion (correctly flagged by the user). On proper review, F is
viable as a v2+ extension that composes cleanly with the v1
hybrid-template approach.

The compatible-with-framework design:

- The seed's `G_0` (template-generated germ) is **fixed forever**.
- Over the session, a small set of bounded mutations are applied
  to `G_0` (not to the current state — always derive from `G_0`,
  preventing accumulating drift away from seed identity).
- Mutations: pitch shift of one note (±1-2 semitones within scale),
  duration swap, passing-tone insertion, ornament.
- **Anchors immune**: first/last pitch never mutate; contour
  direction never changes.
- At most K active mutations (e.g., K=3); new mutations roll
  every ~10 minutes; old mutations expire at ~30 minutes.
- Per-seed: mutation rate, mutation severity, anchor strength.

This gives motif *development* over hours-long listens (Bach-
variations feel) while keeping the seed identity recognisable
because `G_0` is the constant skeleton. Composes additively with
v1 templates: templates generate `G_0`; mutation layer rides on top.

**When to add:** if listening tests over multi-hour sessions reveal
that hours of repeated germ-derived material feels samey. Until
that's established as a real problem, the simpler fixed-germ model
(v1) is preferred.

**Why this was almost lost:** the original rejection conflated
"different from earlier" with "salient transition" — only the
latter violates seed-identity principle 1. Slow constrained drift
gives the former without the latter. The conceptual mistake is
worth carrying forward as a discipline reminder (see CLAUDE.md
"Design-discussion discipline").
