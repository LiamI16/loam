---
name: close-out
description: Finish a feature/stage properly — update stage-list.md and the relevant docs with an assumptions log, then ship. Use when the user says "close out", "wrap this up", or a stage/task from a docs task list is complete.
---

# Close-out — finish a feature the Loam way

Finishing a feature is not just code working; docs must reflect it
without the user having to ask. Follow the standing
`docs/documentation-procedure.md` — close-out is where it's enforced.

## Steps

1. **Collapse the driving feature doc** to its permanent core:
   **decision record** (why / alternatives / evidence) + **assumptions
   log** (decisions/assumptions made along the way that weren't in the
   plan — the user relies on these). **Delete** the plan scaffolding,
   completed/struck-through task lists, and resolved open-questions —
   do not move them to `archive/`; git history is the record.
2. **Check for duplicated frozen constants**: no numeric value should
   appear in both the doc and code. The value lives once in code (with
   a comment pointing at the doc's rationale); the doc names the symbol
   and never restates the number. Fix any duplication found.
3. **Update `stage-list.md`**: move the item to the Done table as a
   **one-line entry with a doc link** — no progress narrative that
   commits + the doc already carry.
4. **Update any other design doc** the work touched (melody,
   seed-identity, seed-format §7.3a on fingerprint breaks). Design
   notes live in `docs/`, never the repo root, never auto-memory.
5. **Ship**: invoke the `ship` skill (gate → selective commit to main →
   push → watch CI green).
