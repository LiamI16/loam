# Melody implementation plan (temporary)

> **Temporary scratch doc** — exists to bridge a context compaction.
> Delete or fold into a permanent doc once Phase 1 ships.
>
> A fresh session reading this should be able to pick up at Commit A
> without needing the prior discussion.

## Where to find the design decisions

**Read first:** [`docs/melody.md`](melody.md) — full F1/F2/F3 design
with all sub-decisions captured. Sections you need:

- F1: role + min-cap chord-coupling formula
- F2: germ + local emission rules; ten templates; six transformations
  + retrograde-gated; compound 2-chain; rhythm cells + jitter + swing
- F3: closed (coupling is the relationship knob)

Also relevant:
- [`docs/seed-identity.md`](seed-identity.md) — five-layer framework;
  the carve-out for rare-event continuous-distribution draws applies
  to swing (sample-draw) and compound rate (Beta-drawn)
- [`docs/seed-format.md`](seed-format.md) §7.3a — fingerprint reset
  log; will need an entry per phase

## Branch state at planning time

- Last commit `50829fe` — `docs(melody): close all four foundational
  sub-decisions` (only docs).
- Tree clean; tests green at 97/97.
- Engine fingerprint pinned at count 113.

## Architectural decisions already made

- **Subfolder structure** (parallel to `harmony/`):
  ```
  packages/core/src/engines/ember/melody/
    melody-scheduler.ts    // orchestrator
    templates.ts           // T1-T10 + germ generation
    transformations.ts     // 6+1 transformations
    emission-rules.ts      // 4-way decision + coupling
    index.ts               // re-exports
  ```
- **Three-phase shippable approach** (each phase listenable):
  1. Core mechanism (germ + activity + coupling + basic emission)
  2. Emission rules + transformations + compound + buffer
  3. Polish (swing + jitter)

## Commit A — Detailed scope

**Goal:** expose `chordActivityStream` on `EngineState` so the melody
scheduler can later read it. No emission-logic changes; no melody
behaviour change; engine fingerprint **stays at 113**.

This is foundational plumbing. It's the smallest possible change that
makes the F1 coupling formula implementable in subsequent commits.

### Files touched

1. `packages/core/src/engines/ember/ember.ts`
2. `packages/core/src/engines/ember/chord-scheduler.ts`

### Change 1 — `EngineState` interface

Add two fields:

```ts
export interface EngineState {
  // existing fields...
  /** Exposed by ChordScheduler at construction. MelodyScheduler reads
   * via .evaluate(time) for the F1 min-cap chord-melody coupling
   * formula. */
  chordActivityStream: ParamStream;
  /** Slot-boundary timestamps appended by ChordScheduler at each
   * advanceSlot. MelodyScheduler uses this to detect "structural
   * moments" where retrograde transformation is eligible. Cleared
   * by ChordScheduler at scheduleUntil start (same lifecycle as
   * `chordSchedule`). */
  structuralMomentTimes: number[];
}
```

### Change 2 — `ChordScheduler` construction

In the constructor, after `this.activityStream` is created:

```ts
// Expose the activity stream to EngineState so the melody scheduler
// can evaluate it at per-emission resolution for the F1 chord-melody
// coupling formula. The stream is *shared* (same instance) — no copy.
state.chordActivityStream = this.activityStream;
```

In `scheduleUntil`, add the structural-moments tracking next to the
existing `chordSchedule` reset:

```ts
this.state.structuralMomentTimes = [];
```

And in `advanceSlot`, after the existing `chordSchedule.push(...)`:

```ts
this.state.structuralMomentTimes.push(barTime);
```

### Change 3 — `EmberEngine` construction

After the activity stream is built (already exists), the chord
scheduler is constructed and will populate `state.chordActivityStream`.

Need to **initialize** the new fields in `EngineState` to safe
defaults before any scheduler runs. In `EmberEngine.constructor`:

```ts
this.state = {
  // existing fields...
  chordActivityStream: new StaticParam(0.5), // placeholder; chord scheduler overwrites
  structuralMomentTimes: [],
};
```

The placeholder is just so the field is non-null at construction.
ChordScheduler immediately overwrites it on construction (which
happens right after `state` is assigned).

### What does NOT change in Commit A

- No new seed children
- No emission logic changes
- No new files (the `melody/` subfolder comes in Commit B)
- No melody behaviour change

