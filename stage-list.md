# Stage list

> The active development checklist. Each stage is a single feature
> addressing one specific gap, sized to land in one sitting. Bundles
> happen when sub-features touch the same files / functions in
> incompatible-to-split ways. Ordered by listening impact, not by
> architectural category.
>
> Phase 1 (prototype port, Stages 1–4) is closed; see
> `archive/phase1-stage-list.md` for that log.
>
> **Origin (2026-06-17):** during Stage 7c.2 + per-seed BPM listen
> tests, output read as "drift on top of a crude event generator."
> Drift architecture (Stages 5–7) is sound; what's missing is
> richness in the *event-generation logic* of each scheduler.
> Re-planning flattens the remaining work into a single ordered
> list keyed to that diagnosis.

---

## Done

Compact summary — full implementation notes in the linked docs.

| Stage | What | Locks |
|---|---|---|
| Phase 1 | Foundation, prototype port (Stages 1–4) | `archive/phase1-stage-list.md` |
| Stage 5 | fBm `ParamStream` + density / evo-filter dynamics | `docs/dynamics.md` |
| Stage 6 | Markov chords (Dirichlet-perturbed) + greedy voice-leading | `docs/harmony.md` |
| Stage 6.5 | User speed multiplier; BPM slider removed (redundant) | inline |
| Stage 7a | `PositionStream` substrate + voicing register drift | inline |
| Stage 7b | Listen-distance fBm (chorus depth, drum-bus cutoff) | inline |
| Stage 7c.1 | Modes-of-C data layer (6 modes, blending helpers) | inline |
| Stage 7c.2 | Mode blending wired into Markov + melody | inline |
| Follow-up | Per-seed BPM derivation, range [60, 90] | inline |

**Test count:** 125 green. **Engine fingerprint locked at `Seed.from(42n)` with `bpm: 74`** as the seed-format contract surface (see `docs/seed-format.md` §7.3a for the layered locks).

---

## Done (post-replan)

| Stage | What | Notes |
|---|---|---|
| Drum rewrite | Per-bar variation + per-voice micro-timing + velocity accents + mild 16th-swing | See below |
| Bass scheduler | Separate bass voice, sparse root-on-beat-1 + maybe-fifth-on-beat-3 pattern | See below |
| Stereo + per-instrument reverb | Send/return mixer; per-instrument pan + reverb send level | See below |
| Chord comping (A: rhythm) | Bar-grid scheduler; {2,4}-bar slots; beat-1 anchor + density-driven hits + pickup + rare off-beat sync. Folded "B-lite": keys release 2.6 → 0.5 s. | See below |
| Chord comping (C: voicing variety) | Four archetypes (close/spread/rootless/quartal), Dirichlet-perturbed per seed; drop-a-voice micro-variation; rootless-preview pickups | See below |
| Chord echo / delay send | `Tone.FeedbackDelay` on keys path, quarter-note BPM-locked, 30% feedback, 0.18 send, echo→reverb (shared room) | See below |
| Chord pattern menu (rework) | Per-slot 5-pattern Dirichlet selection (pure-hold / hold-with-refresh / call-response / light-comping / active-comping); activity-stream tilt; drops density + sync | See below |
| render-snippet dev tool | LLM-readable event-log dump for offline analysis (fight ear fatigue) | See below |
| Chord / melody channel split | `RHODES_CHORD` + `RHODES_MELODY` channels with separate synths; chord −13 dB, melody −9 dB; snare drop to −20 dB | See below |
| Chord-synth envelope sustain | Chord synth sustain 0.28 → 0.55; melody stays at 0.28 (split now meaningful timbrally too) | See below |
| Pattern Markov + calmer targets | Per-slot comping pattern is now a Markov walk; targets shifted to [0.55, 0.28, 0.10, 0.05, 0.02] (verified via detailed balance) | See below |
| Melody rewrite (Phases 1–3) | Germ-driven scheduler: F1 min-cap chord coupling, 10 templates, 4-way emission rule, 6 transformations + retrograde gating, compound 2-chain, per-seed swing, per-emission jitter | See `docs/melody.md` + §7.3a |
| analyze-seed dev tool | Scheduler-internal-state inspector (germ shape, per-seed parameter draws, effective-activity samples) — complements render-snippet | `scripts/analyze-seed.ts` |
| Density option removed | `density` engine option + `densityStream` + density-fbm seed children excised; web-demo slider removed. Per-seed melody-activity now fully encapsulates the role | inline |

