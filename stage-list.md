# Stage list

> The active development checklist. Each stage is a single feature
> addressing one specific gap, sized to land in one sitting. Bundles
> happen when sub-features touch the same files / functions in
> incompatible-to-split ways. Ordered by listening impact, not by
> architectural category.
>
> Replaces `current-stage-list.md` (deleted). `phase1-stage-list.md`
> retained as the historical prototype-port log.
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
| Phase 1 | Foundation, prototype port (Stages 1–4) | `phase1-stage-list.md` |
| Stage 5 | fBm `ParamStream` + density / evo-filter dynamics | `docs/dynamics.md` |
| Stage 6 | Markov chords (Dirichlet-perturbed) + greedy voice-leading | `docs/harmony.md` |
| Stage 6.5 | User speed multiplier; BPM slider removed (redundant) | inline |
| Stage 7a | `PositionStream` substrate + voicing register drift | inline |
| Stage 7b | Listen-distance fBm (chorus depth, drum-bus cutoff) | inline |
| Stage 7c.1 | Modes-of-C data layer (6 modes, blending helpers) | inline |
| Stage 7c.2 | Mode blending wired into Markov + melody | inline |
| Follow-up | Per-seed BPM derivation, range [60, 90] | inline |

**Test count:** 86 green. **Engine fingerprint locked at `Seed.from(42n)` with `bpm: 74`** as the seed-format contract surface (see `docs/seed-format.md` §7.3a for the layered locks).

---

## Next up

### 1. Drum rewrite — per-bar variation + swing + accents

Drums are the heartbeat; mechanical drums make everything feel
mechanical. Current state: kick on grid, snare on grid, hat on every
8th, velocity has slight jitter, no swing. This is the single biggest
"feels boring" contributor flagged in the user's listening pass.

**Bundle (all touch `drum-scheduler.ts`):**
- Per-bar variation: ghost snare hits, occasional open hi-hat, kick
  syncopation, hat drops every N bars. Bar-to-bar mutation with
  drummer-style probabilities (not pure CA).
- Swing per voice: snare drags behind beat (62%+), hat sits ahead,
  kick on grid. Per-element micro-timing vector, not one bus swing.
  Targets from `docs/external-review.md` §A.1 / §A.3.
- Velocity accents within a bar: beat 1 louder, beats 3-4 softer,
  off-beats softer than down-beats. Real groove dynamics, not the
  current uniform jitter.

**Why first:** user's biggest listening complaint; everything else
lands better on top of drums that breathe.

**Files:** `drum-scheduler.ts`, drum tests.

---

## Backlog (ordered by listening impact)

### 2. Bass scheduler

A missing instrument. Currently the pad does double-duty as bass
(root + fifth, holds 4 bars). Real lofi almost always has a separate
bass that *moves* — walking, syncopating, ghosting, accenting chord
changes. Adding a proper bass voice fundamentally broadens the
texture and addresses the "2-bar chord cycle feels repetitive" gap
(half of which is the immobile bass).

