# Gaps & Open Questions

> A running punch list of things the docs don't yet pin down. Tackle items as
> they become blockers — not all upfront. Move resolved items into the
> relevant spec doc and delete from here. New items welcome.

---

## Blockers / contradictions — resolve before code

*(All three previously-blocking items resolved 2026-06-15. See
`docs/seed-format.md`, `docs/event-protocol.md`, and the rewritten
`handoff.md` §Known gaps bullet 2. Move new blockers in here as they
appear.)*

---

## Specs we'll need before serious code

### Scheduling model
Tone.js Transport directly, or a custom scheduler on top? Lookahead window
length? Behavior under variable browser load (tab backgrounded, GC pause)?
Determinism implications of each choice.

### State serialization
For exact pause/resume and for the seed-determinism promise to mean
anything, enumerate the persistent state:
- Attractor coordinates (3 floats per attractor)
- Markov current-state per chain
- Ornament per-type recovery clocks + global last-fired
- fBm phases per channel
- Current chord, voicing, progression slot
- Any LFSR/PRNG counters

Decide whether the engine snapshots state for save/resume or restarts from
seed + elapsed-time (re-derivable for OU/fBm but expensive for long sessions).

### Validation harness
Mentioned in `dynamics-brainstorm.md` and `ornaments.md` as a Python offline
tool. Needs:
- Input — seed + duration + which validations to run
- Outputs — pass/fail per check, plots, summary stats
- Checks — 1/f shape on macro params, ornament inter-arrival distribution
  matches the configured process, no salient events above amplitude threshold,
  long-run stationarity, type non-clustering
- Lives in `tools/` per the spec's Python-at-build-time rule

### Voice-leading solver
`dynamics-brainstorm.md` §4.2 hand-waves "minimum-motion voicing solver."
Needs:
- Allowed inversions and doublings
- Range constraints per voice
- Cost function (total semitone motion? weighted by voice? avoid voice
  crossing?)
- How chromatic-approach probability and archetype swap interact with the
  solver

### Markov matrix schema
"Python authors, TS performs" pattern is stated; no schema for the artifact.
- JSON shape (probably `{from: {to: probability, ...}, ...}`)
- Per-mode? Per-archetype? Per-subgenre?
- Versioning so old seeds keep working when matrices update
- Authoring workflow (hand-tuned? trained on a corpus? both?)

---

## Content / design decisions still hanging

### Which subgenre archetypes ship in v1
`lofi-study.md` §10 lists 9 candidates. We never picked. Probably 4–6 for
v1. Each archetype is a *preset* over the ~50 knobs; defining them is the
single biggest authoring task.

### User-facing knob surface
~50 knobs internally; UI exposes 3 today (volume / warmth / density) plus
two toggles (rain / vinyl). `ornaments.md` §5 added a "presence" slider.
Which subset becomes user-controlled vs purely seed-implicit? The whole UX
identity ("zero selection" vs "a few warm dials") depends on this answer.

### Macro vs session-locked
Open in `dynamics-brainstorm.md` §8 — do macro knobs themselves drift over a
session, or stay seed-locked? Affects the HMM design and the
seed-determinism promise.

### Bit-exact determinism scope
Also from `dynamics-brainstorm.md` §8: bit-exact across machines (constrains
attractor implementation, forbids floating-point chaos) vs "qualitatively the
same character." Probably the latter for v1, but worth deciding explicitly.

---

## Surfaces / product

### Obsidian plugin design
`obsidian-brainstorm.md` is an 11-line stub. Need:
- Manifest + settings schema
- Where UI lives (ribbon? sidebar? status bar? command palette?)
- Audio lifecycle across note switches and plugin disable
- Mobile Obsidian story (or explicit "desktop only" decision)

### Note-to-seed mapping
The "thematic to note" idea from `handoff.md` growth space — every note gets
its own deterministic soundscape. Needs design:
- Hash over title / content / tags / frontmatter / path?
- Stability under edits (small text change shouldn't cause a totally
  different seed — or should it? UX choice)
- Override / pin mechanism so a user can lock a seed they like

### Prototype → modular codebase migration
Does the existing `ember-generative-study.html` become the hosted demo
as-is, get rewritten on top of `@loam/core`, or both in parallel during the
transition? Affects how quickly we can publish a public demo.

### Bundle Tone.js locally
Listed as a step in handoff but no notes on:
- Size budget (Tone.js is ~200 KB minified; matters for the single-HTML demo)
- Tree-shaking — do we use enough of Tone.js to justify the full bundle, or
  cherry-pick?
- How the bundled demo stays "single self-contained HTML" if we keep that
  property

---

## Engineering hygiene

### License file
MIT is declared in `handoff.md`; no `LICENSE` file in the repo. Trivial to
add.

### Performance budget
No target stated. Needs:
- CPU target on a midrange laptop (single-digit % at the demo's voice count?)
- Max simultaneous voices
- Mobile / Obsidian-mobile feasibility
- Behavior under tab backgrounding (Web Audio is throttled — does the engine
  pause cleanly?)

### Mixing / output pipeline
- LUFS target (study music wants ~ -23 to -20 LUFS integrated; lower than pop)
- Headroom for ornaments — they should be audible without master limiting
  kicking in
- Master limiter behavior — soft-knee, no pumping
- Stereo width per element

### Browser / Web Audio compatibility
- Minimum supported versions
- Safari quirks (AudioContext autoplay, Web Audio nuances)
- Mobile Web Audio (touch-to-start gesture handling)

---

## Long-tail — flagged for later

### Devlog / writeup
`handoff.md` calls the writeup the highest-leverage deliverable. No outline
yet. Even a one-page draft (sections + bullets) would be useful as a north
star for what the engine needs to demonstrate.

### Roadmap with milestones
`handoff.md` lists 6 "Immediate next steps" but no sequence, dependencies, or
definition-of-done per step. A Gantt-flavored ordering would help triage.

### Circadian rate modulation
From `ornaments.md` §7 still-open — "quieter at midnight." Skip for v1,
revisit if users ask.

### Are some ornament types too salient to ever ship by default
From `ornaments.md` §7 still-open. The bell-tone is the suspect. Decide once
we can hear long sessions.