**Drum rewrite details:** `drum-scheduler.ts` rewritten. Per-voice
constant micro-timing (snare drag +15 ms, hat slight ahead −3 ms,
kick on grid). Velocity accent multipliers per step position (beat 1
strongest 1.0, beat 3 0.92, beats 2 / 4 0.88, "and"s 0.78, off-16ths
0.65). 16th-swing ratio 0.55 (mild) applied to odd-step hits (ghost
snares, ghost hats, kick syncopations). Per-bar variation rolls:
`kickSync` (15%), `hatDrop` (8%), `openHatStep` (25% chance, 6 or
14), `ghostSnareSteps` (40% chance, 1–2 picks from [3, 7, 11, 15]).
Velocity jitter ±5%. Tests rewritten for statistical-property
assertions (drum-scheduler tests now seed-robust). Engine fingerprint
deliberately reset — count 103 → 105 and first event is now the
hat-with-offset at t=−0.003.

**Bass scheduler details:** new `bass-scheduler.ts` parallels the
chord scheduler. Sparse pattern: chord-derived root on beat 1 of
every bar (always), root-or-fifth on beat 3 (55% per bar; of those
30% play the fifth). Bass register C2–C3 (MIDI 36–48); roots use
interpretation A (always lowest available in register).

**Stickiness** (per-seed): on each chord change, the bass *might*
stay on its current note instead of moving to the new chord's
lowest root — provided that current note is still a chord tone of
the new chord. Blends two real lofi techniques (clear chord-root
motion at low stickiness, pedal-tone foundation at high stickiness).

Two per-seed modes:
- **70% of seeds (fixed):** one stickiness value in [0.2, 0.65],
  used for the whole session. Crisp bass identity per seed.
- **30% of seeds (drifting):** stickiness slowly drifts (fBm,
  slowest octave ~3.3–5.5 min) around a per-seed mean in
  [0.25, 0.6], clamped [0.05, 0.85]. Each seed in this bucket has
  an internal narrative arc — sometimes moving with chords,
  sometimes pedaling.

Velocity 0.65 beat 1, 0.48 beat 3, ±5% jitter. Beat-1 duration
700 ms, beat-3 350 ms — short on purpose to avoid sympathetic
resonance from sustained sines ("phone on table" effect). Beats
2 and 4 left silent (drum-and-bass pocket).

Architectural addition: `EngineState.chordSchedule` (per-window
list of `{time, chord}` entries). `ChordScheduler` clears and
populates it during its scheduleUntil pass; `BassScheduler` reads
it to know which chord is active at each bass emission. Cleanly
separates bass voicing decisions from chord progression logic
without duplicating Markov walk state.

Adapter: new sine `bass` synth in `chains/lofi.ts`, routes through
a tight 800 Hz lowpass then directly to warmth (skips chorus / evo
/ reverb so the bass stays dry and punchy). Volume −15 dB.
Envelope attack 0.005 / decay 0.3 / sustain 0.3 / release 0.18 —
tight and percussive. `Channels.BASS` registered.

Seed children: `bass` (per-beat rolls), `bass-mode` (fixed vs
drift), `bass-stickiness-config` (value or drift mean+freq),
`bass-stickiness-fbm` (drift noise; drifting mode only).

Engine fingerprint count 105 → 108 (3 beat-1 bass emissions per 5 s
window). First 6 events unchanged (bass at t=0 lands at MIDI 45,
sorted after the pad notes; falls outside the first-6 lock window).

---

## Next up

### Chord comping — remaining (B envelope refinement + D vocabulary)

A (rhythm) and C (voicing variety) are done. Remaining:

- **B — Hit envelope refinement.** Per-beat duration variation (beat
  1 vs beat 3 vs pickup vs sync); possible per-seed envelope shape.
  Honest call: with the 0.8 s release + voicing variety landed, this
  may be in the "good enough" zone — worth a listen pass before
  committing to the work.
- **D — Vocabulary expansion + chromatic approach.**
  - **Altered dominants** (`7♯5`, `7♭5`, `7♭9`) added to
    `harmony/chords.ts`; soft chromatic-friction resolutions per
    `archive/external-review.md` §A.4. Genre tension flag — these are
    jazzier than calm lofi; might want to defer or scope tightly.
  - **Chromatic approach tones.** One voice slides chromatically at
    slot transition instead of jumping.
  - **Melody-compat check first.** The melody germ is deliberately
    *key-relative* per `docs/melody.md` F2 — justified by the current
    chord vocabulary being pentatonic-friendly. Altered dominants
    aren't. Resolve `docs/gaps.md` "Chord vocabulary D vs. germ
    key-relativity" before committing this work; possible outcomes
    range from "fresh-rule filter handles it" to "scope-limit Chord D"
    to "revisit the F2 decision."

