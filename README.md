# Loam

> An offline, infinite, on-device generative music engine. Pure synthesis,
> no samples, no streaming. "Infinite music in the footprint of a single
> MP3."

Loam grows endlessly from a seed — a Minecraft-style procedural generator
for sound. It's tuned for **studying and sustained focus**: predictable,
unobtrusive, slow-evolving, deliberately hookless. The default genre is
lo-fi; the architecture is genre-agnostic.

## Status

Early. The repo currently holds:

- `ember-generative-study.html` — a single-file Tone.js prototype that
  demonstrates the sound and feel.
- `docs/` — design docs (architecture, music theory survey, dynamics
  brainstorm, ornament model, gap tracker).
- `core/`, `utils/` — empty; the modular TypeScript engine hasn't started.

## Try the prototype

Open `ember-generative-study.html` in any modern browser. Tap the ember.
Leave it running. Three sliders (volume, warmth, density) and two toggles
(rain, vinyl). That's the whole interface.

## What's planned

- **`@loam/core`** — framework-agnostic TypeScript engine. Seeded PRNG,
  coherent noise, attractor-driven macro state, Markov harmony, voice-
  leading solver. No audio-library dependency.
- **Tone.js synthesis adapter** — the only layer bound to Web Audio.
- **Hosted web demo** — the prototype evolved into a public GitHub Pages
  page.
- **Obsidian plugin** (`@loam/obsidian`) — the validation beachhead.
- **Architecture devlog** — the writeup that explains how on-device
  generative lofi actually works.

## Design philosophy

A few principles that shape every decision (full version in
[`docs/handoff.md`](docs/handoff.md)):

- **Use case is sustained focus** — this inverts normal music goals.
- **Never grab attention.** Predictability is a feature. A vanishingly thin
  layer of subtle ornaments is allowed — see
  [`docs/ornaments.md`](docs/ornaments.md) — but no hooks, no drops, no
  moments.
- **Pure synthesis.** Lo-fi character is produced procedurally (saturation,
  filtering, noise beds, wow/flutter), not sampled. Keeps the
  "kilobytes-not-gigabytes" identity honest.
- **Dynamics propose, music theory disposes.** Chaotic / noise sources drive
  *parameters*; pitch is always quantized onto a locked scale. No wrong
  notes by construction.
- **Seed-determinism is a feature.** Same seed, same soundscape.

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/handoff.md`](docs/handoff.md) | Canonical project context — design principles, v1 spec, architecture, strategy |
| [`docs/lofi-study.md`](docs/lofi-study.md) | Music-theory survey — modes, chords, progressions, voicings, drums, subgenres |
| [`docs/dynamics-brainstorm.md`](docs/dynamics-brainstorm.md) | How the engine evolves: generator primitives, timescales, attractor integration |
| [`docs/ornaments.md`](docs/ornaments.md) | The point-process model for subtle salient events |
| [`docs/stack.md`](docs/stack.md) | Tech stack, monorepo layout, what Tone.js is, dev setup |
| [`docs/seed-format.md`](docs/seed-format.md) | Seed format, PRNG (PCG32 + splitmix64), determinism contract |
| [`docs/event-protocol.md`](docs/event-protocol.md) | Typed event interface across the core/adapter split |
| [`docs/gaps.md`](docs/gaps.md) | Running punch list of open questions and unresolved specs |
| [`docs/obsidian-brainstorm.md`](docs/obsidian-brainstorm.md) | Early notes on the Obsidian plugin (stub) |

## License

MIT (planned — `LICENSE` file pending). The whole engine is and will remain
permissively licensed.
