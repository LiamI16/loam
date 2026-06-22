# Gaps & Open Questions

> A running punch list of things the docs don't yet pin down. Tackle items as
> they become blockers — not all upfront. Move resolved items into the
> relevant spec doc and delete from here. New items welcome.

---

## Blockers / contradictions — resolve before code

*(All previously-blocking items resolved by 2026-06-22. New blockers go
here as they appear.)*

---

## Specs we'll need before serious code

### Scheduling model
Tone.js Transport directly, or a custom scheduler on top? Lookahead window
length? Behavior under variable browser load (tab backgrounded, GC pause)?
Determinism implications of each choice.

### State serialization
For exact pause/resume and for the seed-determinism promise to mean
anything, enumerate the persistent state. As of 2026-06-22 the
sub-schedulers carry:

- `EmberEngine`: `engineCursor`, `audioCursor`, `speedMultiplier`
- `ChordScheduler`: walk state, `nextBarIdx`, `currentSlotStartBar`,
  current chord/voicing/archetype/pattern + plan, pre-stepped next-slot
  lookahead, `prevPadRoot`, `previousPattern`
- `BassScheduler`: stickiness state, last bass pitch
- `DrumScheduler`: per-bar variation flag state
- `MelodyScheduler`: `nextQuarter`, `buffer`, four rng cursor positions
  (root, emission, transformation, transformation-param, compound,
  jitter), `pCompound` + swing ratio (immutable post-construction)
- `CrackleScheduler`: per-event state
- `PositionStream` phase
- All `FbmParam` streams (mean is mutable; offsets implicit from time)

Decide whether the engine snapshots state for save/resume or restarts from
seed + elapsed-time (re-derivable from seed in most cases, but expensive
for long sessions).

### Validation harness
Mentioned in `dynamics-brainstorm.md` and `ornaments.md` as a Python offline
tool. Needs:
- Input — seed + duration + which validations to run
- Outputs — pass/fail per check, plots, summary stats
- Checks — 1/f shape on macro params, ornament inter-arrival distribution
  matches the configured process, no salient events above amplitude threshold,
  long-run stationarity, type non-clustering
- Lives in `tools/` per the spec's Python-at-build-time rule

`packages/core/scripts/render-snippet.ts` and
`packages/core/scripts/analyze-seed.ts` cover the dev-time ear-fatigue
problem; a Python harness for the *statistical* properties is still
pending.

### Markov matrix schema
"Python authors, TS performs" pattern is stated; no schema for the
build-time artifact. The chord-Markov matrix is currently hand-tuned in
source (`harmony/markov.ts` → `HAND_MATRIX`); when we mine corpora:
- JSON shape (probably `{from: {to: probability, ...}, ...}`)
- Per-mode? Per-archetype? Per-subgenre?
- Versioning so old seeds keep working when matrices update
- Authoring workflow (hand-tuned? trained on a corpus? both?)

---

## Melody / harmony interaction

### Chord vocabulary D vs. germ key-relativity
The melody rewrite (F2 sub-decision, `docs/melody.md` line 367+) chose
**key-relative germs** — the germ floats over harmony rather than
adapting per-chord — justified by the current chord vocabulary being
pentatonic-friendly. The next planned harmony stage (Chord D) adds
altered dominants (`7♯5`, `7♭5`, `7♭9`) whose chord tones include
notes that *aren't* pentatonic-friendly.

Open question: will key-relative germs clash audibly over altered
dominants? Three resolution paths to consider when Chord D lands:

1. The `fresh` rule's chord-aware filter handles it (germ emissions
   are a minority of firings; clashes get masked by surrounding fresh
   notes).
2. The F2 key-relative decision needs revisiting for altered chords
   specifically (per-chord-quality clash tolerance).
3. Scope-limit Chord D to the chord qualities that don't clash with
   pentatonic germs (drop the altered dominants).

Decide before committing Chord D work.

