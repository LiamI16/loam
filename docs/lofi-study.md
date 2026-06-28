# Lo-fi Music Theory — Survey for Seed-Driven Generation

> **Status:** §1–9 are reference taxonomy actively informing Stage 6+
> harmony/melody/voicing decisions. §10–12 (subgenre archetypes, knob
> surface, mix knobs) are *design space only* — catalogued as candidates
> but not yet selected/implemented. §11's density slider was explicitly
> removed in Stage 6.5. Don't read §10–12 as canonical behavior.

> Reference document. The goal: catalogue every lever we can turn that still
> sounds *lo-fi* — so the seed can pick a flavor (Nujabes-ish jazz, dusty
> boom-bap, bossa, ambient-tilted, 70s soul-sample) without ever leaving the
> genre's gravity well. Each section ends with **→ knob:** notes on how it
> could map to a seed parameter.

---

## 1. Keys & Modes

Lo-fi's harmonic flavor is **jazz/soul-derived**, so the key choice carries a
strong mood. The genre tolerates *all twelve* tonics, but only a handful of
**modes** are idiomatic.

| Mode | Feel | Typical use | Examples |
|---|---|---|---|
| **Dorian** (i–IV) | Cool, melancholy-but-hopeful — the *signature* lofi mode | Most Nujabes-school tracks | D Dorian over C maj scale |
| **Aeolian / Natural minor** | Sadder, heavier | Late-night, rainy tracks | A minor |
| **Ionian / Major** | Warm, nostalgic, Sunday-morning | Soul-sample feel | C, F, B♭ major |
| **Mixolydian** | Bluesy, slightly unresolved | Soul/funk leaning | G Mixo |
| **Lydian** | Dreamy, floating, "anime opening" | Sparse ambient lofi | F Lydian |
| **Phrygian** | Dark, exotic — *rare*, used in tension passages | "Sad lofi" subgenre | E Phrygian |
| **Harmonic / Melodic minor** | Jazz-ier, more dramatic | Brief passes only — too "moment-y" | A harmonic minor |

**Tonal centers in real catalogs:** flat keys (F, B♭, E♭, A♭) are
disproportionately common because they come from sampling jazz/soul records
cut in horn-friendly keys. Sharp keys (D, A, E) appear in guitar-rooted lofi.

**→ knob:** `key` (0–11 semitone offset) × `mode` (weighted pick from table).
Bias toward Dorian/Aeolian/Ionian (≈70% combined). Avoid harmonic minor as a
*base* mode — only as a 2-bar borrowed passing color.

---

## 2. Chord Vocabulary

Lo-fi essentially never uses bare triads. The default unit is the **7th
chord**, with frequent 9ths, 11ths, 13ths, and added 6ths. This is the single
biggest "DNA marker" of the genre.

### Core chord qualities

| Symbol | Intervals | Mood | Frequency |
|---|---|---|---|
| **maj7** | 1 3 5 7 | Soft, dreamy, "warm sun" | Very high |
| **maj9** | 1 3 5 7 9 | Lush, even sweeter | Very high |
| **min7** | 1 ♭3 5 ♭7 | Cool, neutral-melancholy — workhorse | Very high |
| **min9** | 1 ♭3 5 ♭7 9 | Smokier min7 | High |
| **min11** | 1 ♭3 5 ♭7 9 11 | Open, suspended-feeling | High |
| **6** | 1 3 5 6 | Vintage, 50s/jazz | Medium |
| **min6** | 1 ♭3 5 6 | Bossa, Brazilian color | Medium |
| **add9** | 1 3 5 9 | Pop-jazz, no 7 — gentler than maj7 | Medium |
| **maj7♯11** | 1 3 5 7 ♯11 | Lydian shimmer, *very* lofi-dreamy | Medium |
| **7** (dom7) | 1 3 5 ♭7 | Bluesy; *use sparingly* — pulls toward resolution | Medium |
| **9** (dom9) | 1 3 5 ♭7 9 | Soul, Stevie-ish | Low-medium |
| **13** | 1 3 5 ♭7 9 13 | Big jazz dom | Low |
| **m7♭5 / ø7** | 1 ♭3 ♭5 ♭7 | ii of minor — passing color | Low |
| **dim7** | 1 ♭3 ♭5 ♭♭7 | Chromatic passing chord only | Low |
| **sus2 / sus4** | suspended | Floating, hookless | Medium |

