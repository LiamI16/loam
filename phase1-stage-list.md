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

## Stage 4 — Port the prototype's sound ✅

**Engine:**
- [x] `EmberEngine` + four sub-schedulers (chord, drum, melody, crackle),
      each with its own `seed.child(label)` for independent PRNG streams
- [x] `ChordScheduler` — 4 progressions, light random voicing, 45 %
      progression-swap chance per cycle, pad on root + 5
- [x] `DrumScheduler` — boom-bap kick/snare grid, closed hats every 8th,
      ghost-hats on off-16ths
- [x] `MelodyScheduler` — sparse pentatonic, density-gated
- [x] `CrackleScheduler` — engine-driven vinyl pops, gated by
      `vinylEnabled` engine option
- [x] All randomness via seeded `Rng` (no `Math.random()` anywhere in core)
- [x] `engine.setOption(name, value)` for live UI-driven knobs
- [x] 23 new tests (chord/drum/melody/engine + the engine determinism
      contract — `Seed.from(42n)` → known 6-event fingerprint)

**Adapter:**
- [x] Two-node master pipeline: `master` (Tone.Volume, dB) → `out`
      (Tone.Gain, 0/1 fade gate) → destination — fixes
      brown-noise-during-pause bug from Stage 3
- [x] `latestScheduledAudioTime` watermark prevents Tone "time must be ≥
      last scheduled" errors on mid-playback reseed / BPM change
- [x] `ChannelRegistration` now a `(trigger, releaseAll?)` callback pair
      — supports non-pitched voices (`NoiseSynth`, `MembraneSynth`)
- [x] `ParamSetter` callback API — adapter only deals in numbers, chain
      wraps Tone's generic `Param<unit>` at the boundary
- [x] Explicit `linearRampToValueAtTime` for mute gate, not Tone's
      `rampTo` (which asymptotes and leaves noise audible)

**Chain (`buildLofiChain`):**
- [x] FM Rhodes + AM pad → chorus → slow-LFO low-pass → reverb → warmth
      → master, drum bus through warmth too
- [x] Brown bed, rain, vinyl crackle — all bypass warmth, route direct
      to master (warmth should muffle music, not atmospherics)
- [x] Rain: pink noise through two parallel static bandpasses (low wash
      + high sparkle), no LFO (rain isn't periodic)
- [x] Crackle: boosted vs prototype (-8 dB / 2 kHz HP) so the toggle is
      audibly perceivable

**Web demo:**
- [x] Breathing-ember UI, volume / warmth / density / tempo sliders,
      rain / vinyl toggles
- [x] Seed display + paste-to-reseed input + Roll / Copy buttons + URL
      permalinks (`?seed=...`)
- [x] In-place reseed and BPM change — fade out, swap engine, fade in
      (no page reload, sliders preserved)
- [x] Spacebar global play/pause (filtered: skips text inputs and
      buttons; passes through sliders and the ember)
- [x] Vite `resolve.alias` for `@loam/*` → `packages/*/src/index.ts` —
      library edits HMR through to the demo without a `tsup` rebuild
- [x] All packages lint / typecheck / build / test green, CI passing

**Design assumptions captured:**
- `docs/event-protocol.md` §9.6c–e — shared mutable options, sub-scheduler
  reset re-derives Rng, `Channels.BELL` temporary alias for crackle
- `docs/adapter.md` §8–11 — two-node master pipeline, latest-scheduled
  watermark, channel/param callback APIs
- `docs/stack.md` §8 — Vite alias for workspace source

**Bugs surfaced and fixed mid-stage** (kept for posterity):
- Stop fade asymptoted near 0, leaving brown noise audible — fixed by
  the two-node master pipeline and explicit `linearRampToValueAtTime`
- Mid-playback reseed threw Tone "time must be ≥ last scheduled" —
  fixed by `latestScheduledAudioTime` watermark
- Vinyl toggle initially seemed broken — actually wiring was fine, just
  the prototype-faithful crackle level was inaudibly subtle (boosted)
- Rain volume tied to warmth slider — fixed by routing texture beds
  past warmth
- Spacebar double-fired on stage focus — fixed by `stopPropagation` +
  filter on input/textarea/button
- Slider focus blocked spacebar — fixed by tightening filter to only
  block text-like input types
- `:focus-visible` ring on the ember persisted after spacebar — removed
  ember-specific focus styling (breathing glow is the real indicator)
- Page reload on reseed destroyed slider state — replaced with in-place
  engine swap + `history.replaceState`

**Done when:** the demo is at sonic parity with the HTML prototype,
seeded determinism works end-to-end, and the UX feels actually-usable. ✓

---