### Tests

Add to `packages/core/test/ember-engine.test.ts`:

```ts
it('exposes chordActivityStream on EngineState', () => {
  // Test that state has the field and it evaluates to a valid number.
  // Easiest: spy on the chord scheduler, or just verify via
  // public-API that state field exists.
});

it('appends structural-moment timestamps at each slot boundary', () => {
  // After scheduling 10s, structuralMomentTimes should have entries
  // matching pad emission times (slot starts).
});
```

Determinism + fingerprint tests should **stay green at 113**. If
fingerprint changes, something added a seed child or shifted RNG
state — investigate before proceeding.

### Risk areas for Commit A

1. **Initialization order.** `EngineState.chordActivityStream` must
   exist (non-null) before `ChordScheduler` runs. Use
   `new StaticParam(0.5)` placeholder.
2. **`structuralMomentTimes` lifecycle.** Cleared at `scheduleUntil`
   start; appended during emission. Must match `chordSchedule`
   lifecycle exactly.
3. **No fingerprint change expected.** If fingerprint shifts despite
   no RNG-changing edits, audit Change 2 for any rng draws snuck in.

### Verification checklist

- [ ] `pnpm -r build` clean
- [ ] `pnpm -r test` all green
- [ ] Engine fingerprint count still 113
- [ ] `state.chordActivityStream` is the same instance as
      `ChordScheduler.activityStream` (verify by identity comparison
      in a test)
- [ ] `state.structuralMomentTimes` reset per `scheduleUntil` call

## Commit B — Templates + germ scaffolding (outline)

**Goal:** create melody folder structure, define ten templates as
static data, implement germ generation per seed. No emission changes;
fingerprint stays stable.

### Files created

- `packages/core/src/engines/ember/melody/templates.ts`
- `packages/core/src/engines/ember/melody/index.ts`

### Templates as data

Define the ten templates from `docs/melody.md`:

```ts
export type TemplateId = 'T1' | 'T2' | ... | 'T10';

export interface Template {
  readonly id: TemplateId;
  readonly contour: ContourArchetype;
  readonly noteCount: { min: number; max: number };
  readonly defaultRhythmCell: readonly NoteDuration[];
  readonly intervalBias: IntervalBias;
  readonly terminationType: TerminationType;
  readonly startConstraint: StartConstraint;
}

export const TEMPLATES: Readonly<Record<TemplateId, Template>>;
export const TEMPLATE_BASE_WEIGHTS: readonly number[];
```

### Germ data type

```ts
export interface GermNote {
  /** Pitch as scale-degree-relative offset from home key center.
   * Implementation discipline from docs/melody.md F1 sub-decisions:
   * store scale-degree-offset (not raw MIDI) so future chord-aware
   * adaptation is a reference-frame change. */
  readonly scaleDegreeOffset: number;
  readonly durationBeats: number;
}

export type Germ = readonly GermNote[];
```

### Germ generation

Per seed, at construction:

1. Roll template from Dirichlet-perturbed weights
2. Pick starting pitch (chord-tone choice — random from chord-1's
   chord tones)
3. Pick interval-size bias (some seeds tighter, some wider)
4. Pick length within template's range
5. Generate notes following contour + interval bias
6. Apply template's rhythm cell

New seed children needed:
- `melody-template-config` — per-seed Dirichlet template weights
- `melody-template` — single template-selection roll
- `melody-germ` — germ-generation rolls

Fingerprint **stays stable** because melody emission logic isn't
changed yet — new children are consumed but the existing emission
path doesn't read the new state.

Wait, actually consuming new children DOES NOT shift other children's
RNG sequences (each child is a separate stream). So adding new
children is fingerprint-safe IF nothing else in the engine's behaviour
changes.

## Commit C — Activity + coupling + basic emission

**Goal:** wire up the F1 min-cap coupling formula. Melody fires germ
fragments at effective-activity-gated points. No transformations yet;
no buffer. Engine fingerprint **resets** here.

### New scheduler state

```ts
class MelodyScheduler {
  private readonly melodyActivityStream: FbmParam;
  private readonly couplingStream: FbmParam;
  private readonly germ: Germ;
  // ...
}
```

### Effective activity formula (from F1)