### Extensions / alterations (jazz icing)

- **9, 11, 13** — almost always added freely to maj7/min7. The "11" on a maj7
  becomes ♯11 (avoid the perfect 11 over a major 3rd — it clashes).
- **♭9, ♯9, ♭13** on dominants — for jazzier turnarounds only; lofi usually
  resolves these to a maj9, not back to a dom.
- **Slash chords** — extremely common. `Fmaj7/G`, `C/E`, `Am7/D` give modal,
  hovering motion without changing the bass much.

**→ knob:** `chord_color_palette` — pick a weighted bag per seed.
- "Nujabes" palette: heavy maj7/min9/maj7♯11, light dom7
- "Dusty" palette: min7/min11/sus, no extensions above 9
- "Soul" palette: 6, 9, dom9, slash chords
- "Ambient lofi": maj7♯11, sus2, add9 only — no dom7 at all

---

## 3. Chord Progressions (Iconic Patterns)

These are the bread and butter. Most lofi loops are **2 or 4 chords in a 2- or
4-bar cycle**, repeating indefinitely with re-voicing.

### Diatonic loops (no borrowed chords)

| Roman numerals | Example (C) | Vibe | Notes |
|---|---|---|---|
| **ii–V–I** | Dm7–G7–Cmaj7 | Jazz turnaround | The most-used cell in jazz, frequent in lofi |
| **I–vi–ii–V** | Cmaj7–Am7–Dm7–G7 | 50s doo-wop, super warm | "Heart and Soul" topology |
| **vi–IV–I–V** | Am–F–C–G | Pop-flavored lofi | Slightly more "energetic" — use less |
| **I–IV–vi–V** | C–F–Am–G | Bright, nostalgic | |
| **IV–iii–ii–I** | Fmaj7–Em7–Dm7–Cmaj7 | Descending, very "study lofi" | Stepwise descent = signature gesture |
| **iii–vi–ii–V** | Em7–Am7–Dm7–G7 | Jazzier I–vi–ii–V | |
| **i–♭VII–♭VI–♭VII** | Am–G–F–G | Aeolian rock-lofi | |
| **i–iv–♭VII–III** | Am–Dm–G–C | Andalusian-ish in minor | |

### Modal loops (the *true* lofi engine)

These are 2-chord vamps that don't go anywhere — perfect for "infinite" music.

| Pattern | Example | Mode | Notes |
|---|---|---|---|
| **i–IV** | Dm9–Gmaj7 | Dorian | THE classic Nujabes/lofi vamp |
| **Imaj7–IVmaj7** | Cmaj7–Fmaj7 | Ionian | Sunny, lazy |
| **i–♭VII** | Am7–Gmaj7 | Aeolian | Melancholy hover |
| **Imaj7–♭VIImaj7** | Cmaj7–B♭maj7 | Mixolydian-ish | Dreamy, slightly unmoored |
| **i–v** | Am7–Em7 | Aeolian | Static, sad |
| **Imaj7♯11–II7** | Cmaj7♯11–D7 | Lydian | "Anime opening" |

### Jazz "rhythm changes" fragments

Short cells lifted from bebop standards — used as 2-bar passing motion:

- **iii–VI–ii–V**: Em7–A7–Dm7–G7 (back-cycle of 5ths)
- **I–VI7–ii–V**: Cmaj7–A7–Dm7–G7 (secondary dominant on the vi)
- **Imaj7–III7–vi–II7**: Cmaj7–E7–Am7–D7 (chain of secondary dominants — *the* "Autumn Leaves" feel)

### Borrowed / modal mixture (used sparingly for color)

- **iv (minor IV) in major key**: Cmaj7 → Fm6 → Cmaj7 — bittersweet
- **♭VI / ♭VII in major**: Cmaj7 → A♭maj7 → B♭maj7 → Cmaj7 — cinematic
- **Tritone sub**: replace V with ♭II7 (D♭7 → C) — smooth chromatic resolution

### Anti-patterns (avoid for lofi)