**New scheduler:** `bass-scheduler.ts` (parallels chord-scheduler).
Reads `state.currentChord`, generates a walking/syncopated bass line
keyed to the chord. New channel `Channels.BASS`. Adapter synth: an
AM or sine bass with short envelope (separate from pad's AM blanket).

**Files:** new `bass-scheduler.ts`, new bass synth in
`chains/lofi.ts`, new `Channels.BASS`, `ember.ts` wiring.

---

### 3. Stereo + per-instrument reverb (audio chain mixing)

Cheap, transformative. Current chain is mono and routes everything
through one global reverb — flat. Real lofi takes advantage of stereo
panning (Rhodes slightly left, melody right, drums center, pad wide)
and differential reverb wetness per element (kick dry, snare medium,
melody wet, pad drenched). Both changes are small adapter-side edits
with outsized perceptual return.

**Bundle (all touch `chains/lofi.ts` chain restructure):**
- Stereo panners per instrument (Rhodes, melody, drums, pad, bass).
- Per-instrument reverb sends instead of one bus reverb.
- Possibly: separate hat / kick / snare pans for stereo drum width.

**Why third (not first):** the gain is biggest after drums + bass are
in their final form — pan + reverb decisions depend on knowing the
final instrument set.

**Files:** `chains/lofi.ts`.

---

### 4. Melody rewrite — motifs + sustain + pickups

The melody currently has zero memory between notes (each pitch is an
independent Bernoulli draw from a pentatonic bag). Real melodies
*reference themselves* — a 3-note motif appears, returns 4 bars later
in slight variation, returns again. That's what gives "a melody"
versus "noodling." User's other big listening complaint.

**Bundle (all touch `melody-scheduler.ts`):**
- Motivic memory: scheduler retains a short rolling buffer of recent
  notes; new emissions probabilistically repeat / transpose / invert
  recent material. Replaces pure Bernoulli pitch picking.
- Sustained tones: emit half-notes and whole-notes alongside the
  current 4n / 8n. Space + holds are half the genre.
- Pickup notes / anacrusis: phrase beginnings get a soft lead-in
  note instead of starting cold on the downbeat.

**Why fourth:** addresses the user's "melody has no character"
complaint. Drums + bass need to be in place first so the melody has
something musical to sit on.

**Files:** `melody-scheduler.ts`, melody tests, possibly the
"Stage 9 L-system" sketch in archived planning notes (this stage
supersedes it).

---

### 5. Arrangement controller — phrase structure + dropouts + silences

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

**Why fifth:** requires drums + bass + melody to be in their final
form (only meaningful if there are multiple elements worth muting).

**Files:** new `arrangement-controller.ts`, `ember.ts` wiring, every
sub-scheduler reads the mute mask.

---

### 6. Chord voicing variety per occurrence

Refinement on the existing chord scheduler. When `Am7` appears at
bar 5 and again at bar 13, we voice it nearly identically. Real
pianists alternate voicings within a phrase — different inversions,
different extensions, occasional chromatic approach tones. Stage 6
added a single wobble embellishment; this stage extends it into a
real voicing-variation engine.

**Includes:**
- Multiple voicing archetypes (close, spread, rootless, quartal)
  per chord, picked stochastically per occurrence.
- Chord substitution at voicing time (Am7 occasionally voiced as
  Cmaj7/A — same pitches reorganized, different feel).
- Occasional chromatic approach tones in the voice-leading.
- Altered-dominant vocabulary expansion (`7♯5`, `7♭5`, `7♭9`) per
  `docs/external-review.md` §A.4 — softer chromatic-friction
  resolution than plain V7, fits the lofi "never resolve hard"
  rule. Adds Markov matrix rows for the new chords.

**Files:** `chord-scheduler.ts`, `harmony/voicing.ts`,
`harmony/chords.ts`, `harmony/markov.ts`, voicing tests.

---

### 7. Lofi texture nodes — wow/flutter, tape hiss, bitcrush, saturation

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

### 8. Timbre swaps + counter-melody

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

### 9. Key drift with pivot-chord modulation

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

### 10. Ornament point-process

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

- **Theme-and-variations on an invisible germ.** Seed defines a tiny
  musical germ (3-note shape + chord pair); everything generated is
  a variation. Closer to how Beethoven's late quartets work than to
  statistical methods. Would require real music-theory work
  ("is this passage a variation of the germ?"). Considered during
  Stage 7 planning (2026-06-16); the deepest coherence mechanism the
  engine could have, but very large lift.

- **Engine-driven warmth / engine-driven master volume.** Conflicts
  with user sliders on the same parameter (the density / warmth
  conflict pattern). Workable but not urgent.

- **Python validation harness.** Render N minutes of a seed offline,
  FFT-check that fBm-driven parameters hit a 1/f spectrum. Build-time
  tool per the spec's "Python authors, TS performs" rule. Insurance,
  not urgent.

- **Discrete dynamics overrides** (Eno's Oblique Strategies as a
  third dynamics primitive — windowed state change distinct from
  fBm and ornaments). Captured in `docs/external-review.md` §B.

- **Ambient-mode reservations** (reverb freeze, granular synthesis,
  pitch-shifted delays) — only relevant if/when an Ambient engine
  exists alongside Ember. See `docs/external-review.md` §C.

---

## Open scope questions

These could be addressed any time:

- **Track transitions** — currently audibly abrupt. Determine how to
  smoothly transition from one seed/session to another.

- **Vinyl crackle responsive to dynamics** — crackle currently fires
  uniformly. Real vinyl noise clusters in quiet passages. Tiny tweak.
