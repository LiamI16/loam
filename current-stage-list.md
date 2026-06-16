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

## Stage 2 — `@loam/core` foundations (1 focused session)

- [ ] `packages/core/` scaffolded with `tsup` (build) + `vitest` (test)
- [ ] Implement `splitmix64` (one 64-bit input → one 64-bit output)
- [ ] Implement `pcg32` stream PRNG
- [ ] Implement `Seed` class with `.child(label)` derivation
- [ ] Implement `Rng` wrapper API per `docs/seed-format.md` §2
- [ ] **Determinism contract test**: a fixed seed produces a known
      sequence of N integers. This test is the project's seed-determinism
      guarantee — never delete, never relax.
- [ ] Stub out event-protocol types from `docs/event-protocol.md` §1
- [ ] `packages/core` builds, tests pass in CI

**Done when:** `import { Seed, Rng } from '@loam/core'` works, the
determinism test passes, and the event-type stubs compile.

---

## Stage 3 — First end-to-end thread (1 session)

The minimum amount of music that crosses both packages. Goal: prove the
data flow, not to be musical.

- [ ] `packages/synth-tone/` scaffolded, depends on `@loam/core` and `tone`
- [ ] Adapter implements `AudioAdapter` from `event-protocol.md` §8 —
      subscribes to engine events, translates `note` events into
      `PolySynth.triggerAttackRelease`, registers a default `rhodes` channel
- [ ] In `@loam/core`: a hard-coded 2-chord vamp (Dm9 → Gmaj7), switching
      every 2 bars. No randomness, no dynamics. Emits `note` + `tick` events
      on schedule.
- [ ] `apps/web-demo/` scaffolded with Vite, single HTML page, one Play
      button
- [ ] Button starts the AudioContext on click, instantiates the engine and
      adapter, wires them together, calls `start()`
- [ ] You can hear the vamp in a browser

**Done when:** clicking Play in `pnpm dev` plays the two-chord vamp
through the modular architecture, and the seed is honored (same seed →
same sequence — even though the sequence is trivial here).

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
