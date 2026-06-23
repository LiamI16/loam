# Contributing to Loam

> ⚠️ Placeholder — this is an early-stage project and these guidelines
> will evolve. Open an issue if anything here is unclear or out of date.

Thanks for your interest in Loam! Contributions, ideas, and bug reports
are welcome.

## Getting set up

Loam is a pnpm workspace. You'll need:

- **Node** ≥ 24 (see `.node-version`)
- **pnpm** 11.7.0 (`corepack enable` will pick this up automatically)

```bash
pnpm install      # install dependencies
pnpm build        # build all packages
pnpm test         # run the test suite
pnpm lint         # check formatting + lint (Biome)
pnpm fix          # auto-fix lint/format issues
```

## Project layout

- `packages/core` — `@loam/core`, the framework-agnostic engine
- `packages/synth-tone` — `@loam/synth-tone`, the Tone.js audio adapter
- `apps/web-demo` — hosted web demo
- `docs/` — design notes and decisions (start with `README.md` and
  `stage-list.md`)

## Before opening a PR

- Run `pnpm fix` and `pnpm test` — both should pass.
- Keep changes focused; smaller PRs are easier to review.
- The engine fingerprint test (`packages/core/test/ember-engine.test.ts`)
  pins generated output at a known seed. If your change intentionally
  shifts it, call that out in the PR description — it's a deliberate
  seed-format change, not an accident.

## Questions / ideas

Open a GitHub issue. For design discussions, the `docs/` directory is the
source of truth for decisions already made.
