# Loam — Project Context

> Handoff context for Claude Code. Drop this at the repo root as `CLAUDE.md`
> (or under `context/`). Loaded automatically each session — no need to
> re-explain the project.

**Name:** Loam — a substrate that grows endlessly from a seed (a near-literal
description of the architecture: seed-based procedural generation). Brand is
clear in audio; the only namespace clash is an unrelated geospatial npm package.
- **npm:** publish scoped — `@loam/core` (engine), `@loam/obsidian` (plugin).
  Unscoped fallbacks verified free: `loam-audio`, `loam-engine`.
- **GitHub / Obsidian plugin id:** `loam` (independent namespaces, no clash).

## What this is

**Loam** is an **offline, infinite, on-device generative music engine** that
produces **purely synthesized** lo-fi audio for studying and focus (synthwave
and ambient are post-v1). No streaming, no account, no track selection, no samples. Ships as
kilobytes of code (synth presets + a seed-based algorithm) rather than gigabytes
of pre-rendered audio — "infinite music in the footprint of a single MP3."

## Core design principles (settled — do not relitigate)

- **Use case: studying / sustained focus, infinite playback.** This inverts
  normal music goals.
- **Cardinal rule: never *grab* attention.** Predictability is a *feature*.
  No drops, no fills, no melodic hooks, no structural "moments" that pull
  focus. Default state is habituation — the brain should tune it out.
- **Subtle ornaments are allowed**, sparingly, to keep the music from tipping
  past *unobtrusive* into *soporific*. A momentarily-held 9th, a single bell
  tone, a one-bar modal-mixture color — gestures small enough not to surface
  in deep focus and rare enough never to form a hook. Rate, refractory
  period, and inter-arrival distribution are seed-controlled; see
  `docs/ornaments.md` for the mechanics.
- **Evolve slowly and event-lessly.** Slow continuous movement is the default;
  discrete ornaments are the rare exception, not the rhythm.
- **Part of the job is masking** irregular environmental noise (chatter,
  engine drone). It's an acoustic blanket, not a composition. Bar to clear is
  "unobtrusive and warm," not "impressive."
- **The wedge vs. everything else: truly offline + infinite + zero-selection.**
  Existing ambient/lofi apps and plugins are *players/streamers* (often
  YouTube-backed) — a generator that synthesizes on-device is the unfilled gap.

## Music-theory constraints (foolproof by construction)

- Lock all pitch material to one key (prototype: **C major**) with the melody
  drawn from **A-minor pentatonic** → no "wrong" note is reachable.
- **Jazzy extended chords** (maj7 / min7 / 9ths) cycling diatonic
  progressions; these stay smooth in any order.
- Tempo **~70–80 BPM**; **behind-the-beat swing** (~0.34 on 16ths) for the
  lo-fi lope.
- Evolution comes from **slow low-pass filter drift** + occasional chord
  re-voicing — never from song structure.

## Prototype that already exists

Single self-contained HTML file using **Tone.js v14.8.49** (CDN). Filename:
`ember-generative-study.html`.

- **Signal chain:** FM "Rhodes" keys + soft AM pad → chorus → slow-LFO
  low-pass (the only thing that "moves," ~40s cycle) → reverb → master
  "warmth" low-pass → out. Drums (membrane kick, noise snare/hat) muffled and
  mostly dry. Always-on brown-noise bed; toggleable rain (bandpassed noise)
  and vinyl crackle (random short noise bursts).
- **Sequencing:** boom-bap pattern (kick/snare/swung hats); chord change every
  2 bars with light random voicing; sparse *probabilistic* pentatonic melody
  (density-controlled), kept too sparse to form a hook.
- **UI philosophy:** minimal, calm, itself non-attention-grabbing — a single
  breathing "ember" as the play affordance; warm dark palette.

### Known gaps / next technical steps

