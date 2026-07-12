# Arrangement Controller — instrument-layering research

> Research note for Loam's arrangement controller. How do adaptive /
> generative music systems coordinate instrument layering (stems
> coming in / dropping out) so it reads as *musical breathing* while
> keeping each instrument's **contiguous absence bounded**?

## Fixed background (our context)

Loam is an offline, infinite, seed-based generative lo-fi engine
(TypeScript / Web Audio). We're adding an **arrangement controller**
that mutes/unmutes whole instrument *roles* — bass, chords, melody,
drums; a pad is an always-on floor — at **8-bar phrase boundaries**, so
the track breathes rather than playing everything continuously.

**What already failed — the occupancy Markov walk.** Our first design
was a Markov walk over an 8-state palette of "which instruments are on"
combos, with transitions tilted by a slow 1/f (fBm) energy contour. It
failed structurally: in an *occupancy* model, an instrument's
**absence duration == the walk's dwell in states where that instrument
is off**. Because the 1/f contour has unbounded low-frequency
excursions, the walk parked in low-energy (sparse) states for long
stretches — instruments vanished for 15–67+ minutes (melody gone up to
22 min). We proved this generalizes: **any occupancy model** (plain
Markov, or density→layer-count thresholds a.k.a. "vertical remixing")
inherits it, because absence is *coupled to the driving signal's
excursions*, which are unbounded.

**Current lean — an event/dropout model.** Baseline = everything-on.
Discrete **dropout events** remove one instrument for a *bounded
sampled duration*, then restore it. This bounds absence *by
construction*. The open worry is **musicality**: independent random
dropouts feel less "composed" than a curated palette + coordinated
transitions. Plan to re-add musicality via constraints (only legal
combos from the vetted palette; serialize to ~one change per phrase;
occasional coordinated multi-drops for deep-breather moments; scripted
return gestures). We also need **per-seed identity** (each seed has a
recognizable arrangement personality — which roles it likes to drop,
how often, how deep) and we have a slow 1/f "energy" signal available
to drive intensity.

The single most important thing to resolve: **does semi-Markov
(explicit, bounded sojourn-time distributions) rescue the occupancy /
palette model?** If yes, we keep the curated 8-state palette. Answered
in §5.

---

## 1. Game-audio adaptive music

Two canonical techniques (Wwise/FMOD/Elias vocabulary), both mature and
both *game-state-driven* rather than autonomous.

