# Loam — Claude Code context

> Auto-loaded into every Claude Code session in this repo. Keep this file as
> a *pointer*, not a duplicate — the source of truth lives in `docs/`.

## What this project is (one paragraph)

Loam is an offline, infinite, on-device generative music engine that
produces purely synthesized lo-fi audio for sustained focus / studying.
Ships as kilobytes of code, not gigabytes of audio. Seed-based procedural
generation (Minecraft worldgen, for sound). TypeScript on Web Audio, MIT-
licensed, open-source-first. Two surfaces in v1: a hosted web demo and an
Obsidian plugin, sharing one engine.

## Where to look first

- **`docs/handoff.md`** — *the* canonical project context. Design principles,
  v1 spec, tech stack, generation architecture, strategy. Start here.
- **`docs/lofi-study.md`** — music-theory survey. Keys, modes, chord
  vocabulary, progressions, voicings, drum patterns, subgenre archetypes,
  the full ~50-knob seed-parameter space.
- **`docs/dynamics-brainstorm.md`** — how the engine evolves over time
  without producing salient moments. Generator primitives, timescale
  layering, attractor integration, per-layer dynamics, transition mechanics.
- **`docs/ornaments.md`** — the carve-out from the "no salient moments"
  rule. Cox+refractory point process for *when* an ornament fires; per-type
  inhibitory rate for *what* fires.
- **`docs/gaps.md`** — running punch list of unresolved questions,
  contradictions, and specs still to write. Check before assuming something
  is decided.
- **`docs/stack.md`** — tech stack and project structure (monorepo layout,
  what Tone.js is, all the substacks, minimum-viable setup).
- **`docs/seed-format.md`** — seed format, PRNG choice (PCG32), sub-seed
  derivation (splitmix64). The contract behind "same seed → same soundscape."
- **`docs/event-protocol.md`** — the typed event interface across the
  core/adapter split, time semantics, lookahead scheduling.
- **`docs/obsidian-brainstorm.md`** — early notes on the Obsidian plugin
  surface (stub).

## Active build tracking

- **`current-stage-list.md`** (repo root) — the actual development
  checklist. Always check this first when picking up work. Update boxes as
  items complete; move stages forward as they finish.

## Working notes for Claude

- **`docs/` is where notes go.** Don't drop new markdown at the repo root.
- **`ember-generative-study.html`** is the existing single-file prototype.
  Treat it as reference / specimen; the modular codebase under `core/` is
  the v1 deliverable, not a refactor of the HTML.
- **`core/` and `utils/`** exist but are currently empty — the engine code
  hasn't started.
- **Locked design decisions** (don't relitigate without explicit ask): pure
  synthesis only (no samples), TypeScript on Web Audio (no Python at
  runtime), MIT open-source, lofi-only for v1, no ML in v1, core/adapter
  split with `@loam/core` framework-agnostic.
- **`docs/gaps.md` lists open questions** — when one comes up in
  conversation, resolve it, then move the decision into the relevant spec
  doc and delete from gaps.

## House style for this repo

- Keep docs in prose with tables where useful; this isn't a code-comments-
  only project — the design thinking *is* the artifact.
- Each doc states its purpose in a blockquote at the top.
- Cross-link related docs by relative path (`docs/foo.md`).
- "Knob" is the project's word for a seed-controlled parameter — use it
  consistently.
