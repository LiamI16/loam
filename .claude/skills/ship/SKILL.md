---
name: ship
description: Run the full pre-push gate (lint, typecheck, test), commit to main, push, and watch CI to green. Use whenever the user says "ship", "commit and push", "push it with the CI check", or a feature is done and needs to land.
---

# Ship — gate, commit, push, watch CI

The complete landing ritual for Loam. Trunk-only: everything goes to
`main`, never a branch.

## Steps

1. **Gate** (from repo root, output visible — never silence with
   `>/dev/null`):
   ```
   pnpm lint && pnpm typecheck && pnpm test
   ```
   Fix any failure before continuing. Always `pnpm`, never `npm`.

2. **Stage selectively — at hunk level, not just file level.** Check
   `git status` first — the user often has simultaneous unrelated WIP
   (doc edits, other agents' changes). Stage only files belonging to
   this change, and before committing, read `git diff --cached` for any
   file you also share with another workstream: a whole-file `git add`
   sweeps in foreign uncommitted hunks (this broke CI once: another
   agent's flag plumbing referenced types that only existed in their
   uncommitted code, masked locally by a stale dist). If a staged file
   contains hunks that aren't yours, unstage and re-stage your hunks
   via a targeted edit or `git add -p`-equivalent. List anything you
   left out.

3. **Commit to `main`** with a conventional message
   (`feat(scope): …` / `perf(…)` / `docs(…)`). If the change shifts the
   engine fingerprint test, say so in the commit message and update
   `docs/seed-format.md` §7.3a first.

4. **Push.** The repo pre-push hook re-runs the gate; if it fires red,
   fix rather than bypass. Never use `--no-verify` unless the user
   explicitly asks.

5. **Watch CI to completion**: `gh run watch` on the new run (get the
   id from `gh run list --limit 1`). Run it in the background if it's
   slow. Report pass/fail; if it failed, investigate and fix
   immediately — don't leave main red.