- **V–I cadences with a dramatic resolution** (drops the "infinite" feel)
- **Diminished chord on beat 1**
- **Long stretches of static dominant 7** (sounds bluesy, not jazzy)
- **Modulation between sections** (no sections = no modulation)

**→ knob:** per seed, pick:
- `progression_set` — bag of 2–6 progressions in the seed's chosen mode
- `progression_length` — 2-bar vamp vs 4-bar vs 8-bar (longer = more variety per cycle, shorter = more meditative)
- `borrowed_chord_probability` — 0–15% chance per cycle to insert a modal mixture chord
- `secondary_dominant_probability` — 0–10% to insert a passing V7/x

---

## 4. Voicings (the *sound* of lofi piano/Rhodes)

A chord is just a symbol; the **voicing** is what makes it sound lofi.

### Rules of thumb

- **Drop the root.** Bass plays it; piano shouldn't double. Voice from the 3rd or 7th up.
- **Drop the 5th.** Almost always optional, almost always omitted in 4-note voicings.
- **Stack 3rds + extensions in the right hand**, root + 5th or 10th in the left.
- **"Rootless" voicings** (Bill Evans style): for Cmaj9, play E–G–B–D. Quintessential lofi piano.
- **"Shell" voicings**: root + 3 + 7 only. Used for sparse intros / outros.
- **Quartal voicings**: stacks of 4ths (e.g. D–G–C–F over Dm11). Open, modern, McCoy Tyner.
- **Cluster voicings**: 2nds + 4ths. Herbie Hancock. Rare but *very* lofi when used.
- **Spread voicings**: wide gap between LH and RH (10ths+), fills the stereo field.

### Idiomatic voicing moves

- **Chromatic approach from a half-step above/below** to the target chord, just for one 16th note
- **Voicing slides**: hold the top voice, move the inner voices chromatically
- **Voice the 9th as the top note** of a min7 → instant Nujabes
- **Voice the maj7 as the top note** of a maj chord → dreamy
- **Avoid the 11 over major 3rd**, use ♯11 instead

**→ knob:**
- `voicing_style` — rootless / shell / quartal / cluster / spread (weighted bag)
- `voicing_register` — LH range, RH range (low = warm/dark, high = sparkly/bright)
- `top_note_rule` — "always 9th" / "always 7th" / "stepwise from previous" / "random in chord tones"
- `chromatic_approach_probability`
- `voicing_change_per_bar` — how often the voicing re-spells without the chord changing

---

## 5. Bass

The bassline is what locks the loop in. Lofi basses are *simple* and live in the
**E1–A2** range.

### Patterns

| Style | Notes per bar (4/4) | Feel |
|---|---|---|
| **Root only** | 1 note, downbeat | Maximally chill / ambient lofi |
| **Root + 5** | 2 notes, beats 1 and 3 | Boom-bap default |
| **Root–5–octave** | 3 notes, broken | Light groove |
| **Walking bass** | quarter notes through chord tones + passing tones | Jazz lofi (rare for study, more for "café") |
| **Brazilian bossa** | dotted-quarter on root then 5th anticipated | Bossa-lofi |
| **Dub-style** | long sustained, slid into | Ambient-dub lofi |
| **Sub-bass drop** on the "&" of 4 | anticipates next bar | Modern lofi-trap |

**Glides / slides** between notes (especially up to the root from a 5th below)
are a strong genre marker.

**→ knob:**
- `bass_density` (notes per bar)
- `bass_pattern_set` (which of the above)
- `bass_glide_probability`
- `bass_octave_jump_probability`
- `walking_bass_enable` (boolean — for cafe-jazz mode)

---

## 6. Drums & Groove

Lofi inherits **boom-bap** (J Dilla, Pete Rock, DJ Premier) almost wholesale:
**slow tempo + heavy swing + "drunk" timing + muffled timbres**.

### Tempo

- **70–90 BPM** is the lofi window. Sweet spot: **72–82**.
- Sub-60 starts to feel like ambient; 95+ becomes hip-hop instrumental.
- Half-time feels common — a "70 BPM" beat may notate as 140 with snares on 3.

### Groove / timing