**Design constraint — read first:** every per-seed parameter must
follow the hybrid stack in
[docs/seed-identity.md](docs/seed-identity.md). Universal rules +
fBm drift + per-seed shape modifiers + couplings + mix bias. No
per-seed fixed knobs (except under the rare-event carve-out), no
categorical archetypes.

**Files:** `chord-scheduler.ts`, `harmony/chords.ts`,
`harmony/markov.ts`, `harmony/voicing.ts` (chromatic-approach
hook), tests.

---

## Recently done — pattern Markov + calmer targets

Family-listening pass (2026-06-19) flagged "the beat patterns sound
random — makes the whole thing sound random, like it wasn't thought
out carefully." Real diagnosis: the per-slot pattern roll had no
memory, so every slot was a fresh independent draw. Real musicians
commit to a feel for stretches and drift between feels musically.

Switched per-slot pattern selection from independent rolls to a
**Markov walk** on a transition matrix. Patterns stick (high
self-loops) and drift along the activity axis (banded off-diagonals);
far jumps (e.g. pure-hold → active-comping) are rare. The matrix is
constructed via detailed balance so its stationary distribution
exactly equals the new calm-leaning base weights
`[0.55, 0.28, 0.10, 0.05, 0.02]` (verified by power-iteration during
design).

Target distribution shifted from `[0.40, 0.30, 0.15, 0.10, 0.05]` to
`[0.55, 0.28, 0.10, 0.05, 0.02]` after honest review — the original
targets put active-comping at 5% of listening time (~3 min/hour) and
with the previous matrix it dwelled 28 s per burst. That's three
distinct Nujabes-style moments per half hour, too prominent for
calm-study music. Active-comping now lands at 2% of time with ~15 s
dwell — roughly 5 brief bursts per hour, totalling ~1.2 min/hour.

Key dwell times at 74 BPM, avg 9.1 s/slot (slot-bias mean 0.4):
- pure-hold: ~42 s
- hold-with-refresh: ~20 s
- call-response: ~17 s
- light-comping: ~20 s
- active-comping: ~15 s

Per-seed Dirichlet perturbation (α=20) of each matrix row keeps
every seed close to the base while giving each its own slight
stickiness profile. First slot still uses base weights via
`selectPattern` (no prior pattern); subsequent slots use
`selectNextPattern`. New seed child `chord-pattern-matrix-config`.

Verified on previously-flagged seeds: slot sequences now cluster
into 2-5-slot runs of the same pattern with adjacent-pattern drifts
at boundaries (e.g. `HwR → HwR → CR → CR → CR → CR → CR`), exactly
the "thought-out" feel the listening pass was missing.

Engine fingerprint count stays 113 (the 5 s window covers only the
first slot, which uses the pre-Markov path; adding a new seed child
doesn't shift the existing children's RNG sequences).

---

## Recently done — chord-synth envelope sustain raise

Diagnosis (via render-snippet on seed 18396323215971596544): the
`hold-with-refresh` pattern produced sustained chord rings at
amplitude ~0.15 (sustain 0.28 × velocity 0.55) — *quieter* than
the soft refresh taps that punctuated them (peak 0.40). Designed
as "ringing chord with subtle taps"; behaved as "near-silent
background pad with louder discrete attacks" — i.e. choppy.

Fix (2026-06-17, adapter-only): chord synth envelope sustain
raised 0.28 → 0.55. Sustained ring now lands at ~0.30 amplitude,
comparable to soft tap peak. The held chord is audibly *there*
during `pure-hold` and `hold-with-refresh` slot patterns. Melody
synth sustain stays at 0.28 to preserve percussive single-note
character — the chord/melody synth split now expresses *envelope*
character differences too, not just volume.

Side effect on active patterns: `light-comping` / `active-comping`
beats now have a slightly more present sustained body between
attacks. Probably a positive — chord feels more continuously
present without losing percussive character (attack and decay
phases unchanged).

A cleaner architectural answer remains queued in the backlog:
have the pad carry full chord harmony instead of root+fifth, and
the rhodes can return to a percussive envelope. See backlog
"Pad carries chord harmony."

