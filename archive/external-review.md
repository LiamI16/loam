# External review notes

> Things flagged by outside sources (Gemini Deep Research, 2026-06-16) as
> worth incorporating into Loam that weren't already in `lofi-study.md`
> or our stage sketches. Mostly *specifics* the survey doc was vague on,
> plus a couple of architectural primitives we hadn't named.
>
> Each entry: what it is, why it matters, when to slot it in. Not
> prescriptive — promote to the relevant stage when we get there.

---

## A. Specifics worth pinning down

### A.1 Dilla swing target ratios

The well-known specific points in the swing space:

- **61.8%** — golden ratio, the "Dilla pocket" most often cited.
- **62.5%** — the "limping in quicksand" feel.
- **55–60%** — standard bouncy lofi swing.
- **67%** — classical triplet swing (too obvious for Dilla feel).

`lofi-study.md` §6 says "0.20–0.55 in Tone.js terms" — the above are
finer-grained targets for when the drum scheduler gets a real swing
knob (Stage 10 CA drum drift territory, or sooner if swing graduates
to a per-seed knob).

### A.2 Voice-leading: 3 → 7, 9 → 13

A jazz functional-voice-leading rule we don't currently apply: the 3rd
of the current chord prefers to move to the 7th of the next chord, and
the 9th prefers the 13th.

Our greedy solver (`harmony/voicing.ts`) does min-motion, which often
*happens* to produce this — but doesn't bias toward it when alternatives
are equidistant. Small refinement: tiebreak the assignment by preferring
3→7 and 9→13 transitions.

Defer until we want another nudge of harmonic polish (post-Stage 7).

### A.3 Independent micro-timing per drum element

We say "snare-late, hat-ahead" as text. Sharper framing: each drum
element runs on its **own** micro-timing vector — kick on grid, snare
displaced +5–30 ms, hat with its own swing percentage that doesn't
necessarily match the bus.

We currently apply (or will apply) one swing dial across the bus.
When swing gets implemented for real, do it per-element from the start,
not as a single bus parameter.

Stage 10 (CA drum drift) is the natural slot.

### A.4 Altered dominants in chord vocab

Add `7♯5`, `7♭5`, and possibly `7♭9` to the Stage 6 chord vocabulary
when we expand. They give the dominant a chromatic-friction resolution
that's softer than a plain V7 — fits the lofi "never resolve hard" rule.

Easy vocab addition once we want more harmonic colors. Will increase
the Markov matrix size meaningfully (each dominant becomes 2–3 entries).

---

## B. Architectural addition: discrete dynamics overrides

This is the one genuinely-new architectural primitive. **Worth a
proper sketch.**

We have two dynamics primitives so far:

- **Continuous (`fBm` streams, Stage 5)** — smooth parameter motion
  over minutes. No salient moments.
- **Point (`ornaments`, Stage 8)** — discrete one-shot events that
  briefly call attention to themselves.

Gemini frames a *third* primitive, borrowed from Eno's Oblique
Strategies: a **windowed state override** — a named, discrete change
that holds for N bars, then releases. Examples:

- **"Mute the fundamental"** — strip all root notes from voicings +
  pad for 16 bars. Floating, ambiguous.
- **"Emphasize repetitions"** — freeze the melody scheduler on its
  last 3-note motif and loop it for 8 bars.
- **"Pad only"** — mute drums + chords, leave only pad + crackle for
  8 bars.
- **"Mode shift"** — temporarily swap the chord vocabulary's mode
  (Dorian → Lydian) for a phrase before reverting.
- **"Honor the error"** — when the Markov walk picks a low-probability
  transition, *amplify* its effect (e.g. extend the chord, raise its
  velocity) instead of treating it as accidental.

**Why this is distinct from ornaments and fBm:**

| Primitive | Time scale | Shape | Audible? |
|---|---|---|---|
| `fBm` stream | minutes | smooth curve | no (subliminal) |
| Ornament | 1 hit | impulse | yes (one moment) |
| **Override** | **8–32 bars** | **step change** | **yes (a "section")** |

Overrides are how the engine could earn structure without a verse-
chorus-verse skeleton — a 16-bar "the bass drops out and only the pad
remains" passage is a *section* even though nothing was scheduled in
advance, just an override fired by a slow point process.

**Implementation sketch (not a real spec yet):**

- One central `OverrideManager` listening to a Cox+refractory process
  (same machinery as Stage 8 ornaments, with a much lower rate — one
  override every 1–3 minutes, vs ornaments at every 5–30 seconds).
