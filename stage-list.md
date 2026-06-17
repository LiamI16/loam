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

## Done (post-replan)

| Stage | What | Notes |
|---|---|---|
| Drum rewrite | Per-bar variation + per-voice micro-timing + velocity accents + mild 16th-swing | See below |
| Bass scheduler | Separate bass voice, sparse root-on-beat-1 + maybe-fifth-on-beat-3 pattern | See below |
| Stereo + per-instrument reverb | Send/return mixer; per-instrument pan + reverb send level | See below |
| Chord comping (A: rhythm) | Bar-grid scheduler; {2,4}-bar slots; beat-1 anchor + density-driven hits + pickup + rare off-beat sync. Folded "B-lite": keys release 2.6 → 0.5 s. | See below |

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

### Chord comping — voicing variety (B + C + D)

A (rhythm) is done. Remaining work in the comping bundle:

- **Hit envelope refinement.** Per-beat duration variation (beat 1
  vs beat 3 vs pickup vs sync); possible per-seed envelope shape.
  A folded a minimal piece (keys release 2.6 → 0.5 s) so comping
  reads as comping; full envelope work still open.
- **Voicing micro-variation per hit within a slot.** When the chord
  re-articulates on bar 2 / 3 / 4 of a slot, slight voicing change
  from bar 1 (drop a voice, swap inversion, add or remove the 9).
- **Voicing archetype variation per chord re-occurrence.** Close /
  spread / rootless / quartal picked per occurrence. Weighted to
  favor close with rarer excursions. Per-seed weight perturbation
  (Dirichlet, like the Markov layer).
- **Altered dominants** (`7♯5`, `7♭5`, `7♭9`). Vocabulary expansion
  in `harmony/chords.ts`.
- **Chromatic approach tones.** Occasional chromatic voice motion
  at slot transition.

**Design constraint — read first:** every per-seed parameter must
follow the hybrid stack in
[docs/seed-identity.md](docs/seed-identity.md). Universal rules +
fBm drift + per-seed shape modifiers + couplings + mix bias. No
per-seed fixed knobs (except under the rare-event carve-out), no
categorical archetypes.

**Files:** `chord-scheduler.ts`, `harmony/voicing.ts`,
`harmony/chords.ts`, voicing tests.

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

### Chord echo / delay send (small post-comping tune-up)

Tiny stage. Adds a feedback-delay node on the rhodes path with a
quarter-note tap and ~30% feedback. Each chord-comping hit gets a
gentle rhythmic echo tail — makes one hit feel like several, dub /
lofi tradition. Complementary to comping: the silence between
comping hits gets *filled* by the echo of the previous hit.

Expose `fx.chordEcho.feedback` / `fx.chordEcho.wet` as
`ParamSetter`s so future fBm drift can modulate.

**Files:** `chains/lofi.ts` (one `Tone.FeedbackDelay` node + a
send on the keys synth + two new `registerParam` calls).

---

### Melody rewrite — motifs + sustain + pickups + arpeggiation

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
- **Arpeggiation as a melodic strategy.** Sometimes the melody plays
  a chord-tone arpeggio (broken chord sequence) instead of a scalar
  phrase or held note. Sits as one strategy among several;
  arpeggio-leaning seeds get a recognizably "broken chord" feel
  without the chord scheduler having to know about it. Bundled here
  per the 2026-06-17 design decision (Path Y: role-separation —
  chord scheduler always comps, melody scheduler covers arpeggios).

**Why now:** addresses the "melody has no character" complaint.
Drums + bass need to be in place first so the melody has something
musical to sit on.

**Files:** `melody-scheduler.ts`, melody tests, possibly the
"Stage 9 L-system" sketch in archived planning notes (this stage
supersedes it).

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