```ts
const melodyAct = this.melodyActivityStream.evaluate(t);
const chordAct = this.state.chordActivityStream.evaluate(t);
const coupling = this.couplingStream.evaluate(t);

const effective =
    (1 - coupling) * melodyAct
  + coupling * Math.min(melodyAct, 1 - chordAct);
```

### Basic emission (no transformations yet)

For each quarter-note position in the schedule window:
1. Compute `effective` activity
2. Bernoulli against `effective`
3. If fires, pick next germ note (cycling through germ)
4. Emit at the position with germ's duration

This is intentionally simple — Phase 2 adds the four-way emission
rules and transformations.

### New seed children (additional to Commit B's)

- `melody-activity-fbm` + `-config`
- `melody-chord-coupling-fbm` + `-config`

Document the fingerprint reset in `seed-format.md` §7.3a.

## Phase 2 — Outline (revisit when ready)

Goal: full emission rule menu with transformations.

- 4-way emission rules (germ / transform / buffer / fresh)
- Recent buffer (size [4, 12] per seed)
- Six transformations (transpose, fragment, augment, diminish,
  ornament, invert)
- Retrograde-gated to structural moments
- Compound 2-chain
- Per-seed Dirichlet weights for emission rules + transformations
- Per-seed Beta-drawn compound rate

Files added: `transformations.ts`, `emission-rules.ts`.

Engine fingerprint resets again.

## Phase 3 — Outline

Goal: timing polish.

- Per-seed swing sample-draw from uniform `[0.50, 0.55]`
- Per-emission jitter ±5-10ms (matching drum convention)
- Apply at emission time as `time` offsets

Engine fingerprint resets one final time.

## Pitfalls / things to watch

1. **Compound transformation semantics** (Phase 2). "Fragment of an
   inverted germ" vs "inversion of a fragment" — order matters. Pick
   one semantic per pair and document in `transformations.ts`.
2. **Swing position detection** (Phase 3). Current scheduler is
   per-quarter-note based; swing requires 8n-position awareness. The
   `time % beat == 0.5 * beat` check is straightforward.
3. **Coupling formula evaluation** at per-emission resolution. The
   chord activity stream must be evaluable at arbitrary times, not
   just slot boundaries. Confirm `FbmParam.evaluate(t)` works at any
   `t`.
4. **Germ representation discipline.** Store as
   `pitch + scale_degree_offset` per the F1 sub-decisions doc, not
   raw MIDI. This is the small upfront investment that makes future
   chord-aware adaptation cheap.
5. **`structuralMomentTimes` reset** must mirror `chordSchedule`
   reset (same lifecycle, same caller). Drifting these apart causes
   subtle retrograde-gating bugs.

## Quick reference — seed children list (final)

After all three phases, the melody scheduler will have these seed
children. Cumulative count and which phase introduces each:

| Phase | Seed child | Purpose |
|---|---|---|
| B | `melody-template-config` | Dirichlet template weights |
| B | `melody-template` | template selection rolls |
| B | `melody-germ` | germ-pitch generation rolls |
| C | `melody-activity-fbm` | melody activity fBm signal |
| C | `melody-activity-config` | per-seed mean/depth/timescale shape |
| C | `melody-chord-coupling-fbm` | coupling drift fBm signal |
| C | `melody-chord-coupling-config` | per-seed coupling mean/depth |
| 2 | `melody-emission` | per-emission 4-way decision rolls |
| 2 | `melody-emission-config` | per-seed Dirichlet emission weights |
| 2 | `melody-transformation` | which transformation to apply |
| 2 | `melody-transformation-config` | per-seed Dirichlet transformation weights |
| 2 | `melody-compound` | per-emission compound roll |
| 2 | `melody-compound-config` | per-seed Beta-drawn compound rate |
| 3 | `melody-swing-config` | per-seed swing sample-draw |
| 3 | `melody-jitter` | per-emission timing jitter |

15 new seed children total. Each phase's fingerprint reset
documented in `seed-format.md` §7.3a.

## Ready-state check before starting Commit A

- [ ] Last commit on main is `50829fe`
- [ ] Tests at 97/97 green
- [ ] `docs/melody.md` exists with full F1/F2/F3 design
- [ ] `CLAUDE.md` "Design-discussion discipline" note present
- [ ] Fingerprint baseline: count 113, first 6 events known