- Each override is a `(start, duration, kind, params)` tuple.
- Sub-schedulers subscribe and check `manager.active(kind)` on each
  decision (e.g. `ChordScheduler` checks `'mute-fundamental'`).
- Releases at the end of the window — no manual cleanup state.

**Slot:** good fit as **Stage 8.5** or as a renamed Stage 8 — the
machinery (point process + per-type rates) is shared with ornaments.
Could merge into one "events" subsystem with two flavors (instant vs
windowed).

Cross-link from `docs/dynamics-brainstorm.md` and `docs/ornaments.md`
when implemented.

---

## C. Ambient-mode reservations

These all matter if/when we build an Ambient engine alongside `Ember`
(separate engine, not a refactor). Not relevant to Stage 6–10 of Ember.
Pinning them here so we don't re-derive them.

### C.1 Reverb freeze
Capture a tail buffer, loop infinitely. Converts a transient chord into
a sustained drone pad. The cheapest path to "infinite ambient texture
from a one-shot melodic event." Relevant for ambient adapter design.

### C.2 Algorithmic reverb with modulated internal LFO
For ambient, the reverb itself should be a sound *generator*, not just
a mixing tool. Apply slow LFOs to the reverb's all-pass / delay-line
parameters so the tail evolves over minutes (avoids metallic stasis).

### C.3 Self-oscillating delay + band-pass
Feedback at ~100% with a band-pass filter in the loop generates
ethereal howling pads from non-melodic source material. A "free pad"
generator with no synth needed.

### C.4 Pitch-shifted delay (+5th / +octave shimmer)
Cheap harmonic depth: route signal into a delay shifted up a perfect
5th or octave. Adds a cascading "shimmer" without scheduling notes.

### C.5 Granular synthesis
The big one we don't have anywhere. Deconstruct source audio into
grains (10–100 ms each) and reconstruct with randomized playhead, pitch
(scale-quantized!), density. Generative ambient's signature texture.

Key parameters: `grain_size`, `grain_density`, `playhead_spray`,
`pitch_jitter` (scale-locked).

Phase 3+ if ever — heavy lift, only matters for an Ambient engine.

---

## D. Melody-scheduler alternatives (Stage 9)

We've sketched Stage 9 as L-system melody contours. Worth recording
the alternatives Gemini surfaced for when we re-plan Stage 9 in detail:

- **2nd-order Markov chain** — the previous *two* notes condition the
  next. Simpler than L-systems, less coherent on phrase arc but
  faster to implement and easy to seed-perturb (same Dirichlet trick
  as Stage 6 harmony).
- **Sub-task decomposition** — high-level form planner (A-B-A-C) +
  lower-level content generator constrained by form. This is
  essentially what L-systems give us; just naming the pattern.
- **Pitch-proximity heuristic** — after a leap > P5, override
  probabilities to ensure next notes move stepwise in the opposite
  direction. A classical counterpoint rule worth bolting on whatever
  pitch picker we use.
- **Blue-note injection knob** — a `blue_note_probability` that
  occasionally inserts ♭3/♭5/♭7 over a major backdrop. A specific
  ornament that fits the melody scheduler (not the global ornament
  process).

When Stage 9 lands, evaluate L-system vs 2nd-order Markov on cost
(implementation effort) vs payoff (phrase coherence). 2nd-order Markov
+ phrase template might be 70% of the L-system payoff at 30% the cost.

---

## E. Already covered — don't re-investigate

For the record, the external survey re-derived all of the following
from public sources; these are *already* in our docs and don't need
new specs:

- Modal bias (Dorian/Aeolian/Lydian etc.) — `lofi-study.md` §1
- Chord extensions (maj7/min9/maj7♯11) — `lofi-study.md` §2 + Stage 6
- Spread / rootless / quartal voicings (concept) — `lofi-study.md` §4
- Slow harmonic rhythm (2–4 bars) — Stage 6
- Markov chord progressions — Stage 6
- Pentatonic + chord-tone melody filter — Stage 6
- Sparsity / call-and-response — `lofi-study.md` §7
- Boom-bap rhythms — Stage 4
- Wow/flutter/crackle/hiss/bitcrush — `lofi-study.md` §9
- LP "warmth" — Stage 4
- Slow LFO sweeps → graduated to fBm — Stage 5
- Drum dropouts, density envelopes, voicing rotation rate —
  `lofi-study.md` §11 (voicing rotation now implemented as Stage 6
  follow-up)
- Subgenre archetypes — `lofi-study.md` §10
- `1/f` noise for macro evolution — `dynamics-brainstorm.md` + Stage 5

If a future external reviewer raises any of these, the answer is
"already specced — see above."
