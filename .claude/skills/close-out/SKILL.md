---
name: close-out
description: Finish a feature/stage properly — update stage-list.md and the relevant docs with an assumptions log, then ship. Use when the user says "close out", "wrap this up", or a stage/task from a docs task list is complete.
---

# Close-out — finish a feature the Loam way

Finishing a feature is not just code working; docs must reflect it
without the user having to ask.

## Steps

1. **Update `stage-list.md`**: move the item to the done table / check
   it off.
2. **Update the driving task doc** (e.g. `docs/web-demo.md`,
   `docs/audio-cpu-plan.md`, `docs/mobile.md`) — mark the task done and
   append a short **assumptions log**: decisions and assumptions made
   along the way that weren't in the plan. The user relies on these.
3. **Update any design doc** the work touched (melody, seed-identity,
   seed-format §7.3a on fingerprint breaks). Design notes live in
   `docs/`, never the repo root, never auto-memory.
4. **Ship**: invoke the `ship` skill (gate → selective commit to main →
   push → watch CI green).