---

## Recently done — chord / melody channel split (melody-rewrite prep)

Splits the shared Rhodes channel into `Channels.RHODES_CHORD` and
`Channels.RHODES_MELODY`. The adapter now hosts **two FMSynths
sharing the same Rhodes patch** (chord at −13 dB, melody at −9 dB)
both routing through the same chorus → evoFilter → pan → reverb-send
path. The 4 dB gap reads as "melody leads, chord supports" without
forcing extreme separation. Snare dropped −17 → −20 dB at the same
time (drum bus rebalance — chord cut left snare too prominent).

Why now (before melody work): motif / sustain / arpeggio tuning
needs the right chord-vs-melody balance to target on the first
pass. Tuning against a buried melody and retuning later was the
wasted-work path. This is the "Option B" mid-ground per the
discussion: volume separation now; full timbre split deferred to
the counter-melody stage where a second Rhodes-different patch is
already planned.

Engine fingerprint count stays 113; first 6 event signatures
change at the string level (`rhodes` → `rhodes_chord`).

---

## Recently done — render-snippet dev tool

`packages/core/scripts/render-snippet.ts` — runs the engine offline
for N seconds and dumps an LLM-readable text timeline (channel-aware,
bar-grouped, slot-annotated). Built specifically to combat ear
fatigue in tuning loops: instead of A/B'ing variants by listening
(which collapses over time), render a snippet, paste to chat, let an
LLM analyze for symptoms the listener can no longer reliably hear.

Usage:
```
pnpm --filter @loam/core build
node --experimental-strip-types packages/core/scripts/render-snippet.ts \
  --seeds 12017834852233104861,6476679919478941024,5750331000525312698 \
  --seconds 14
```

Not built or distributed; developer-only utility. The choppiness
diagnosis that triggered the chord pattern menu came directly from
running this on three user-provided seeds — see
`docs/seed-identity.md` and the chord-pattern-menu notes below.

---

## Recently done — chord comping pattern menu (rework)

Replaces the per-beat probability model with a per-slot pattern
menu. Decisions ironed out via discussion + snippet-driven
diagnosis (2026-06-17):

- **Diagnosis.** Render-snippet analysis on the user's three seeds
  showed beat-3 chord hits effectively never firing across 16
  seconds of three different seeds. With density mean 0.35,
  5-bar runs of beat-1-only happen ~11% of the time and produce
  perceived "the chord layer isn't carrying the harmony."
- **Reframing.** Calm lofi convention (Lofi Girl / chillhop / j'san
  reference) leans heavily on *sustained holds* with occasional soft
  re-articulation; rhythmic comping is a valid but rare mode
  (Nujabes / J Dilla flavour). The previous model was Nujabes-style
  by default; we wanted calm-sustained by default.
- **Pattern menu** (in `harmony/comping-patterns.ts`): pure-hold,
  hold-with-refresh, call-response, light-comping, active-comping.
  Base weights `[0.40, 0.30, 0.15, 0.10, 0.05]` Dirichlet-perturbed
  per seed at α=20. Activity-stream tilt (soft Boltzmann at K=3)
  shifts pattern selection toward calm in low-activity stretches
  and active in high. None categorical.
- **`HitSpec` declarative model.** Patterns return per-bar plans of
  `{beatOffset, velocity, thinness, durationBeats}`. Scheduler is
  a pure interpreter — knows nothing about probabilities.
- **`density` stream renamed to `activity`** (seed children
  `chord-activity-fbm/-config`). Single-responsibility input to
  `selectPattern`. Density-as-concept removed from the chord layer
  entirely.
- **Sync dropped.** Per-seed Beta off-beat substitution was a
  Phase-A artifact; pattern menu covers the design intent more
  cleanly. `chord-sync-config/-`, `sampleBeta` helper removed.
- **Voicing-thinness helper** (`applyThinness` in `voicing.ts`) maps
  `'full' | 'rootless' | 'top-voices'` onto pitch arrays without
  recomputing voicings.
- **Inter-instrument call-and-response** (chord layer holds, melody
  fills gaps) noted as future work — properly belongs in melody
  rewrite + arrangement-controller stages.

Engine fingerprint count stays at 113 (first 6 events at t=0 are
unchanged because seed 42's first pattern still emits beat 1 with
the same archetype voicing).

First exercise of seed-identity §3 (couplings — activity stream
biases pattern weights without becoming a fixed knob).

