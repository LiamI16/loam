# Current stage — development checklist

> Working memory for the build. Lives at repo root so future Claude sessions
> see it immediately. Update as items complete (`[ ]` → `[x]`). When a stage
> is fully done, mark it and move to the next. When a new stage is needed
> beyond Stage 4, add it.
>
> Linked context: `docs/stack.md` (project structure), `docs/seed-format.md`
> (Stage 2 contract), `docs/event-protocol.md` (Stage 3 contract).

---

## Prerequisites (decisions, not code)

- [x] Resolve pure-synth vs sampled-instruments contradiction — `handoff.md`
      §Known gaps bullet 2 rewritten.
- [x] Pick seed format and PRNG — splitmix64 derivation + PCG32 stream,
      64-bit integer surface. Spec: `docs/seed-format.md`.
- [x] Sketch core ↔ adapter event protocol — first-draft typed events for
      note / param / tick. Spec: `docs/event-protocol.md`.

---

## Stage 1 — Repo skeleton ✅

- [x] Install Node.js LTS + pnpm (Node v24.16.0 via fnm, pnpm 11.7.0)
- [x] `package.json` at repo root (private monorepo root)
- [x] `pnpm-workspace.yaml` pointing at `packages/*` and `apps/*`
- [x] `LICENSE` (MIT, © 2026 Liam Imagawa)
- [x] `.gitignore` (node_modules, dist, .DS_Store, *.log, etc.)
- [x] `.node-version` pinning Node 24 (auto-switch via fnm `--use-on-cd`)
- [x] Biome 2.5 at the root, permissive default config
- [x] `.github/workflows/ci.yml`: install → lint → test on push & PR
- [x] Smoke check: `pnpm install` ✓, `pnpm run lint` ✓, `pnpm run test` ✓ (exits 0 on empty workspace)
- [ ] CI green on remote — requires pushing to GitHub first; not blocking

**Done when:** the repo is a working monorepo skeleton with CI green and no
code yet.

**Notes for Stage 2:** empty `packages/` and `apps/` exist with `.gitkeep`
files; remove the `packages/.gitkeep` when `packages/core` is added.

---

## Stage 2 — `@loam/core` foundations ✅

- [x] `packages/core/` scaffolded with `tsup` (build) + `vitest` (test) +
      `typescript`
- [x] Implement `splitmix64` (`src/rng/splitmix64.ts`)
- [x] Implement `Pcg32` stream PRNG (`src/rng/pcg32.ts`)
- [x] Implement `hash64String` (FNV-1a) for label hashing (`src/rng/hash64.ts`)
- [x] Implement `Seed` class with `.child(label)` derivation (`src/rng/seed.ts`)
- [x] Implement `Rng` wrapper API per `docs/seed-format.md` §2 (`src/rng/rng.ts`)
- [x] **Determinism contract test** — 6 tests covering: same seed → same
      sequence, different seeds diverge, child labels diverge, same label
      reproduces, sibling-order independence, and a hard-coded known
      sequence for `Seed.from(42n)`. Never relax.
- [x] Event-protocol type stubs (`src/events.ts`) — `NoteEvent` / `ParamEvent` /
      `TickEvent` per `docs/event-protocol.md`
- [x] `packages/core` builds (`tsup` ESM + DTS), all tests pass, lint clean,
      typecheck clean
- [x] CI updated to run `build` step in addition to lint + test

**Done when:** `import { Seed, Rng } from '@loam/core'` works, the
determinism test passes, and the event-type stubs compile. ✓

---

## Stage 3 — First end-to-end thread ✅

- [x] `packages/synth-tone/` scaffolded, depends on `@loam/core` and `tone`
- [x] `ToneAudioAdapter` — channel registry, pull-based scheduler
      (25 ms tick, 200 ms lookahead), `note` dispatch via
      `PolySynth.triggerAttackRelease`, tick-listener fan-out, `param`
      stub for Stage 4
- [x] `@loam/core`: `Engine` interface + `VampEngine` placeholder
      (Dm9 → Gmaj7, hard-coded, no randomness — 5 + 4 notes every 2 bars
      at 74 BPM, tick events every beat)
- [x] `Channels` const exported for typo-safe channel names
- [x] `apps/web-demo/` scaffolded with Vite — one Play button, ember-style
      pulse dot, warm dark palette
- [x] Click handler starts AudioContext, builds Rhodes FMSynth + chorus +
      reverb chain, wires Engine ↔ Adapter, calls `start()`
- [x] 6 new tests cover VampEngine (chord boundaries, tick rhythm,
      forward-only cursor, reset, ordering)
- [x] Audible in a browser (user confirmed Stage 3 sounds correct)
- [x] All packages lint / typecheck / build / test green, CI passing

**Design assumptions captured:**
- `docs/event-protocol.md` §9.6a-b — engine is pull-based with no
  background work; `scheduleUntil` is forward-only
- `docs/adapter.md` — new doc covering scheduling model, Tone.Transport
  abstinence, tick-listener latency, `ParamEvent` stub, signal-chain
  duplication risk for the future Obsidian plugin, voice-stealing,
  browser-only targeting

**Done when:** clicking Play in `pnpm dev` plays the two-chord vamp
through the modular architecture. ✓

---

## Stage 4 — Port the prototype's sound

Reproduce `ember-generative-study.html` through the modular architecture,
no new musical capability.

- [ ] Port the signal chain (FM Rhodes + AM pad → chorus → slow-LFO low-
      pass → reverb → warmth filter)
- [ ] Port the drum sequencing (kick/snare/hat 16-step patterns)
- [ ] Port noise beds (brown bed, rain bandpass, vinyl crackle)
- [ ] Port the chord/progression logic and the sparse pentatonic melody —
      now using `Rng` from `@loam/core` instead of `Math.random()`
- [ ] Port the existing UI controls (volume, warmth, density, rain, vinyl
      toggles, ember play affordance)
- [ ] Replace `ember-generative-study.html` in the demo path with the new
      Vite-built version
- [ ] Side-by-side A/B: new demo sounds substantively like the original

**Done when:** the new demo is at sonic parity with the HTML prototype,
seeded determinism works end-to-end, and the original HTML is retired.

---

## Stage 5+ — Dynamics and content (not yet planned in detail)

When Stage 4 completes, plan Stage 5 against `docs/dynamics-brainstorm.md`
§7 prototyping order: fBm noise on all continuous knobs → Markov chord
transitions + voice-leading → Lorenz macro mood → L-system melody → CA
drum drift → ornament process from `docs/ornaments.md`.

Don't plan these stages now; the right scope will be clearer once the
modular foundation is real.
