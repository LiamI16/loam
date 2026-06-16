# Tech stack & project structure

> Reference doc for the development side. Written for someone new to the
> JS/TS ecosystem. Decisions here override the loose `/core` and `/utils`
> layout the repo currently has.

---

## 1. Project structure — monorepo, not flat folders

The current `/core` and `/utils` top-level folders are fine for a single
script but won't scale to what's planned: a core engine, a synth adapter,
an Obsidian plugin, a web demo, and Python build-time tools. The standard
shape for this kind of project is a **monorepo** — multiple packages in
one git repo, sharing tooling, with explicit dependency direction enforced
by the package manager.

```
loam/
├── packages/
│   ├── core/              # @loam/core — pure logic, no audio library
│   ├── synth-tone/        # Tone.js adapter (only file that imports Tone.js)
│   └── obsidian/          # @loam/obsidian — the plugin
├── apps/
│   └── web-demo/          # the prototype, evolved
├── tools/                 # Python build-time tools (validation, MIDI work)
├── docs/                  # design docs (already here)
└── package.json           # workspace root
```

**Why packages, not folders:**

- Each one publishes to npm under its own name (`@loam/core` etc.) and can
  be versioned independently.
- The dependency direction is enforced: `synth-tone` and `obsidian` can
  import `@loam/core`, but `core` can't accidentally reach into them. This
  matters because the core/adapter split from `handoff.md` is meaningless
  if anything in core can import Tone.js.
- For an open-source project this is the layout outside contributors expect.
- The existing single-file prototype (`ember-generative-study.html`) lives
  outside this tree until it's migrated; afterward it becomes
  `apps/web-demo/`.

---

## 2. What Tone.js actually is

Three layers, bottom to top:

1. **Web Audio API** — the browser's *native* audio system. Every modern
   browser ships with it. Exposes low-level building blocks: oscillators,
   gain nodes, filters, a routing graph, a sample-accurate audio clock.
   Powerful but verbose — building even a simple synth means wiring up half
   a dozen nodes manually.

2. **Tone.js** — a JavaScript library that wraps Web Audio in musical
   abstractions. Gives you ready-made `Synth`, `PolySynth`, `FMSynth`,
   `Filter`, `Reverb`, `Chorus`, `MembraneSynth`, plus a `Transport` (a
   musical clock that thinks in bars/beats/BPM, not seconds), plus
   `Sequence` / `Loop` for scheduling events. Roughly what jQuery was to
   the DOM — a humane interface to a fiddly thing.

3. **Your code** — talks to Tone.js, never directly to Web Audio. The
   existing prototype is one big example.

**For Loam:** Tone.js sits *only* inside `packages/synth-tone`. `@loam/core`
doesn't know it exists — it emits abstract events ("play note B4 velocity
0.6 in 250 ms") and the adapter translates them into Tone.js calls. That
split is the whole architectural bet from `handoff.md` and the reason the
engine is portable (could swap Tone.js for Faust, raw Web Audio, or a
native audio backend later without touching core).

---

## 3. The full stack, layer by layer

| Layer | Tool | What it does |
|---|---|---|
| **Language** | TypeScript | JavaScript with a type system. You write `.ts`, a compiler emits `.js`. The type system catches whole classes of bugs before runtime — important for an engine with dozens of orthogonal knobs. |
| **JS runtime (build / test)** | Node.js (LTS) | Lets you run JS outside a browser. Required to install packages, run tests, run build tools. `@loam/core` is testable in plain Node so it can be validated without a browser. |
| **Browser runtime** | Modern Chromium / Firefox / Safari | Where the engine actually plays. Web Audio API and `AudioContext` live here. |
| **Audio library** | Tone.js v14 | See §2. Bundled locally (not CDN) for the v1 demo. |
| **Package manager** | **pnpm** (recommended) or npm | Installs dependencies, manages workspaces. pnpm is fastest and best for workspaces; npm is the default fallback. |
| **Bundler** | **Vite** (apps) + **tsup** (libraries) | Turns many `.ts` files into a few `.js` bundles the browser loads. Vite is the standard for web apps (dev server, hot reload); tsup is a thin esbuild wrapper for publishing libraries. |
| **Testing** | **Vitest** | Runs unit tests on `@loam/core` in Node. Same API as Jest but native TS support. Critical for the engine — you want to assert that a given seed produces a given event sequence, byte for byte. |
| **Lint / format** | **Biome** (or ESLint + Prettier) | Catches dumb mistakes, auto-formats. Biome is one fast tool that does both; ESLint+Prettier is the older, more-supported combo. Either works. |
| **Obsidian plugin SDK** | `obsidian` types package + their plugin template | TypeScript types for the Obsidian API, manifest format, build setup. The plugin loads `@loam/core` like any other npm dependency. |
| **Web demo hosting** | GitHub Pages | Free static hosting for the bundled HTML. CI builds, commits to `gh-pages` branch. |
| **CI** | GitHub Actions | Runs tests on every push, builds the demo, publishes packages to npm on tagged releases. Free for public repos. |
| **Python (build-time only)** | Python 3.x + numpy, scipy, music21, mido | For the offline validation harness and (eventually) Markov-matrix authoring from MIDI corpora. Never ships to users; lives in `tools/`. |