- **Swing 16ths**, ratio 55–67% (Tone.js `swing: 0.20–0.55`). The "Dilla" feel
  is *uneven* swing — sometimes ahead, sometimes behind. Quantize loosely.
- **Snare slightly late** ("behind the beat", +5 to +20 ms) — most important
  single timing trick.
- **Hi-hats ahead of the beat**, snare behind = the "Dilla bounce."
- **Velocity humanization** — never two hits at the same velocity.

### Drum patterns (16-step grids)

```
Kick:   X . . . . . X . . . X . . . . .    (boom-bap basic)
Snare:  . . . . X . . . . . . . X . . .
Hat:    X . X . X . X . X . X . X . X .

Kick:   X . . . . . X X . . X . . . . .    (Dilla — 6 & 7 are doubled)
Snare:  . . . . X . . . . . . X X . . .    (snare ghost on 12)
Hat:    X X . X X X . X X X . X X X . X    (busy ghost hats)

Kick:   X . . X . . X . . X . . X . . .    (lazy 4-on-floor lofi)
```

### Drum sound design (still lofi even with synth drums)

- **Kick**: muffled 808 or filtered membrane, decay 200–500ms, low-passed at 2 kHz
- **Snare**: dusty, often *just* a noise burst + bandpass at 200–400 Hz; layered with a clap
- **Rimshot / cross-stick** instead of snare for sparser tracks
- **Hi-hat**: short white-noise burst, high-passed, sometimes pitched; pairs of open/closed
- **Shaker / tambourine** as a 16th-note "glue" layer
- **Vinyl-bus**: route drums through a saturator + lowpass at 6–8 kHz + slight bitcrush

**→ knob:**
- `tempo` (70–90 weighted around 76)
- `swing_amount` (0.20–0.55)
- `swing_humanization` (jitter on swing)
- `snare_lateness_ms`
- `kit_pattern_id` (from a small bag, with per-step mutate probability)
- `ghost_hit_density`
- `drum_brightness` (lowpass cutoff)
- `drum_grit` (saturation amount)
- `percussion_layers_enabled` (shaker, tambourine, rim, vinyl-pops)
- `kit_presence` — full kit / kick+hat only / brushed / no drums (ambient)

---

## 7. Melody

The melody in lofi is **the most attention-grabbing element** — so for *study*
lofi we want it sparse, modal, and hookless.

### Pitch material

- Restrict to **pentatonic** of the mode (5 notes) — minor pentatonic for
  Dorian/Aeolian, major pentatonic for Ionian/Mixolydian.
- Allow **chord tones + 9ths** when not on pentatonic.
- **"Blue notes"** (♭3, ♭5, ♭7) sparingly — bluesy color.
- Stay in **one octave** primarily; jump octaves rarely for color.

### Rhythmic feel

- **Sparse**: 1–4 notes per bar. Density slider is your friend.
- **Triplets and dotted-8ths** common — avoid straight 16ths.
- **Long held notes** with a slow attack > running notes.
- **Pickup notes** (anacrusis) into the downbeat = jazz-flavored.
- **Call-and-response gaps** — leave 2+ beats of silence regularly.

### Idiomatic gestures

- **Descending stepwise lines** — instant lofi melody.
- **Repeated single note** at different velocities — meditation.
- **Question phrase ending on the 9th or 6th** (not the root) — leaves it open.
- **Tritone bend** (♭5 wobble) — bluesy single ornament.

### Lead timbres

- **Rhodes / Wurlitzer** electric piano (the king)
- **Muted trumpet** (sampled or filtered synth)
- **Nylon guitar** (especially for bossa-lofi)
- **Vibraphone / glockenspiel** (sparse, bell-like)
- **Soft saxophone** (used very sparingly — too attention-grabbing)
- **Flute / pan flute** (ambient lofi)
- **Detuned lead synth** (modern / 2020s lofi)
- **Music box / celesta** (sleepy / "lullaby lofi")

**→ knob:**
- `melody_density` (notes per bar, 0–4)
- `melody_register` (octave choice)
- `melody_scale_subset` (pentatonic / heptatonic / chord-tone-only)
- `melody_silence_probability` (chance per bar of zero notes)
- `blue_note_probability`
- `melody_timbre` (Rhodes / muted-trumpet / nylon / vibes / flute / music-box)
- `phrase_length_bars`
- `note_duration_distribution` (short/long bias)

