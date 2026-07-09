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
- **`docs/documentation-procedure.md`** — how a feature doc lives and
  closes (plan → active → collapsed decision-record). Read before
  writing a new doc or closing one out. Frozen values live once in
  code; docs point at the symbol, never restate the number.
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

- **Discuss before implementing.** For anything with design surface,
  plan in `docs/` and get alignment first — don't start coding while
  details are still open. The user wants to iron out edge cases and
  assumptions up front ("one-shot" implementation from a settled doc).
- **One question at a time.** In design discussions, raise a single
  lettered question per message, not a batch — the user wants to
  address each in detail.
- **Lock taste, not physics.** One-question-at-a-time and doc-locking
  are for *taste / scope* decisions. An empirical claim — what a DSP
  node actually does to the real signal — may not be written into a
  doc as "LOCKED" without a spike measurement attached. Several locked
  tape/crush claims ("tanh adds +1–2 dB mid harmonics") didn't survive
  first contact with the signal. Hypothesize the physics; budget 1–2
  recipe iterations explicitly; don't promise a one-shot the work
  can't keep.

## Workflow conventions

- **Trunk-only.** Commit directly to `main`. Never create branches
  unless explicitly asked.
- **Verify changes yourself before asking the user to.** The user is
  not the test harness. Audio/engine changes: confirm numerically
  first (the `/listen-check` skill — twice, an "inaudible" change was a
  real wiring bug). UI changes: run the dev server
  (`http://localhost:5173/loam/` — note the `/loam/` base path) and
  look at it; don't verify visual work with `pnpm build` alone. When
  a user ear-test is finally needed, ask about exactly one thing.
- **Abstract shared values.** A value used in more than one place gets
  raised into a shared constant/abstraction, never duplicated
  (rain/warmth and theme-color hardcoding both had to be corrected).
- **Ear-test preflight.** Before any listening/ear session, check the
  boot flag-override log and confirm the context sample rate. A stale
  `loam.flag.*` (e.g. a `samplerate=20050` typo) has silently voided
  entire listening sessions — including an approval *and* the bug
  report that acted on it.
- **Worktree per concurrent workstream.** Trunk-only refers to
  *commits*, not working trees. Concurrent agents / workstreams get
  separate worktrees (`EnterWorktree`) — a shared dirty tree caused
  foreign hunks in commits and gate-failing WIP inherited by the next
  session. Don't leave gate-failing work in the tree between sessions.
- **Close-out is part of the feature.** Finishing work updates docs
  without being asked — the `/close-out` skill owns the ritual (per
  `docs/documentation-procedure.md`).
- **Skills:** `/ship` (gate → commit → push → watch CI),
  `/listen-check` (programmatic audio verification), `/close-out`,
  `/profile` (synth-chain CPU numbers). Prefer them over ad-hoc
  versions of the same rituals.

## Working notes

- **`docs/` for design notes**, never the repo root. Only `.md` files
  allowed at root: `README.md`, `CLAUDE.md`, `stage-list.md`.
- **"Knob"** = seed-controlled parameter.
- **Engine fingerprint** (`packages/core/test/ember-engine.test.ts`)
  pinned at `Seed.from(42n)` with `bpm: 74`. Any change that shifts
  it is a deliberate seed-format break — document in commit message
  and `docs/seed-format.md` §7.3a.
- **Before `git push`**: the pre-push hook (`.githooks/pre-push`, via
  `core.hooksPath`) runs the CI gate (install · lint · typecheck ·
  deadcode · test · build); the `/ship` skill drives it. Never bypass
  with `--no-verify` unless asked; always `pnpm`, never `npm`; run
  unsilenced (no `>/dev/null`). Note: biome bans non-null assertions
  (`x!`) and tsconfig has `noUncheckedIndexedAccess` on, so indexed
  access is `T | undefined`.