---

## Recently done — chord echo / delay send

`Tone.FeedbackDelay` added to the keys path in `chains/lofi.ts`
(2026-06-17). Tapped post-evoFilter so echoes carry the same colour
as the dry signal; output routed into the shared reverb bus
(echoes share the room — standard dub / lofi convention). Both
chord and melody hits get the tail because they share the keys
synth (melody timbre-split belongs in the counter-melody stage).

Settings: feedback 0.30, send gain 0.18 (mid wet). Delay time is
BPM-locked — the engine emits a one-shot `fx.chordEcho.time`
ParamEvent at `t=0` with value `60 / bpm` seconds (one quarter
note). Three params exposed for future fBm drift:
`fx.chordEcho.time`, `fx.chordEcho.feedback`, `fx.chordEcho.wet`.

Engine fingerprint count 112 → 113 (one new ParamEvent at t=0;
last rhodes voice rotates out of the 6-element fingerprint slice).

---

## Recently done — chord voicing variety (C)

Four voicing archetypes implemented in `harmony/voicing.ts` and
woven into `chord-scheduler.ts` (2026-06-17). Decisions ironed out
via discussion before code:

- **Archetypes:** `close` (existing greedy min-motion voice
  leading), `spread` (drop-2 applied to close), `rootless` (chord
  intervals minus root and 5, plus 9 if absent — 3+ voice color
  voicing), `quartal` (3-voice stacked-fourths; quality-specific
  start tone — 4 for min/dom, 7 for maj).
- **Selection:** per slot, sampled from per-seed Dirichlet-perturbed
  weights (α=20) on base `[0.55, 0.20, 0.20, 0.05]`. Universal —
  same weight vector for every chord (per-chord weight tables are
  noted as a future improvement).
- **Voice-leading:** within-archetype min-motion (close-to-close
  smooths from prev). Archetype transitions reset to fresh voicing
  — forcing smoothing across archetype boundaries produces hybrid
  voicings that lose archetype identity.
- **Micro-variation:** bars 2+ of any slot have a 30% chance of
  dropping one inner voice (uniform pick from indices 1..N-2 of the
  sorted voicing). Bar 1 always full.
- **Pickup:** uses next slot's archetype voicing with the bottom
  voice dropped (rootless preview — the next downbeat anchors the
  root). Inherits archetype, doesn't roll its own.
- **Engine fingerprint reset** count 116 → 112; seed 42's first
  archetype roll lands on quartal, producing a 3-voice opening
  voicing instead of 4-voice close. Documented in
  `docs/seed-format.md` §7.3a.

First instance of seed-identity §5 (per-seed structured-choice
realization via Dirichlet) on top of the existing Markov layer.

**Weight-tuning postscript (2026-06-17):** after a calibration
pass the listener hit ear-fatigue (every variant started sounding
similar). Decision: ship theory-anchored values
(`[0.55, 0.20, 0.20, 0.05]`, α=20, drop=0.3) which match published
calm-lofi voicing-distribution conventions (Levine, Evans / Pass
analyses). Holistic re-tuning of chord weights deferred to after
melody rewrite + counter-melody + arrangement + mix-bias land —
chord's role in the mix changes substantially once those exist,
so tuning now in isolation is premature.

---

## Recently done — chord comping rhythm (A)

Bar-grid rewrite of `chord-scheduler.ts` (2026-06-17). Replaces
the one-sustained-voicing-per-Markov-step model with rhythmic
comping. Decisions ironed out via discussion before code:

- **Slot length** ∈ {2, 4} bars per chord, drawn per slot biased by
  a slow fBm stream (`chord-slot-bias`, range [0.2, 0.6], slowest
  octave 120 s). Per-seed shape: mean offset + depth modifier.
- **Hit positions.** Beat 1 of every bar always fires (tightened
  same-day after listen pass — earlier "roll on subsequent bars"
  produced up to ~13 s of chord silence in low-density patches and
  read as "the music stopped" rather than "breathing room"). Beat 3
  of every bar rolls against a density fBm stream (`chord-density`,
  range [0.2, 0.65] mean 0.35, slowest octave 90 s). Range and mean
  tightened from initial [0.3, 0.9] mean 0.6 after a second listen
  pass flagged the chord layer as busier than canonical lofi.
