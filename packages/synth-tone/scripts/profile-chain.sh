#!/usr/bin/env bash
# Phase-0 profiling runner (docs/audio-cpu-plan.md). Bundles profile-chain.ts
# with esbuild and runs it on Node with a native Web Audio polyfill so
# OfflineAudioContext render-timing works headless. Dev-only.
#
# Requires node-web-audio-api on NODE_PATH; install once into /tmp:
#   (cd /tmp && npm i node-web-audio-api)
set -euo pipefail
cd "$(dirname "$0")/../../.."   # repo root

# Build deps the bundle reads from dist.
pnpm --filter @loam/core build >/dev/null

ESBUILD=$(find node_modules/.pnpm -path '*esbuild@0*/bin/esbuild' | head -1)
POLY=${NWA_POLYFILL:-/tmp/node_modules/node-web-audio-api/polyfill.js}
OUT=$(mktemp -t profile-chain.XXXXXX).mjs

"$ESBUILD" packages/synth-tone/scripts/profile-chain.ts \
  --bundle --platform=node --format=esm \
  --external:node-web-audio-api \
  --outfile="$OUT" --log-level=warning

NODE_PATH=/tmp/node_modules node --import "$POLY" "$OUT"
rm -f "$OUT"