### Engine fingerprint test coverage hole
The lock test asserts count `113` for `Seed.from(42n)` in `[0, 5s)`.
By coincidence, seed 42 doesn't fire any melody notes in that window
— so the lock has been stable across every melody-rewrite commit
despite every seed's melody character changing substantially. The
lock is incomplete by design (it's a tripwire, not a full contract),
but the gap is worth knowing. If a future change *does* fire melody
for seed 42 in `[0, 5s)`, the test will catch it correctly but the
incident will look like a regression rather than a coverage update.

Possible fixes (not urgent):
- Add a second lock for a longer window (say 30 s)
- Add a parallel lock for a seed whose melody fires early
- Add a separate locked-sequence test specifically for melody firings

---

## Content / design decisions still hanging

### Which subgenre archetypes ship in v1
`lofi-study.md` §10 lists 9 candidates. We never picked. Probably 4–6 for
v1. Each archetype is a *preset* over the ~50 knobs; defining them is the
single biggest authoring task.

### User-facing knob surface
The 2026-06-22 cleanup hardened the seed-as-identity principle:
user-facing knobs are deliberately limited to playback-level controls
(volume / warmth / speed multiplier) plus feature toggles
(rain / vinyl). All musical-character knobs (BPM, density, swing,
template choice, coupling) are derived from the seed. See
`docs/seed-identity.md` and the seed-discovery backlog entry in
`stage-list.md` for the principled answer to "user wants a different
mood."

Still open: does the Obsidian plugin expose anything more than the
web demo, or are they identical?

### Macro vs session-locked
Open in `dynamics-brainstorm.md` §8 — do macro knobs themselves drift over a
session, or stay seed-locked? Resolved for most layers: chord/melody
activity, coupling, slot bias all drift. Swing and compound rate are
session-locked (rare-event carve-out per `docs/seed-identity.md`).

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
The "thematic to note" idea from the growth-space discussion — every note
gets its own deterministic soundscape. Needs design:
- Hash over title / content / tags / frontmatter / path?
- Stability under edits (small text change shouldn't cause a totally
  different seed — or should it? UX choice)
- Override / pin mechanism so a user can lock a seed they like

### Prototype → modular codebase migration
The existing `ember-generative-study.html` is kept as a reference specimen
alongside the modular codebase. Decision is now made (both in parallel);
no migration step pending.

### Bundle Tone.js locally
Tone.js is currently a workspace dependency, bundled by Vite for the web
demo. Specific budget items still open:
- Size budget on the demo bundle (we're at ~300 KB minified currently)
- Tree-shaking effectiveness — do we use enough of Tone.js to justify
  the full bundle, or cherry-pick?
- How the bundled demo stays "single self-contained HTML" if we keep
  that property

---

## Engineering hygiene

### License file
MIT is declared in `README.md`; verify a `LICENSE` file exists at the
repo root.

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
The architecture devlog (mentioned in `README.md`) is the highest-leverage
deliverable. No outline yet. Even a one-page draft (sections + bullets)
would be useful as a north star for what the engine needs to demonstrate.

### Roadmap with milestones
`stage-list.md` has the active backlog but no Gantt-flavored ordering or
definition-of-done per item. A roadmap pass would help triage what's
shippable for the v1 demo.

### Circadian rate modulation
From `ornaments.md` §7 still-open — "quieter at midnight." Skip for v1,
revisit if users ask.

### Are some ornament types too salient to ever ship by default
From `ornaments.md` §7 still-open. The bell-tone is the suspect. Decide once
we can hear long sessions.

---

## Recently resolved (delete after a few sessions)

- **Voice-leading solver design** (Stage 6) — done. See
  `harmony/voicing.ts`.
- **Density slider's role in user-facing knob surface** (2026-06-22) —
  density removed; principle clarified.
- **L-system melody contour** — superseded by the germ-driven melody
  rewrite (Phases 1–3). See `docs/melody.md`.