---

## 8. Pads / Background harmony

The "blanket" layer — under everything, never quite heard.

- **Sustained string pad** (slow attack, low-passed, mono → wide chorus)
- **Choir aahs** (sampled in real lofi; for us = filtered formant synth)
- **Filtered noise as pad** (works surprisingly well, very ambient)
- **Mellotron-style strings/flute** (vintage)
- **Octave-stacked sine drone** on the tonic — the simplest possible pad

Pads typically play **root + 5** or **root + 5 + 9** — leaving the chord
extensions to the keys.

**→ knob:**
- `pad_type`
- `pad_brightness`
- `pad_density` (chord vs drone vs absent)
- `pad_movement` (static / slowly evolving / chord-following)

---

## 9. Texture / FX — the "lofi-ness"

This is where pure synthesis genuinely has to *earn* the lofi label.
Procedural lofi character comes from this layer, not the notes.

| Effect | What it does | Knob range |
|---|---|---|
| **Tape wow** | Slow pitch drift (~0.5 Hz, ±10 cents) | ±0 to ±30 cents |
| **Tape flutter** | Faster pitch jitter (~6 Hz, ±3 cents) | 0–8 cents |
| **Vinyl crackle** | Random pink-noise pops | sparse → dense |
| **Vinyl hum** | 60 Hz + 120 Hz sine, very quiet | on / off |
| **Tape hiss** | Pink noise, high-passed | level |
| **Bitcrush** | Reduce bit depth | 16 → 8 bit |
| **Sample-rate reduction** | Aliasing artifacts | 44 → 11 kHz |
| **Saturation / soft clip** | Tape warmth | drive amount |
| **Lowpass "warmth"** | Roll off > 8 kHz | cutoff |
| **Slow LFO filter** | Macro evolution (your existing 40s sweep) | rate, depth |
| **Sidechain ducking** | Pump under kick | amount |
| **Chorus / detune** | Width, "wobble" | depth, rate |
| **Spring/plate reverb** | Vintage space | size, decay |
| **Stereo width** | Mono center, wide pads | per-element |
| **Rain / cafe / fireplace bed** | Environmental masking | on/off + level |
| **Tape stop / pitch-down on transitions** | *Avoid for study* — too event-y | — |