---

## 4. Helper libraries the engine will likely want

Small, focused — pick or hand-roll each:

- **PRNG**: `seedrandom`, or hand-rolled splitmix64 / xorshift / PCG. The
  native `Math.random()` isn't seedable.
- **Noise**: `simplex-noise` (tiny, no deps), or hand-rolled Perlin. Either
  way it's a few hundred lines.
- **Numerical integration** (for attractors): write a 20-line RK4 by hand.
  No library needed.
- **Music theory** (note math, intervals, scale arithmetic): `tonal` is the
  community standard. Optional — the math is simple enough to write by
  hand for the limited set Loam needs.

---

## 5. What we don't need

- **A UI framework** (React, Vue, Svelte). The prototype uses vanilla DOM
  and that's correct for the demo. Obsidian has its own UI layer.
- **A database.** Everything is in memory + browser localStorage for prefs.
- **A backend / server.** Pure client-side; that's the whole identity.
- **A CSS framework.** The demo's warm-palette CSS is small enough to hand-
  write.

---

## 6. Minimum viable setup — order of operations

When the engine work actually begins:

1. Install Node.js (LTS) and pnpm.
2. `pnpm init` at the repo root; turn it into a workspace
   (`pnpm-workspace.yaml` pointing at `packages/*` and `apps/*`).
3. Create `packages/core`, scaffold with `tsup` for builds + `vitest` for
   tests. Write the first deterministic-PRNG test before anything else —
   it locks in the seed-determinism property from day one.
4. Create `packages/synth-tone`, depend on `@loam/core` and `tone`.
5. Create `apps/web-demo`, scaffolded with Vite. Port the prototype here.
6. Add Biome (or ESLint+Prettier) at the root.
7. Add a basic GitHub Actions workflow (lint + test on push).
8. Defer `packages/obsidian` until the core has something worth playing.

Steps 1–7 are roughly half a day of boilerplate. After that you're writing
engine code, not configuration.

---

## 7. Migration note — the existing prototype

`ember-generative-study.html` stays where it is until step 5 above. At that
point it becomes the seed of `apps/web-demo/` — initially copied over
verbatim and refactored gradually to consume `@loam/core` instead of
implementing its own sequencing inline. Don't try to rewrite the prototype
and build the monorepo in the same pass; one or the other.

---

## 8. Workspace dev resolution — Vite alias to `src/`

By default, `apps/web-demo` imports `@loam/core` and `@loam/synth-tone`,
which resolve to each package's `dist/index.js` per their `package.json`
`exports`. Editing a library's `src/` doesn't reflect in the demo until
you re-run `tsup` to rebuild `dist/`. Easy to forget; bit us in Stage 4
when a chain edit "did nothing."

Fix: `apps/web-demo/vite.config.ts` adds a `resolve.alias` mapping
`@loam/*` directly to its `packages/*/src/index.ts`. Vite handles the TS
natively. Library edits now HMR through to the demo immediately.

**Trade-off:** the dev import path differs from the production npm-install
path. Fine for our case (TS source compiles to similar JS), but worth
knowing if a library ever does something odd at build time. Production
build (`vite build`) also follows the alias — output bundles the source
directly, skipping the published `dist/`. To test the published artifact
shape, run from a fresh checkout or temporarily disable the alias.

## 9. Open stack decisions

A few minor things still to pick — none blocking:

- **pnpm vs npm** for the workspace. pnpm if you're comfortable installing
  another tool; npm if you want the absolute minimum.
- **Biome vs ESLint+Prettier**. Biome if you want one tool; the older combo
  if you want maximum editor/community support.
- **Vitest vs Jest**. Vitest if Vite is the bundler (it is); Jest if any
  specific dependency requires it (none currently do).
- **Whether to publish to npm at all in v1**, or just ship the GitHub repo
  + the demo + the Obsidian plugin via Obsidian's store. Publishing to npm
  is the long-term right answer but isn't required for either v1 surface.
