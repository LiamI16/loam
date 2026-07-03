---
name: listen-check
description: Verify an audio/engine change programmatically before asking the user to ear-test. Use after any change that should alter what a seed sounds like (params, effects, schedulers), or when the user says "I can't hear a difference" / "analyze <seed>".
---

# Listen-check — verify audio changes without the user's ears

The user is not the test harness. Twice, an "inaudible" change turned
out to be a real wiring bug. Confirm a change is wired up and moving in
the intended direction *numerically* first; the user's ear test is the
final step, not the first.

## Tools

Build first: `pnpm --filter @loam/core build`, then from
`packages/core/`:

- **What the engine emits** (bar-by-bar event listing, multi-seed
  comparison):
  ```
  node --experimental-strip-types scripts/render-snippet.ts \
    --seed <seed> [--bpm 74] [--seconds 16] [--start 0]
  # or: --seeds 42,1,2 --seconds 12
  ```
- **Why** (germ shape, per-seed parameter draws, activity over time):
  ```
  node --experimental-strip-types scripts/analyze-seed.ts <seed>
  ```

For synth-chain/DSP changes that don't show in engine events, use
`packages/synth-tone/scripts/profile-chain.sh` output or a headless
OfflineAudioContext render — extend the existing scripts rather than
writing one-off throwaways (and if a new diagnostic is genuinely
needed, make it a permanent script in `packages/core/scripts/`).

## Procedure

1. Capture output **before** the change (or with the flag off) and
   **after** (flag on) for the same seed(s) — seed 42 plus 1-2 others.
2. Diff them. State concretely what changed (event counts, velocities,
   parameter draws, timing offsets). If nothing changed, you've found a
   wiring bug — fix it before involving the user.
3. Only then hand the user a listen URL with explicit flags, e.g.
   `http://localhost:5173/loam/?seed=42&<flag>=1`, and tell them the
   *one* thing to listen for. One A/B question at a time — ear fatigue
   is real ("I'm getting hearing blind").
