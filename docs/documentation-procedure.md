# Documentation procedure

> How a doc is born, lives, and closes. Standing rules — settled
> 2026-07-09 after a reflective review flagged doc bloat (~7,500 lines
> across 22 files) as a real maintenance cost.

## The core distinction

Two kinds of content live in `docs/`, and they age differently:

- **Decision records** — *why* a thing is the way it is: the problem,
  the alternatives considered, the evidence. Permanent, cheap to keep,
  rarely wrong later. **Favour these.**
- **Procedural state** — task checklists, "outstanding" lists,
  progress narratives, frozen-value tables that restate code
  constants. Expensive: every one is a surface that drifts out of sync
  with reality. **Minimise these; each lives in exactly one place or
  is deleted at close-out.**

The failure mode this procedure exists to prevent: a value or a status
represented in several places at once (e.g. `TAPE_HISS_DB_DEFAULT` read
−50 in a doc table while code and prose said −72). More surfaces =
more drift, not more safety.

## Feature-doc lifecycle

A feature doc passes through three states.

### 1. Plan

The doc opens as a plan and gets aligned on **before coding** (see
CLAUDE.md "Discuss before implementing"). Contains:

- Problem / motivation.
- **Locked decisions** and the alternatives considered (the future
  decision record).
- **Open questions** (shrinks as they resolve).

### 2. Active

During implementation the doc's **only** mutable procedural surfaces
are:

- the **assumptions log** — append-only; decisions/assumptions made
  along the way that weren't in the plan;
- the **open-questions** section — shrinks as questions resolve.

Task checklists live in **`stage-list.md`, not the feature doc.** Never
keep a second checklist inside the doc — it will diverge from
stage-list. Progress narrative ("did X, then Y") does not belong here
either; commits already carry it.

### 3. Closed

At close-out the doc **collapses in place** to its permanent core:

- **decision record** (why / alternatives / evidence), and
- **assumptions log**.

Plan scaffolding, struck-through or completed task lists, and resolved
open-questions sections are **deleted outright**. Git history is the
record of superseded plans — do **not** copy them to `archive/`. The
`archive/` directory is a frozen precedent (phase-1), not a pattern to
extend.

## Where "current truth" for a value lives

**Always code.** A frozen constant is declared once in code with a
comment pointing at its rationale:

```ts
// see docs/tape-texture.md for why -72 (broadband hiss floor)
const TAPE_HISS_DB_DEFAULT = -72;
```

The doc explains *why* and names the symbol; it **never restates the
number.** A number that appears in both a doc and code is a bug
waiting to happen — the doc points at the symbol instead. This is the
CLAUDE.md "abstract shared values" rule extended to prose.

## stage-list.md

The load-bearing part is **Done-table + Next-up + Backlog.** "Recently
done" narrative prose collapses to **one-line Done-table entries with a
doc link.** Anything that commits + a linked doc already record does
not get re-told here.

## What close-out enforces

The `close-out` skill checks, without being asked:

1. The feature doc is collapsed to **decision-record + assumptions-log**
   — plan/task scaffolding deleted, not archived.
2. **No frozen numeric constant is duplicated** between doc and code;
   the doc points at the code symbol.
3. **stage-list.md** narrative is trimmed to one-line Done entries with
   doc links.