### 1a. Vertical layering / vertical remixing
**What it is.** One synchronized multi-track bed; layers (stems) are
faded in/out to change texture and intensity *without interrupting the
flow* ([The Game Audio Co.][gaudio], [Adaptive music — Wikipedia][wiki-adaptive]).
In Wwise this is the **Music Segment with multiple tracks** whose track
volumes are driven by an RTPC (real-time parameter, e.g. "combat
intensity") ([Audiokinetic Wwise201, vertical structure][wwise-vert]).

- **On/off decision:** an external control parameter (intensity RTPC)
  crosses a threshold → a layer's gain automates up/down. This is
  exactly the "density→layer threshold" family we already showed is
  unbounded.
- **Absence bounding:** *none intrinsic.* If the game sits in "low
  intensity" for 20 minutes, the combat layer is silent for 20 minutes.
  Bounding comes only from *gameplay pacing* (levels don't stay calm
  forever) — a designer-controlled external guarantee we don't have in
  an infinite autonomous stream.
- **Musical transition:** layers *crossfade* rather than hard-cut, so
  entries/exits are smooth; changes are still typically quantized to a
  beat/bar so a layer doesn't swell mid-phrase.
- **Per-seed variety:** would come from per-seed RTPC mapping / layer
  thresholds. But variety here is genuinely a function of the driving
  signal, inheriting its excursion statistics.

### 1b. Horizontal re-sequencing / phrase branching
**What it is.** Distinct pre-authored *segments* are sequenced and
branched between; the switch to the next segment is deferred until the
current musical phrase ends ([Wikipedia][wiki-adaptive], [Wwise201
re-sequencing][wwise-reseq]). Wwise's **Music Switch Container** picks
the next segment from a state; **transition rules** define *exit
points* (Exit Cue / next Bar / next Beat / next Grid) and can splice a
**transition segment** (a musical bridge/fill) between source and
destination.

- **Quantized boundaries:** this is the key craft lesson. Wwise
  transition rules and **FMOD transition regions / quantization** let
  you say "only switch on the next bar / beat / 8th," and FMOD's
  **transition timelines** insert bridge content, automation, or
  crossfades to *cover the seam* so nothing "just disappears"
  ([FMOD transition timelines & quantisation][fmod]). Smaller
  quantization = more agile, larger = safer/musical.
- **Absence bounding:** again *none intrinsic* — it's a reachability
  question over the branch graph driven by game state. A segment (and
  the instruments unique to it) can be absent arbitrarily long.
- **Per-seed variety:** analogous to per-seed transition graphs.

**Elias / hybrid.** Middleware (Elias, and hybrid Wwise setups) combine
both: vertical mix sets a region's identity instantly while a melodic
phrase is allowed to *play out* before a horizontal transition
([whiterose thesis ch.3][whiterose]). Same absence story.

**Takeaway from game audio:** the *transition craft* (quantize to
phrase/bar boundaries, crossfade not hard-cut, insert a bridge/fill to
cover the seam, let phrases finish) is directly reusable and is exactly
the "musicality layer" we want on top of the dropout model. But game
audio **does not solve bounded absence** — it externalizes that to
level/encounter pacing. An infinite autonomous engine cannot borrow
that guarantee; it must bound absence *internally*.

---

## 2. Generative / systems music (Eno lineage)

**Koan → Noatikl → Wotja** (Intermorphic; the software Eno used to coin
"generative music" in 1995–96) ([Intermorphic/Koan][koan],
[Generative music — Wikipedia][wiki-gen]). These are *per-voice
stochastic rule engines*: each of up to 16 "voices" has 100+ parameters
governing when and what it plays.

- **On/off decision — per-voice, not global-combo.** The relevant
  control isn't a global occupancy state; it's *per-voice* activity
  parameters. Voices have their own note-density, rest, and
  "next-note" rules; a voice weaves in and out on its own timescale.
  This is architecturally an **independent-per-role dropout model**,
  not an occupancy walk — much closer to our event lean than to our
  failed design.
- **Absence bounding:** governed by per-voice density/rest parameters
  (a voice that rests too rarely-active is a parameter choice, not an
  emergent excursion of a shared driving signal). Bounding is *soft*
  (statistical, via rest probability / density) rather than a hard cap,
  but because each voice is independent it never gets *dragged* silent
  by a global low-energy excursion the way our Markov walk did.
- **Variety without repetition:** achieved by (a) stochastic rules
  seeded differently, (b) many independent voices whose phase
  relationships never exactly recur, (c) rule "scripts". This is the
  core Eno idea — *ever-different* from a fixed system.
- **Per-seed identity:** maps naturally — a seed = a parameter vector
  per role (density, rest tendency, register, activity), which is
  literally the "personality" surface we want.

**Bloom / Mixel / Endless (Eno-adjacent apps):** small numbers of
generative layers with user-set density; same per-layer-independent
philosophy.

**Takeaway:** the systems-music tradition *does not* use a global
occupancy palette. It uses **independent per-voice stochastic
scheduling with density/rest parameters** — which is our event/dropout
model with per-seed parameterization. That's strong prior-art
validation for the event lean. What it lacks is *coordination* (§4):
Koan voices don't do call-and-response or "not everyone drops at once"
by default — that arrangement-level intent is what we must add.

---

## 3. Event / stochastic-process models

This is the math that decides whether absence is bounded.

### 3a. Renewal / alternating-renewal process
**What it is.** A per-role two-state on/off process where successive
on-durations and off-durations are drawn i.i.d. from chosen
distributions ([renewal / alternating-renewal, EPFL Neuronal
Dynamics §7.5][epfl]; [renewal theory][grok]). A Poisson process is
the special case with exponential inter-event times.

- **Bounds absence?** **Yes, by choice of the off-duration
  distribution.** If off-durations are drawn from a distribution with
  *bounded support* (e.g. uniform[2,6] phrases, or shifted-Poisson
  truncated at a max), absence is hard-capped. This is precisely our
  event/dropout model: a dropout event = one "off" sojourn with a
  bounded sampled length. Per-role independent alternating-renewal is
  the cleanest formalization of our lean.
- **Poisson/Cox dropout:** dropouts arrive as a (possibly
  intensity-modulated = **Cox**) point process; the 1/f energy signal
  can modulate the *rate* λ(t) (fewer drops when energy high) **without
  touching the duration cap.** This is the key decoupling: intensity
  drives *how often / how deep* we breathe; a separate bounded duration
  law drives *how long* — so the unbounded 1/f excursions can influence
  frequency/depth but can **never** stretch an individual absence.

### 3b. Hysteresis / min-dwell
**What it is.** Enforce a minimum time in a state before leaving, and/or
asymmetric enter/exit thresholds, to prevent chatter (a layer flapping
on/off every phrase). Standard control-systems trick; directly
applicable as "a role that just returned may not drop again for N
phrases," and "a role may not stay off past M phrases" (the cap).

### 3c. Semi-Markov / HSMM — the important one
**What it is.** A Markov chain over states where the **sojourn time in
each state is drawn from an explicit, arbitrary distribution** rather
than being implicitly geometric (as in plain Markov)
([HSMM inhomogeneous dwell-time, arXiv 2405.13553][hsmm],
[LaMa HSMM tutorial][lama], [sojourn-time analysis, arXiv 2206.10865][sojourn]).
Dwell-time can be a shifted Poisson, negative binomial, or an
**unstructured distribution on a bounded range with a geometric tail** —
i.e. you can give it *bounded support*.

- **Bounds absence?** **Per-state sojourn: yes.** Unlike plain Markov
  (geometric dwell → unbounded tail → our failure), semi-Markov lets
  you cap the dwell in any single state. **But — the catch for an
  occupancy palette (see §5): bounding per-*state* dwell does not bound
  per-*instrument* absence**, because an instrument can be off across a
  *run of consecutive states that all happen to exclude it.* You'd have
  to bound the sojourn of the *union* of all off-for-role states, which
  is not a single semi-Markov state.

---

## 4. Musical coordination (making it read as *arranged*)

Techniques, drawn from the above traditions, that turn independent
on/off into something that feels composed. These are *orthogonal* to
the bounding mechanism — bolt them onto whichever engine we pick.

- **Quantize to phrase boundaries** (Wwise transition rules / FMOD
  quantisation): all changes land on 8-bar cues; never mid-phrase.
- **Crossfade + bridge/fill, not hard-cut** (FMOD transition
  timelines): cover the seam so nothing "just vanishes"; a re-entry can
  be prefaced by a fill or a pickup gesture.
- **Serialize changes** — at most ~one role change per boundary, so the
  ear tracks a single arrangement move (a curated-palette virtue we can
  keep as a constraint without keeping the occupancy *model*).
- **Legal-combo constraint** — only permit on/off configurations drawn
  from our vetted 8-state palette (avoid, e.g., "bass gone AND chords
  gone AND pad is the only harmony" if that's ugly). This preserves the
  palette's *taste* as a **filter on the event model**, not as the
  driving process.
- **Not-everyone-drops-at-once / anti-correlation** — enforce a floor
  (pad always on) plus a rule that deep multi-drops are rare and
  scheduled, giving occasional "deep breather" moments against a mostly-
  full texture. Call-and-response = deliberately *anti*-correlate two
  roles (melody rests → a counter-line answers) rather than dropping
  both.
- **Tension/release arcs** — let the 1/f energy signal modulate dropout
  *rate and depth* (sparse & frequent breaths in low-energy passages,
  fuller texture in high-energy), giving long-form contour *without*
  giving it control over absence length ([tension/release in
  generative arrangement, review surveys][arxiv-review]).
- **Re-entry gestures** — scripted return (pickup note, fill, filter
  sweep) so an instrument *arrives* rather than just reappears.

---

## 5. Head-to-head: semi-Markov occupancy vs event/dropout

**The decisive question: can semi-Markov save the curated occupancy
palette?**

**Partly — but it does *not* cleanly bound per-instrument absence, and
that's our hard requirement.** The reason our Markov walk failed was
geometric dwell tails *plus* a subtler issue: **absence spans multiple
states.** Semi-Markov fixes the first (cap each state's dwell) but not
the second. Melody can be off in states {S3, S5, S6}; a walk
S3→S6→S5→S6 keeps melody off across four capped sojourns whose *sum* is
unbounded even though each is bounded. To truly bound melody's absence
in an occupancy model you must constrain the *aggregate* time in the
"melody-off" subset — which is a per-instrument renewal constraint
bolted *on top of* the state machine, i.e. you end up re-implementing
the event model anyway, plus the state machine.

Formally: **an occupancy model bounds absence per-instrument only if,
for every instrument, the sub-chain of states excluding it has bounded
total sojourn** — equivalent to forcing a return-to-a-state-containing-
that-instrument within a deadline. Enforcing that for *all four*
instruments simultaneously over an 8-state palette is a coupled
constraint satisfaction problem at every step; it's strictly harder
than, and reducible to, running four independent bounded on/off renewal
processes (one per role) and *projecting* onto the legal palette.

**Conclusion on semi-Markov:** it is a real improvement over plain
Markov (bounded per-state dwell, explicit shapeable durations, natural
per-seed identity via per-state dwell distributions), and if we wanted
to keep a *state* abstraction it's the right tool. **But it does not,
by itself, give the per-instrument absence guarantee we need**; getting
that back requires per-role deadline constraints that are exactly the
event/dropout model. So semi-Markov doesn't *rescue* the occupancy
model so much as it *converges toward* the event model once you add the
constraint we actually care about.

| | Occupancy (plain Markov) | Occupancy (semi-Markov) | **Event / dropout (per-role renewal)** |
|---|---|---|---|
| Bounds per-instrument absence | No (geometric tails) | **No** (absence spans multiple capped states) | **Yes, by construction** (bounded off-sojourn) |
| Keeps curated palette | Yes (as states) | Yes (as states) | Yes — **as a legal-combo *filter*** |
| Per-seed identity | Transition matrix | Per-state dwell dists (rich) | Per-role rate + depth + duration params (rich, interpretable) |
| 1/f energy coupling | Drives transitions → **drags absence** | Same risk | Drives **rate/depth only**; absence stays capped |
| Coordination (§4) | Implicit in palette | Implicit in palette | **Must be added explicitly** (its main cost) |
| Implementation | Simple but broken | Complex + still needs per-role caps | Simple; caps free; coordination is the work |

---

## Recommendation

**Adopt the event/dropout model, formalized as per-role
alternating-renewal processes with a Cox (1/f-modulated) drop rate, and
recover the curated palette as a *legal-combo constraint* plus explicit
§4 coordination.** Concretely:

1. **Baseline everything-on**, pad = permanent floor. Each of {bass,
   chords, melody, drums} runs an independent on/off renewal process
   evaluated at 8-bar boundaries.
2. **Off-duration drawn from a bounded distribution** per role (e.g.
   shifted, truncated — 1 to K phrases), K per-role and per-seed. This
   is the hard absence cap; it's free in this model.
3. **Drop rate λ_role(t) modulated by the 1/f energy signal** (Cox
   process): low energy → more/deeper breaths, high energy → fuller.
   Energy touches *frequency and depth only, never duration.*
4. **Legal-combo filter:** propose a change, and if the resulting
   on/off set isn't in the vetted 8-state palette, veto/resample. Keeps
   the palette's taste without inheriting occupancy's absence coupling.
5. **Serialization + hysteresis:** ≤1 change per boundary; min-dwell
   after re-entry (no immediate re-drop); a scheduled rare
   coordinated multi-drop for "deep breather" moments.
6. **Transition craft (from game audio):** quantize to the 8-bar cue,
   crossfade with a short fill/pickup on re-entry so instruments
   *arrive* rather than blink in.
7. **Per-seed identity vector:** per role → {drop rate, max depth/
   duration K, hysteresis N, favored-to-drop weight}. This is the
   "personality" surface and is directly legible.

**Why not semi-Markov:** it's the best *occupancy* option and worth
citing, but it fails our hard requirement (per-instrument absence spans
multiple capped states) and only regains it by adding per-role
deadlines that *are* the event model. Don't pay for the state machine
to then bolt the event model on top. Keep the palette as a *constraint*,
not as the generative process.

---

## Sources

- [The Game Audio Co. — Vertical Layering vs. Horizontal Resequencing][gaudio]
- [Adaptive music — Wikipedia][wiki-adaptive]
- [Audiokinetic Wwise201 — Building a Layered (Vertical) Structure][wwise-vert]
- [Audiokinetic Wwise201 — Re-sequencing / horizontal variation][wwise-reseq]
- [FMOD Studio — transition timelines, regions & quantisation (via game-sound writeups)][fmod]
- [White Rose thesis, ch.3 — hybrid vertical/horizontal adaptive music][whiterose]
- [Intermorphic — SSEYO Koan / Noatikl / Wotja (Eno generative lineage)][koan]
- [Generative music — Wikipedia][wiki-gen]
- [EPFL Neuronal Dynamics §7.5 — renewal statistics / alternating renewal][epfl]
- [Renewal theory overview][grok]
- [Hidden semi-Markov models with inhomogeneous dwell-time distributions — arXiv 2405.13553][hsmm]
- [LaMa — Hidden semi-Markov models tutorial (bounded dwell + geometric tail)][lama]
- [Analysis of sojourn time distributions for semi-Markov models — arXiv 2206.10865][sojourn]
- [A Review of Intelligent Music Generation Systems — arXiv 2211.09124][arxiv-review]

[gaudio]: https://www.thegameaudioco.com/making-your-game-s-music-more-dynamic-vertical-layering-vs-horizontal-resequencing
[wiki-adaptive]: https://en.wikipedia.org/wiki/Adaptive_music
[wwise-vert]: https://www.audiokinetic.com/en/courses/wwise201/?id=building_vertical_structure/
[wwise-reseq]: https://www.audiokinetic.com/en/courses/wwise201/?id=lesson_1_re_sequencing_creating_variation_using_horizontal_approach/
[fmod]: https://limulo.github.io/game-sound-sae2017/fmod.html
[whiterose]: https://etheses.whiterose.ac.uk/id/eprint/27365/1/Chapters/Chapter%203/Chapter%203.html
[koan]: https://intermorphic.com/sseyo/koan/
[wiki-gen]: https://en.wikipedia.org/wiki/Generative_music
[epfl]: https://neuronaldynamics.epfl.ch/online/Ch7.S5.html
[grok]: https://grokipedia.com/page/Renewal_theory
[hsmm]: https://arxiv.org/html/2405.13553v1
[lama]: https://janoleko.github.io/LaMa/articles/HSMMs.html
[sojourn]: https://arxiv.org/abs/2206.10865
[arxiv-review]: https://arxiv.org/pdf/2211.09124