1. **Bundle Tone.js locally** (it's CDN-loaded now) for true offline.
2. **Upgrade the keys timbre — staying within pure synthesis.** Explore
   wavetable Rhodes, additive partials with realistic decay, or simple
   physical-modeling (Karplus-Strong family) for warmer keys. The v1 spec
   forbids samples; the texture upgrade has to come from better synthesis,
   not from baked audio. This is the hardest part of doing lofi sample-free,
   and the reason synthwave is reserved for later.
3. **Add tape wow/flutter** (slow random pitch drift on keys) for worn-cassette
   warmth.
4. Calibrate study-optimal defaults against a *real* focus session — likely
   more minimal than feels satisfying in a short demo.

## Distribution / monetization landscape (researched)

- **Incumbents:** Endel (funded, on-device generative, patents, major-label
  deal), Brain.fm (neuroscience-backed, patents, offline mode, has a lofi
  genre). **Generative.fm** (Alex Bainter) is the closest precedent — browser,
  Tone.js, free, open-source — but it's *ambient*, not lofi, and not pitched at
  offline/storage. Lofi Girl proves the demand (but is streamed/online).
- **Surfaces considered:** streaming catalog (royalties; slow/passive),
  creator + game-audio tool (highest willingness-to-pay; sell *adaptivity*,
  not loops), Unity open-core asset, **Obsidian plugin** (best audience +
  distribution fit; but donation-ware culture = lowest direct income).
- **Obsidian specifically:** existing music plugins (e.g. Soundscapes) are
  YouTube/MP3 *players*, not generative → genuine gap, and the best low-friction
  beachhead to ship and validate.

## v1 spec (LOCKED — these are decided, do not relitigate)

- **Synthesis: pure synthesis, no samples.** Lo-fi character (warmth, dirt) is
  produced *procedurally* — saturation, bitcrush, filtering, noise beds,
  wow/flutter — not sampled. Keeps the "kilobytes, truly generative" identity
  honest. (Note: lofi is the *hardest* genre to do sample-free; synthwave later
  will be much easier since it's natively synth.)
- **Surfaces in scope:** (1) the framework-agnostic core engine (`@loam/core`),
  (2) an Obsidian plugin (`@loam/obsidian`), (3) the existing prototype kept as a
  free hosted web demo (try before install — serves the "real users" goal at zero
  cost).
- **Genre in scope: lo-fi only.** Synthwave and ambient are *later*, not v1.
- **Success metric:** personal enjoyment (true-north) + real users (bonus).
  Explicitly **not** optimizing for an "impressive artifact." Enjoyment wins when
  it conflicts with users — but still ship a *light* writeup, since that's the
  discovery channel real users arrive through.
- **No ML in v1.** (Kept as a distant, optional growth axis only — may never be
  wanted.)

### Non-goals (v1)

- Not a general music app, not a DAW, not multi-genre, not a player/streamer.
- No sample libraries, no ML, no cloud, no accounts.

## Generation architecture (the core bet — get this right)

Deterministic, **seed-based procedural generation** (Minecraft-style: a seed →
an infinite, reproducible, shareable soundscape; tiny storage; combinatorial
variety).

- **Primary primitives:** a **seeded PRNG** + **coherent noise (Perlin/simplex,
  and fBm = layered noise octaves)** — literally the Minecraft worldgen toolkit:
  smooth, seedable, controllable, multi-scale. Treat true **chaotic attractors**
  (Lorenz/Rössler/logistic) as an *exotic flavor* for specific evolving
  parameters, not the backbone.
- **THE architectural rule — dynamics propose, music-theory disposes:** map the
  noise/attractor streams to **continuous parameters** (filter cutoff,
  modulation depth, density, trigger probabilities, voicing selection, macro
  evolution) — **never directly to pitch.** Raw chaos → pitch = aimless
  noodling (structure without *musical* structure). Anywhere dynamics touch
  notes, **quantize onto the locked scale/grid** so chaos picks among *legal*
  notes only.
- **Target statistic:** shape parameter streams toward a **1/f (pink) spectrum**
  — Voss & Clarke (1970s) showed 1/f sequences read as more "musical" than white
  (too random) or brown (too dull); fBm naturally approximates 1/f.
- **Anti-boredom = dimensionality.** With ML dropped, freshness over a 2-hour
  session comes from a **wide, orthogonal modulation space** (voicing density,
  register, filter, swing feel, chord-change rate, melodic sparsity, reverb
  size, detune/wow, percussion presence, fill probability, …). Over-invest here;
  three knobs under perfect chaos still go samey.

## Tech stack & engine boundaries (LOCKED)

**Runtime: TypeScript on Web Audio, client-side. No Python at runtime.**
The engine (seed-based generator, noise/attractor math, scheduling, synthesis)
runs in the browser / Electron context, because both v1 surfaces are
Chromium/Web Audio environments with no Python runtime: the Obsidian plugin
loads as JS/TS into the renderer, and the web demo is a plain browser page.

- **Why it can't be Python:** generation decisions (next note, next parameter
  value) are scheduled against the Web Audio clock with lookahead timing, so
  that logic must live in the same JS context as the audio clock. Computing
  notes in a separate process and handing them over via IPC can't hold the
  groove.

**Engine is split into two layers — keep them decoupled:**

- **`@loam/core` — pure generative logic, framework-agnostic TypeScript, NO
  Tone.js dependency.** Seeded PRNG, coherent-noise / attractor functions, the
  scale/chord rule system, sequencing decisions. Emits *abstract events*
  ("trigger note X", "set filter to Y") — knows nothing about audio output.
- **Thin synthesis/output adapter — the only layer bound to Tone.js / Web
  Audio.** Consumes the abstract events and actually makes sound.

> "Framework-agnostic" here means *decoupled from the audio library*, still
> written in TypeScript — not written in Python. What's abstracted away is
> Tone.js, not JavaScript.

Payoff of the split: the core is testable in plain Node, portable if the audio
library is ever swapped, and reusable in an offline analysis harness (run the
same logic, render to a file, inspect the spectrum).

**Python: build-time only, never shipped.** Lives in `tools/` (or a separate
repo) and produces *data artifacts* the TS engine consumes — never in the room
when audio plays. Good uses: prototyping/visualizing the noise & attractor
generators, verifying parameter streams hit a 1/f spectrum (numpy/scipy), MIDI-
corpus processing (`music21`/`mido`), and — if the learned-transition idea is
ever revisited — training a model and exporting a plain JSON probability table.
**Python authors the rules; TypeScript performs them.**

## Growth space (preserve via core-first architecture; BUILD NONE NOW)

The engine emits clean parameter streams; every surface is a thin adapter. That
keeps all of these as later weekends, not rewrites:

- **Surfaces:** web demo → Obsidian → VS Code extension (devs = the GitHub-star
  audience; same engine) → Godot asset → standalone PWA → mobile.
- **Thematic-to-note:** derive the **seed from a note's title/content/tags** →
  every note gets its own deterministic soundscape. Novel, demo-friendly,
  plugs directly into seed-based gen.
- **Genre depth:** lofi → synthwave (easy in pure synth) → ambient → other
  functional modes. Same engine, different constraint sets.
- **Audio-visual:** drive visuals from the *same* noise/attractor trajectories
  already computing the sound — nearly free, closes the loop to the original
  fractal vision.
- **ML (distant maybe):** learned chord-transition / voicing models. Deprioritized
  — the math *is* the point for this project.

## Strategic direction — OPEN SOURCE (decided)

Committed to the **open-source / portfolio / credibility** path. The whole
engine is public and permissively licensed. Rationale: aligns with a
research-scientist / PhD trajectory, builds reputation and a citable portfolio
artifact, and lets the web / Obsidian / Godot ecosystems build on it freely.
The acquisition path is **deliberately closed off** — an accepted, intentional
trade, not an oversight.

- **License: MIT** (default — simplest, maximal adoption). Choose **Apache-2.0**
  instead only if an explicit patent grant is wanted. Never GPL / copyleft for
  anything plugin- or game-engine-facing.
- **Income is explicitly secondary and modeled as a trickle** (GitHub Sponsors /
  Ko-fi / Buy-Me-a-Coffee). Do **not** architect around donations as a revenue
  pillar. The real return is reach, credibility, and career signal.
- **Optional later:** a freemium "pro" tier (extra genres/instruments,
  session-adaptive features) layered *on top of* a fully-open core — never by
  closing the core.
- **Highest-leverage deliverable is the writeup**, not just the code: a clear
  "how on-device generative lofi works" devlog / architecture post. It compounds,
  builds an audience, and doubles as the portfolio piece.

## Immediate next steps (open-source-first)

1. **Public repo with an MIT `LICENSE` and a clear README** from day one.
2. **Promote the prototype into a real, modular codebase** — this is now *the*
   deliverable, not just a means to a product.
3. **Host the prototype as a live demo on GitHub Pages** — it's a single
   offline-capable HTML file, so the demo is free, instant, and shareable.
4. **Ship an Obsidian plugin** (JS/Electron, Tone.js ports directly) to the
   community store as the validation beachhead and first real users.
5. **Write the architecture devlog** — the career-signal multiplier.
6. Bundle Tone.js locally, then pursue the texture upgrades (sampled
   instruments, tape wow/flutter) from the technical-gaps list above.