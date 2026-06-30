# Contributing to Loam

Loam is a solo creative project. I (Liam) work on it in my own time,
which means I can't always promise fast turnaround — but I'm really
glad you're reading this. The MIT license is an invitation: fork
freely, build on top, take it somewhere Loam can't go on its own.

This doc is for the things you'd want to know if you do want to engage
with this repo directly: how to discuss, when a PR makes sense, when
to fork, and how the dev loop works.

## Discussion

Open a GitHub issue for anything — bug reports, ideas, feedback,
questions about how something works, "I want to build X, should I PR
or fork?" I read everything and reply when I can. Not every issue will
turn into a change, but they're the right place to start a
conversation.

## PRs

Two tiers:

**Small fixes — PR away.** Typos, broken links, doc clarifications,
obvious bug fixes. I'll review and merge these when I see them.

**Anything bigger — open an issue first.** A new parameter, a new
musical layer, a new ornament, a new theme, a new feature: tell me
what you want to build before you write the code. We'll figure out
together whether it slots in or fits better as a fork. This saves you
the worst outcome: a finished PR I have to turn down.

The rough split:

- **Extends Loam** — a new piece slotting into the existing lo-fi
  engine, a new preset, a new ornament, a new theme palette: usually
  a PR.
- **Redirects Loam** — a new primary genre, sample-based instruments,
  ML generation, accounts/cloud features, big architectural refactors:
  better as a fork.

When it's not obvious where something falls, ask in an issue.

## When to just fork

The license invites it. Fork freely if you want to:

- Build a different genre engine on top of `@loam/core`.
- Ship your own UI / app / desktop wrapper / plugin around the engine.
- Take Loam in a direction you don't think I'd merge anyway.

Forks are the highest-fidelity way to explore something Loam isn't.
You don't need to ask.

## Dev setup

Loam is a pnpm workspace. You'll need:

- **Node** ≥ 24 (see `.node-version`)
- **pnpm** 11.7.0 (`corepack enable` picks this up automatically)

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
- `docs/` — design notes and decisions

Start with `README.md` and `stage-list.md` for orientation.

## If you do open a PR

- Run `pnpm fix` and `pnpm test` — both should pass.
- Keep the change focused; smaller PRs are easier to review.
- The engine fingerprint test (`packages/core/test/ember-engine.test.ts`)
  pins generated output at a known seed. If your change shifts it, that's
  a deliberate seed-format break — call it out in the PR description.
