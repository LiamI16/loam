# Loam — Claude Code context

> Auto-loaded into every session. Keep thin — pointer, not duplicate.
> Source of truth lives in `docs/` and `stage-list.md`.

## What this project is

Offline, infinite, on-device generative music engine producing purely
synthesized lo-fi audio for sustained focus. Seed-based procedural
generation ("Minecraft worldgen for sound"). TypeScript on Web Audio,
MIT, open-source. Two surfaces in v1: hosted web demo + Obsidian
plugin, sharing one engine.

## What to read for what

- **`stage-list.md`** — active development checklist. **Check first.**
  Done items in the summary table at top; remaining work in
  impact-ordered backlog.
- **`README.md`** — project description, design philosophy, v1 scope,
  generation architecture. The "what this is + why" doc.
- **`docs/seed-format.md`** — seed contract + locked-sequence layers
  (the seed-format compatibility surface).
- **`docs/seed-identity.md`** — load-bearing design principle for
  per-seed parameter decisions ("Minecraft seed" personality goal,
  the five-layer hybrid stack). Read before adding any new per-seed
  knob.
- **`docs/melody.md`** — melody layer design decisions (role,
  chord-melody coupling formula, phrase concept, strategy menu).
  Read before any work in `melody-scheduler.ts`.
- **`docs/event-protocol.md`** — typed engine↔adapter event contract.
- **`docs/ember-util.md`** — shared scheduler/harmony numeric helpers
  (`clamp01`, `mod12`, `nearestPitchClassInRange` in
  `engines/ember/util.ts`). Check before re-deriving pitch-class /
  clamp / nearest-pitch math in a scheduler.
- **`docs/gaps.md`** — unresolved questions; check before assuming
  something's decided.
- **Other `docs/*.md`** — discoverable via `ls docs/`. Read on demand
  when working in a relevant area (harmony, dynamics, ornaments,
  lofi-study, stack, mobile).

## Locked design decisions

Don't relitigate without explicit ask:

- Pure synthesis only (no audio samples)
- TypeScript on Web Audio at runtime; Python OK as build-time tool
- MIT open-source
- Lofi for v1, framing **loose** — adjacent sensibilities (Ghibli /
  jazz-piano / soft electronica) encouraged for variation space
- No ML in v1
- Core/adapter split: `@loam/core` framework-agnostic;
  `@loam/synth-tone` (Tone.js) is one adapter

## Design-discussion discipline

Before rejecting an option via framework principle, check whether
constraints could make it compatible. "Rejected outright" is a flag
to slow down, not speed up.

## Working notes

- **`docs/` for design notes**, never the repo root. Only `.md` files
  allowed at root: `README.md`, `CLAUDE.md`, `stage-list.md`.
- **"Knob"** = seed-controlled parameter.
- **Engine fingerprint** (`packages/core/test/ember-engine.test.ts`)
  pinned at `Seed.from(42n)` with `bpm: 74`. Any change that shifts
  it is a deliberate seed-format break — document in commit message
  and `docs/seed-format.md` §7.3a.
- **Before any `git push`**, run `pnpm lint && pnpm typecheck && pnpm
  test` from the repo root and fix failures first — this is the gate
  CI enforces (install · lint · typecheck · deadcode · test · build).
  Note: biome bans non-null assertions (`x!`) and tsconfig has
  `noUncheckedIndexedAccess` on, so indexed access is `T | undefined`.