- **Pickup** ("and of 4" of the slot's last bar) at universal 15%,
  voicing the *next* chord (anticipation). Velocity × 0.7, duration
  0.5 beat.
- **Off-beat syncopation** (beat 2.5) per-seed Beta(2, 5)·0.05
  fixed-rate draw; substitutes for beat-1 of the bar; 16-bar
  refractory period prevents clustering. Carve-out from the
  "no per-seed fixed value" rule because drift would be invisible
  at this event interval — see seed-identity.md §"Carve-out".
- **Hit durations** beat-relative: beat 1 = 1 beat, beat 3 = 0.75,
  pickup = 0.5, sync = 0.75 (computed from BPM at emit).
- **Folded "B-lite":** keys synth release shortened in `lofi.ts`
  from 2.6 s to 0.5 s so comping hits actually cut. Full per-beat /
  per-seed envelope work in B is still open.
- **Engine fingerprint reset** count 108 → 112; pad now emits ahead
  of rhodes at slot starts; documented in `docs/seed-format.md`
  §7.3a.

First exercise of the seed-identity stack: slot-bias and density
both use §1 (universal fBm) + §2 (per-seed shape); sync rate uses
the rare-event carve-out.

---

## Recently done — stereo + per-instrument reverb

**Stereo + per-instrument reverb details:** `chains/lofi.ts`
restructured as a send/return mixer. One shared `Tone.Reverb` (wet=1,
decay 7, preDelay 0.02) sits on the return; each instrument has its
own `Tone.Panner` (dry path → warmth) and its own `Tone.Gain` send
into the reverb input. Replaces the old in-line `keys → chorus →
evoFilter → reverb → warmth` chain. Per-instrument pan + send levels:
keys −0.15 / 0.45, pad StereoWidener 0.8 / 0.6, bass 0 / dry, kick
0 / dry, snare +0.15 / 0.3, hat +0.4 / 0.08, brown bed
StereoWidener 0.9 / dry, rain unchanged (already stereo), crackle
center / dry. Chorus + evoFilter remain in line on the keys path
only (pad goes wide via the widener instead). `fx.evoFilter.cutoff`,
`fx.chorus.depth`, `fx.drumBus.cutoff` param targets all preserved.

---

## Backlog (ordered by listening impact)

### Chord pattern-layer identity strengthening (deferred)

Per-slot pattern Markov (landed 2026-06-19) introduced memory and
fixed the "random mash" feel, but at the cost of slightly weakened
per-seed identity in the *pattern* dimension specifically. The
Markov chain mixes toward its stationary distribution, which is
closer to the universal base than the per-seed perturbed matrix
is.

Deferred because: no listening evidence yet that seed identity in
the chord layer actually feels weak. The eight-axis identity stack
(BPM, register, chord-Markov, archetypes, pattern weights, pattern
matrix, activity shape, slot-bias shape) is genuinely diverse.

**When to revisit:** if seeds start sounding similar in the chord
layer after melody + arrangement work lands.

**Concrete options (analyzed 2026-06-19, full notes in
[docs/seed-identity.md](docs/seed-identity.md) "Known weak spots"):**

1. Per-seed activity-tilt strength (`K ∈ [1, 5]`). Cheapest;
   meaningful effect. **Recommended first move.**
2. Per-seed favorite-transition spikes (amplify 1-2 transitions
   per seed). Some perceptual risk.
3. Per-seed activity↔slot-length coupling. First exercise of
   seed-identity.md §3 (couplings — the unused layer of the
   framework).

**Files when picked up:** `chord-scheduler.ts` (seed-children
draws), `comping-patterns.ts` (parameter on `selectNextPattern`).

---

### Pad carries chord harmony (sustained-chord architectural fix)

Today the pad plays root + fifth only, at -20 dB, sustaining for
the chord-slot duration. The "sustained chord" feel during
`pure-hold` and `hold-with-refresh` patterns depends entirely on
the chord synth's envelope sustain phase being audible (we raised
it 0.28 → 0.55 on 2026-06-17 to address this).