**→ knob:** every row is a slider. The seed picks a **profile** (e.g. "cassette
demo", "ipod loss", "clean vinyl", "FM radio") that biases groups of these.

---

## 10. Subgenre flavors — preset "seeds of seeds"

These are recognizable lofi sub-styles. Useful as **archetypes** the seed can
interpolate between.

| Subgenre | Tempo | Mode | Chord palette | Drums | Texture | Lead |
|---|---|---|---|---|---|---|
| **Nujabes / jazzhop** | 82–90 | Dorian, Aeolian | maj9, min11, ii-V-I | Boom-bap, swung 16ths | Light vinyl | Rhodes, muted trumpet |
| **Dusty boom-bap** | 78–86 | Aeolian, blues | min7, dom9, slash | Heavy swing, dirty kit | Heavy vinyl, sat. | Sampled chops |
| **Chillhop** | 80–90 | Ionian, Dorian | maj7, add9 | Tight, lighter swing | Light wow/flutter | Guitar, Rhodes |
| **Bossa-lofi** | 75–85 | Major, Dorian | maj6, min6, sus | Bossa pattern, brushes | Clean | Nylon guitar |
| **Sad lofi / "study"** | 70–78 | Aeolian, Phrygian | min7, min9, sus2 | Sparse, dry | Tape hiss, rain | Piano, music box |
| **Ambient lofi** | ≤70 or no beat | Lydian, Ionian | maj7♯11, sus, add9 | Often no drums | Heavy reverb, drone | Pad, vibes |
| **Lo-fi house / wave** | 88–100 | Aeolian | min7, sus | 4-on-floor, muffled | Tape saturation | Detuned synth |
| **Tape soul / "ghibli"** | 72–84 | Major, Lydian | maj7, maj9, slash | Soft brushes | Wow/flutter heavy | Flute, glockenspiel |
| **Jazzy late-night** | 76–84 | Dorian + chromaticism | Full jazz (alt dom, ø) | Brushed, sparse | Cigarette-smoke reverb | Sax, Rhodes |

**→ knob:** a single high-level `subgenre_bias` selector that pre-weights the
other knobs. Seed can also blend two (e.g., 60% Nujabes + 40% bossa).

---

## 11. Form / Structure

Lofi for study **has no form**. But within the static loop, several macro-scale
movements give "freshness without events":

- **Voicing rotation**: same chords, new spelling every 8 bars
- **Register migration**: keys drift down an octave over a minute
- **Density envelope**: melody fades in/out over 60–120 seconds
- **Filter sweeps**: very slow (your existing 40s LFO), or random-walk
- **Pad swaps**: pad layer changes instrument every few minutes
- **Drum drop-outs**: 8 bars without drums every 2–3 minutes
- **Rain/crackle fade-in/out**: environmental bed comes and goes
- **Key change**: ⚠️ rarely; if used, by a **whole step down** every several
  minutes, very gradual — never with a "moment"
- **Progression swap**: change the underlying 4 chords every 8–16 bars
  (your prototype already does this with `chance(0.45)`)

**→ knob:** each macro-evolution dimension gets its own slow LFO/noise source
(this is where **fBm / 1/f noise** earns its keep — pink-noise drives that
breathe over minute-scale timescales).

---

## 12. The full knob space (summary)

A seed needs to deterministically pick values for, roughly:

**Pitch-side (the safe core):**
1. Key (12)
2. Mode (7 weighted)
3. Chord palette (5–6 archetypes)
4. Progression set (bag of 3–8 progressions in the mode)
5. Progression length (2, 4, 8 bars)
6. Borrowed-chord probability
7. Secondary-dominant probability
8. Voicing style
9. Voicing register (LH, RH)
10. Voicing top-note rule
11. Voicing-change rate
12. Chromatic approach probability

**Rhythm-side:**
13. Tempo
14. Swing amount
15. Swing humanization
16. Snare lateness
17. Kit pattern (bag)
18. Ghost-hit density
19. Per-step mutation probability
20. Percussion layers enabled
21. Kit presence (full / minimal / none)
22. Drum brightness, drum grit

**Bass:**
23. Bass density
24. Bass pattern set
25. Glide probability
26. Octave jumps
27. Walking-bass enable

**Melody:**
28. Melody density
29. Melody register
30. Melody scale subset
31. Silence probability
32. Blue-note probability
33. Phrase length
34. Note-duration distribution
35. Lead timbre

**Pad:**
36. Pad type
37. Pad brightness
38. Pad density
39. Pad movement

**Texture / FX (a vector — every effect has on/level/depth):**
40. Wow, flutter, crackle, hiss, hum, bitcrush, SR-reduction, saturation,
    warmth, chorus, reverb size, stereo width, sidechain, environmental bed

**Macro evolution (pink-noise driven, minute-scale):**
41. Voicing rotation rate
42. Register drift rate
43. Density envelope shape
44. Filter sweep rate/depth
45. Pad-swap rate
46. Drum-dropout probability
47. Progression-swap rate

**Subgenre bias (a single high-level selector that weights everything else):**
48. Primary subgenre + optional secondary blend %

That's ~50 orthogonal knobs. Two seeds with the same key and mode but
different subgenre biases and texture vectors will sound like different
albums.

---

## 13. Open questions for Loam specifically

- **How many "subgenre archetypes" ship in v1?** A small, curated set (4–6)
  is more cohesive than 9; can grow later.
- **Per-seed knob locking vs per-session drift**: do all knobs lock for the
  whole session, or do macro knobs themselves slowly walk?
- **User-facing controls**: which 3–5 of these ~50 knobs become sliders
  (warmth / density / rain are 3 already), vs. all-implicit-in-seed?
- **Seed format**: integer (Minecraft-style) vs. shareable string ("dorian-rain-cassette-7421")?
- **Validation harness**: render N minutes of a seed offline, FFT it, check
  for 1/f shape on macro params — this is a build-time Python job (per
  the spec's "Python authors, TS performs" rule).
