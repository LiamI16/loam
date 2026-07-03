---
name: profile
description: Run the synth-chain CPU profiler (profile-chain.sh) and report the numbers. Use when the user asks to profile, measure CPU cost of the audio chain, or compare render-timing before/after a change.
---

# Profile — synth-chain CPU numbers

Runs `packages/synth-tone/scripts/profile-chain.sh` (bundles
`profile-chain.ts` with esbuild, runs headless on Node with the
node-web-audio-api polyfill; see docs/audio-cpu-plan.md).

## Steps

1. **One-time dep** — the polyfill must exist at
   `/tmp/node_modules/node-web-audio-api`; if missing:
   `(cd /tmp && npm i node-web-audio-api)`.
2. **Run in the background** (it's slow):
   ```
   bash packages/synth-tone/scripts/profile-chain.sh
   ```
3. When it finishes, **report the numbers as a table** — per-section
   render-time / CPU figures, not raw log dump. If comparing
   before/after a change, run both and show the delta per section.
4. Don't leave conclusions implicit: name the most expensive section
   and whether the change moved it.