A cleaner architectural answer: have the pad play the **full chord
harmony** (or at least the inner voices the rhodes isn't carrying)
during the slot. Then:
- Pad becomes the sustained chord background (its actual role).
- Rhodes chord layer can return to a more percussive envelope —
  shorter sustain — since it just punctuates rhythmically.
- The chord/melody envelope split widens naturally (rhodes back
  to percussive, melody already percussive).

Implications:
- Pad scheduler needs the chord voicing, not just root + fifth.
- Pad volume probably needs to come up (−20 dB → maybe −16 dB) so
  the harmonic body is actually audible without dominating.
- Per-seed mix-bias (next stage) becomes part of how we tune the
  rhodes-vs-pad balance.

Surfaced 2026-06-17 during the sustain-envelope discussion; queued
as a candidate post-melody, alongside mix-bias.

**Files:** `chord-scheduler.ts` (or new `pad-scheduler.ts` if pad
gets its own logic separate from chord), `chains/lofi.ts`
(pad volume), pad-related tests.

---

### Mix-bias per seed — chord-dominance rebalancer

Small standalone stage. The chord layer is structurally the busiest
element (4-voice polyphonic Rhodes hits on every bar) and currently
sits at a fixed −11 dB. Per-seed mix bias lets some seeds comp at
−14 dB ("chords-in-back") and others at −9 dB ("chords-forward"),
giving each seed a recognizable production personality without
changing the music itself. The §4 ("orchestration / mix bias")
lever of [docs/seed-identity.md](docs/seed-identity.md) — applied
for the first time.

**Bundle:**

- Per-seed `chord-mix-bias` continuous draw in (e.g.) [−4, +4] dB.
  Continuous distribution, no buckets.
- Apply at engine init via a one-shot `ParamEvent` (or a new
  `chord.volume` adapter param) on top of the chain's static dB.
- Audit pad and bass volumes — likely candidates for the same
  treatment if chord-bias alone doesn't fully rebalance.

**Why now (queued after B + C):** revisit chord dominance after
the melody rewrite (B) and voicing variety (C, including rootless
voicings — naturally lighter weight). Rootless voicings + a better
melody may cover most of the dominance problem on their own; mix-
bias becomes the residual fix and a per-seed identity hook.

Discussed 2026-06-17 during chord-comping listen pass — see
`docs/seed-identity.md` §4 for the rationale.

**Files:** `chains/lofi.ts`, `ember.ts` (per-seed draw + param
emit), new `chord.volume` adapter param.

---

### Seed discovery — inspect, find-by-character, presets

Every per-seed knob (BPM, melody activity mean, coupling mean, template
choice, swing ratio, compound rate, ...) is deterministic from the
seed and computable without running the engine. Today the user has no
way to navigate this space — they pick a seed, hear what it is, and
move on. Reading docs/seed-identity.md, the principled answer to
"user wants a calmer seed" is a seed-discovery affordance, not a
post-hoc identity-override knob (the latter would re-introduce the
same problem we removed when the BPM slider went away in Stage 6.5
and the density slider went away on 2026-06-22).

**Bundle:**
- `previewSeed(seedValue): SeedCharacter` — pure function returning
  all per-seed derived parameters (BPM, melody activity mean,
  coupling mean, template ID, swing ratio, compound rate, etc.)
  without instantiating the engine. O(1).
- **Seed inspector UI**: when a seed loads, show its character
  ("calm | BPM 63 | sparse melody | arpeggio template | tight swing").
- **"Find me calmer/busier"**: deterministic forward search from
  the current seed for the next one matching a filter (e.g.
  `activityMean < X`). Returns a seed value the user can load.
- **Optional**: pre-computed character buckets shipped as data for
  the first N seeds (calm / medium / energetic).

**Why now:** the melody rewrite shipped, and the density slider was
removed because it conflicted with seed-identity. Seed discovery is
the right tool for the "I want a different mood" use case the slider
was poorly serving.

**Files:** new `seed-preview.ts` (likely in `engines/ember/`),
web-demo UI additions, possibly `docs/seed-identity.md` doc updates.

---

### Arrangement controller — phrase structure + dropouts + silences

The engine has no concept of "8-bar phrase" or "16-bar section." All
instruments play continuously; nothing ever drops out. Real lofi
tracks *breathe* — sometimes 8 bars of pad + melody only (drums out),
sometimes drums + bass alone, sometimes everything but kick steps
out. The coming-and-going *is* the variation; you don't need to
change what each instrument plays as much as you need to change
whether it plays.

**Bundle (new module + engine wiring):**
- Phrase counter on `EngineState` (current bar within the active
  N-bar phrase).
- New `ArrangementController` that decides per phrase which
  instruments are active. Sub-schedulers respect the active mask
  (emit no events when muted).
- Smooth handoffs at phrase boundaries (no mid-phrase mutes).
- Genuine silences allowed (the engine *can* go to just pad + crackle
  or just pad for short windows).

**Why now:** requires drums + bass + melody to be in their final
form (only meaningful if there are multiple elements worth muting).

**Files:** new `arrangement-controller.ts`, `ember.ts` wiring, every
sub-scheduler reads the mute mask.

---

### Lofi texture nodes — wow/flutter, tape hiss, bitcrush, saturation

The canonical lofi texture knobs (per `docs/lofi-study.md` §9) that
the current chain entirely lacks. Currently we have vinyl crackle
(via `Channels.BELL`) and chorus depth drift — that's it. Real lofi
uses these tape/vinyl artifacts as foundational color, not optional
garnish.

**Bundle (all touch `chains/lofi.ts` adding new audio nodes):**
- Wow/flutter LFO modulating the master tape "pitch."
- Tape hiss bed (pink noise at very low level, gated lightly).
- Bitcrush or sample-rate-reducer for that mid-fi character.
- Saturation / soft-clip for warmth.
- Expose each as a `ParamSetter` so listen-distance fBm can drift
  them (replaces the deferred "real listen-distance targets" note
  from Stage 7b).

**Files:** `chains/lofi.ts`, possibly new ParamEvent emissions in
`ember.ts`.

---

### Timbre swaps + counter-melody

Currently one Rhodes timbre handles both chords *and* melody. Real
lofi often splits these — Rhodes for chords, melodica or muted Wurli
for melody. A second melodic voice (counter-melody on a different
timbre) that fills silences when the main melody is out adds the
"two musicians talking" quality that single-melody engines lack.

**Bundle (touches `chains/lofi.ts` + new scheduler + engine routing):**
- Second melody synth in the chain (vibraphone-y or muted Wurli).
- New `Channels.MELODY_B` (or rename existing roles to clarify).
- Counter-melody scheduler — fires in the silences of the main
  melody, picks from chord tones with a different rhythmic profile.

**Why later:** depends on the melody rewrite (counter-melody fills
the main melody's silences, which only become meaningful gaps after
melodies have motifs + sustain instead of constant noodling).

**Files:** `chains/lofi.ts`, new `counter-melody-scheduler.ts`,
`channels.ts`, `ember.ts`.

---

### Key drift with pivot-chord modulation

The deferred "Stage 7.5" — drift the key center over many minutes
(A minor → D minor → F major → back) using pivot-chord modulation to
keep transitions smooth. Real harmonic-journey work. Requires the
chord scheduler to time key changes to land at chords common to both
keys.

**Why later:** drift on top of a richer foundation. The harmonic
journey only matters if the moment-to-moment harmony is already
interesting.

**Files:** `chord-scheduler.ts`, possibly new `harmony/modulation.ts`,
position-stream second axis or new fBm driver.

---

### Ornament point-process

The deferred "Stage 8" — implement the Cox + refractory point
process from `docs/ornaments.md` for subtle salient events. Per-type
inhibitory rates prevent any single ornament from repeating too
quickly. Free `Channels.BELL` from temporary crackle reuse and give
it its actual bell-tone semantics.

**Why last:** ornaments are *garnishes* over the foundation;
spotlighting a moment matters only if the underlying texture is rich
enough that the spotlight reads as intentional, not as noise breaking
through a thin mix.

**Files:** new `ornament-scheduler.ts`, `chains/lofi.ts` for the bell
synth (replacing crackle's BELL reuse), `channels.ts`.

---

## Parked (revisit after this list is done)

- **Engine-driven warmth / engine-driven master volume.** Conflicts
  with user sliders on the same parameter (the density / warmth
  conflict pattern). Workable but not urgent.

- **Python validation harness.** Render N minutes of a seed offline,
  FFT-check that fBm-driven parameters hit a 1/f spectrum. Build-time
  tool per the spec's "Python authors, TS performs" rule. Insurance,
  not urgent.

- **Discrete dynamics overrides** (Eno's Oblique Strategies as a
  third dynamics primitive — windowed state change distinct from
  fBm and ornaments). Captured in `archive/external-review.md` §B.

- **Ambient-mode reservations** (reverb freeze, granular synthesis,
  pitch-shifted delays) — only relevant if/when an Ambient engine
  exists alongside Ember. See `archive/external-review.md` §C.

---

## Open scope questions

These could be addressed any time:

- **Track transitions** — currently audibly abrupt. Determine how to
  smoothly transition from one seed/session to another.

- **Vinyl crackle responsive to dynamics** — crackle currently fires
  uniformly. Real vinyl noise clusters in quiet passages. Tiny tweak.
