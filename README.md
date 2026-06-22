# Loam

> An offline, infinite, on-device generative music engine. Pure synthesis,
> no samples, no streaming. "Infinite music in the footprint of a single
> MP3."

Loam grows endlessly from a seed — a Minecraft-style procedural generator
for sound. It's tuned for **studying and sustained focus**: predictable,
unobtrusive, slow-evolving, deliberately hookless. The default genre is
lo-fi; the architecture is genre-agnostic.

## Status

- **`packages/core`** — `@loam/core`, the framework-agnostic engine.
  Seeded PRNG, fBm dynamics, Markov chord progressions with greedy
  voice-leading, germ-driven melody, bass with stickiness, drum
  scheduler with humanization, vinyl crackle. No audio-library
  dependency.
- **`packages/synth-tone`** — Tone.js synthesis adapter. The only layer
  bound to Web Audio.
- **`apps/web-demo`** — the hosted demo. Bundles the lofi audio chain
  on top of the core engine.
- **`ember-generative-study.html`** — the original single-file Tone.js
  prototype, kept as a reference specimen.
- **`docs/`** — design docs and audit trail.

## Try the prototype

Open `ember-generative-study.html` in any modern browser. Tap the ember.
Two toggles (rain, vinyl), three sliders (volume, warmth, speed). That's
the whole interface.

## Design philosophy

The principles that shape every decision:

- **Use case is sustained focus.** This inverts normal music goals.
  Predictability is a feature.
- **Cardinal rule: never *grab* attention.** No drops, no fills, no
  melodic hooks, no structural "moments." Default state is habituation
  — the brain should tune the music out. Bar to clear is "unobtrusive
  and warm," not "impressive."
- **Subtle ornaments allowed, sparingly** — a momentarily-held 9th, a
  single bell tone, a one-bar modal-mixture color. Small enough not to
  surface in deep focus, rare enough never to form a hook. See
  [`docs/ornaments.md`](docs/ornaments.md).
- **Evolve slowly and event-lessly.** Slow continuous movement is the
  default; discrete ornaments are the rare exception.
- **Part of the job is masking** irregular environmental noise (chatter,
  HVAC, traffic). It's an acoustic blanket, not a composition.
- **Pure synthesis.** Lo-fi character is produced procedurally
  (saturation, filtering, noise beds, wow/flutter), not sampled. Keeps
  the "kilobytes-not-gigabytes" identity honest.
- **Dynamics propose, music theory disposes.** Chaotic / noise sources
  drive *parameters* (filter cutoff, density, voicing); pitch is always
  quantized onto a locked scale. No wrong notes by construction.
- **Seed-determinism is a feature.** Same seed → same soundscape. The
  seed IS the song's identity (BPM, melody character, chord vocabulary,
  swing feel); user-facing knobs are limited to playback-level controls
  (volume, warmth, speed multiplier).

## v1 scope

In scope:
- The framework-agnostic core engine (`@loam/core`).
- A hosted web demo evolved from the prototype.
- An Obsidian plugin (`@loam/obsidian`) — the validation beachhead.
- Lo-fi only. Synthwave and ambient are deliberately later, not v1.

Out of scope (v1):
- Not a general music app, not a DAW, not multi-genre, not a
  player/streamer.
- No sample libraries, no ML, no cloud, no accounts.

## Generation architecture

Deterministic, seed-based procedural generation (Minecraft-style: a seed
→ an infinite, reproducible, shareable soundscape; tiny storage; vast
combinatorial variety).

- **Primary primitives:** a seeded PRNG + coherent noise (Perlin /
  simplex, and fBm = layered noise octaves) — the Minecraft worldgen
  toolkit. Smooth, seedable, controllable, multi-scale.
- **Engine core/adapter split.** `@loam/core` is pure logic, no audio
  dependency — it emits abstract events (`note`, `param`, `tick`). The
  thin Tone.js adapter is the only layer bound to Web Audio. The split
  means the core is testable in Node, portable if the audio library is
  ever swapped, and reusable for offline analysis.
- **Target statistic:** parameter streams shaped toward a **1/f (pink)
  spectrum**. Voss & Clarke (1970s) showed 1/f sequences read as more
  "musical" than white (too random) or brown (too dull); fBm naturally
  approximates 1/f.
- **Anti-boredom = dimensionality.** With ML deliberately deferred,
  freshness over hours-long sessions comes from a wide, orthogonal
  modulation space — many per-seed parameters, each with their own
  fBm drift. See [`docs/seed-identity.md`](docs/seed-identity.md).

## Documentation

| Doc | What's in it |
|---|---|
| [`stage-list.md`](stage-list.md) | Active development checklist + history of shipped work |
| [`CLAUDE.md`](CLAUDE.md) | Auto-loaded context for Claude Code sessions |
| [`docs/seed-identity.md`](docs/seed-identity.md) | Five-layer hybrid stack for per-seed identity |
| [`docs/seed-format.md`](docs/seed-format.md) | Seed format, PRNG, determinism contract, locked-sequence history |
| [`docs/melody.md`](docs/melody.md) | Melody design (F1/F2/F3): coupling, germ, transformations, swing |
| [`docs/harmony.md`](docs/harmony.md) | Chord vocabulary, Markov walk, voice-leading |
| [`docs/dynamics.md`](docs/dynamics.md) | fBm + ParamStream foundation; per-seed liveliness |
| [`docs/event-protocol.md`](docs/event-protocol.md) | Typed event interface across the core/adapter split |
| [`docs/adapter.md`](docs/adapter.md) | Tone.js audio chain |
| [`docs/lofi-study.md`](docs/lofi-study.md) | Music-theory survey — modes, chords, drums, subgenres |
| [`docs/ornaments.md`](docs/ornaments.md) | Point-process model for subtle salient events |
| [`docs/stack.md`](docs/stack.md) | Tech stack, monorepo layout, dev setup |
| [`docs/gaps.md`](docs/gaps.md) | Running punch list of open questions |
| [`docs/external-review.md`](docs/external-review.md) | External musical-critique notes |

## License

MIT. The whole engine is and will remain permissively licensed.
