# Arrangement controller — design (ACTIVE)

> **Model: A2 event/dropout (settled 2026-07-11, implemented + ear-validated
> 2026-07-12).**
> Replaces the occupancy-Markov walk, which failed listen-check with
> *unbounded* per-instrument absence (melody up to 22 min; bed instruments a
> median 71 min): in an occupancy model absence-duration = dwell-duration, and
> the 1/f energy contour has unbounded low-excursions, so *any* occupancy model
> parks in sparse states arbitrarily long. Research (`docs/arrangement-research.md`)
> resolved the direction; the specifics below were settled in a design pass
> (decisions A2.A–A2.F) and validated offline
> (`packages/core/scripts/arrangement-validate.ts`, which now measures
> **contiguous sojourn**, the metric the original occupancy validation missed).
> The superseded occupancy design is preserved as a decision-record at the
> bottom.

The launch-critical "breathing" feature. Without it the engine plays every
instrument continuously and nothing drops out — the biggest "tech-demo vs.
music" tell. Real lofi *breathes*: 8 bars of pad + melody (drums out), then
drums + bass alone, then everything but kick. The coming-and-going *is* the
variation. Follows the documentation-procedure lifecycle; collapses to a
decision-record at close-out.

## Grounding (current wiring)

- `EmberEngine.scheduleUntil(until)` (`ember.ts`) is the **composition point**:
  it runs `ArrangementController.advance` *first* (pre-scheduler), then each
  sub-scheduler, concatenates, and applies a **composition-point mask filter** —
  note events whose `channel` maps to an arrangement-muted role are dropped
  (`channelRole`: `RHODES_CHORD→chords, RHODES_MELODY→melody, BASS→bass,
  KICK/SNARE/HAT→drums`; PAD / crackle / ticks / params always pass).
- `EngineState.arrangementMaskAt(time)` is the controller's query; schedulers
  read it per emission. `EngineState.phraseBar` is the bar within the 8-bar
  phrase. Both written by the controller.
- Only **melody** is otherwise mask-aware (space-fill + fresh-germ re-entry,
  below); bass / chords / drums schedulers are untouched.

## Constraints (not up for debate)

- **Seed-identity hybrid stack** (`docs/seed-identity.md`): arrangement is
  per-seed via universal-rule + fBm drift + per-seed shape + couplings, never
  fixed archetypes or a raw per-seed knob.
- **Changes land only on 8-bar phrase boundaries** — never mid-phrase.
- **Bounded contiguous absence per role** — the hard requirement the occupancy
  model violated. Enforced *by construction* (A2.B).
- **Fingerprint preserved** — open-at-`FULL` phrase 0 + named seed children ⇒
  the 5 s `Seed.from(42n)` window is byte-identical; arrangement is a
  non-breaking additive change (no §7.3a entry).

---

## The A2 model

**Per-role event/dropout, evaluated at 8-bar boundaries.** Baseline is
everything-on; roles drop out and return. At each boundary the controller makes
**exactly one move** — hold, drop one role, or restore one role — driven by a
Cox servo, bounded by hard per-role deadlines, filtered by the palette.

### A2.A — one move per boundary (Cox servo + deadline)

Each boundary picks one state from the current one:

1. **Hard deadline (the bound).** Any absent role whose contiguous absence has
   reached its per-seed cap `capPhrases[role]` *must* return this boundary. All
   simultaneously-due roles are restored at once by jumping to the
   lowest-fullness legal palette state that is a **superset** of
   `present(current) ∪ due` (FULL is always a superset, so one exists). This is
   the sanctioned exception to ≤1-change/boundary — a rare group re-entry — and
   it makes each role's contiguous absence **exactly ≤ `capPhrases[role]` by
   construction**: batching sidesteps the competing-deadline starvation that a
   one-role-at-a-time return suffers (a large-cap role gets its restore slot
   stolen by smaller-cap roles and overruns — observed +1 phrase before this
   fix).
2. **Cox servo.** Otherwise, weight `{hold} ∪ {legal single-role neighbours}` by
   a Boltzmann tilt toward the energy contour's **target fullness**, times a
   per-seed favoured-to-drop factor, minus hysteresis-excluded drops; sample one.
   *Hold* is the current state under the same tilt × a per-seed persistence
   factor, so the walk *tracks* the target rather than parking where it started.

The contour (Cox modulator) sets *how full / how often*; it **never** touches a
duration. Serialization (≤1 discretionary change) and the absence cap are both
structural, not emergent.

### A2.B — per-role absence caps

Hard ceilings `K_MAX` (phrases; 1 phrase ≈ 25.9 s @74 BPM), ordered by musical
tolerance. Per-seed `capPhrases[role]` is drawn in `[1, K_MAX]` (`arrangement-caps`)
— the ceiling is the universal bound the gate asserts, the draw gives per-seed
depth. Absence = cap phrases exactly at worst.

| role | K_MAX | worst-case | rationale |
|---|---|---|---|
| bass | 2 | 52 s | never actually absent in the palette (present in all 6 states); kept for generality |
| chords | 2 | 52 s | most perceptually costly after bass; pad holds harmony underneath |
| melody | 3 | 78 s | signature layer; keep near the old ~110 s intent but tighter |
| drums | 4 | 104 s | most droppable — "drums-out" is the canonical lofi move |

### A2.C — palette (legal-combo filter)

The **6-state** curated palette (pad implicit-always; bits = bass, chords,
melody, drums):

| state | bits | fullness |
|---|---|---|
| `FULL` | 1111 | 1.00 |
| `no-melody` | 1101 | 0.75 |
| `drums-out` | 1110 | 0.75 |
| `pocket` (bass+drums) | 1001 | 0.50 |
| `warm` (bass+chords) | 1100 | 0.50 |
| `bass-breather` (bass only) | 1000 | 0.25 |

Single-role adjacency is the legal-combo filter (dropping bass or chords from
`FULL` would leave an illegal combo, so it isn't an edge). Verified connected.
**Pruned from the original 8-state palette:** `lead-breather` (melody only) and
`deep-breather` (pad only) — the two bass-absent near-silence states. They are
the only states that break the airtight bound (bass-absence reachable only via
multi-role detours) *and* v1 defers deliberate deep near-silence (A2.F). With
them gone bass is always present and every role is ≤2 moves from presence.

### A2.D — energy contour (Cox servo)

One universal `Fbm1D` (`arrangement-energy-fbm`), slowest octave ~5.5 min
(`ENERGY_BASE_FREQ = 1/330`). Per-seed identity here is only the *phase*
(`arrangement-energy-config`) — the contour is timing, not per-seed amount.
Maps to target fullness `f_target = clamp₀₁(0.70 + 0.28·noise)` (center 0.70,
trough ~0.42, peak FULL). Boltzmann servo strength `SERVO_K = 5`.

### A2.E — pacing (change frequency + hysteresis)

- **Per-seed restlessness** = a persistence (hold) weight drawn in `[4, 22]`
  (`arrangement-frequency`); bigger ⇒ longer dwell. Realized mean time-between-
  changes ≈ 49 s (restless) … 101 s (stable), median ~72 s.
- **Hysteresis** = a just-restored role can't drop again for 2 phrases
  (`HYSTERESIS_PHRASES`) — anti-chatter. The deadline handles the other side.

### A2.F — per-seed identity + deferred deep-breather

- **Favoured-to-drop** = the `arrangement-presence-bias` vector reused verbatim
  from the old model (same draw ⇒ that child's stream unchanged). Higher bias ⇒
  role dropped less / restored sooner (`favour = isDrop ? 1/b : b`). Melody keeps
  the signature-protect floor (≈0.83). M=1.6.
- **No scheduled deep multi-drop in v1.** The sparse states stay reachable but
  are rare/brief by construction (tight caps + center-0.70 servo pull the walk
  back before it bottoms out). A deliberately-scheduled "deep breather" moment
  is backlog.

### Melody couplings (carried forward, unchanged)

Both read `arrangementMask`; orthogonal to the model swap:
- **Space-fill** — melody present + texture thinned (mask < FULL) ⇒ activity
  target × `SPACE_FILL` (1.2). Subtle bias on the existing F1 coupling.
- **Fresh germ on re-entry** — melody re-enters with a fresh germ phrase on the
  downbeat, not mid-fragment (also moots germ-development-while-muted).

## Seed children (named — fingerprint-safe)

`arrangement-presence-bias`, `arrangement-caps` (new), `arrangement-frequency`,
`arrangement-energy-fbm`, `arrangement-energy-config`, `arrangement-walk`. Named
⇒ existing schedulers' RNG untouched; open-at-`FULL` ⇒ no masking in the
fingerprint window.

## Validation (offline, 2000 seeds × 1400 phrases, 2026-07-12)

`scripts/arrangement-validate.ts` drives the *real* controller (no
reimplementation) and measures **contiguous sojourn** (not just occupancy).

- **Contiguous absence (the hard bound):** bass 0 s, chords 52 s, melody 78 s,
  drums 104 s — **exactly `K_MAX`, 0/2000 seeds starved.** Airtight.
- **Change frequency:** p05 49 s / median 72 s / p95 101 s — in the ~45–150 s
  target band.
- **Cross-seed distinctness:** presence fraction bass 1.00, chords ~1.00 (both
  foundational, near-invariant), melody [0.71, 0.93], drums [0.63, 0.92]; mean
  pairwise L1 0.186. Clear per-seed melody/drums personality.
- **Fullness:** time-at-`FULL` mean 0.63 (breathes ~37 % of the time); per-seed
  sparsest reached median 0.50 (2-role breather), p05 0.25 (`bass-breather`,
  bounded ≤52 s). Deliberately on the subtle/safe side.

**Ear-validated 2026-07-12** (seed 7, the restless/most-breathing seed):
breathing reads as musical, re-entries and cuts are clean, no popping; the
~37 %-below-`FULL` ratio judged good (not too sparse). The center/hold dials are
the easy lever if a future pass wants more air.

## Acceptance

- Fingerprint unchanged (`ember-engine.test.ts` — open-at-`FULL` no-op).
- Contiguous absence bounded for **all** roles (`arrangement-absence.test.ts`).
- Only `ember.ts`, `arrangement-controller.ts`, `melody-scheduler.ts`,
  `EngineState`, and seed-children touched — bass/chords/drums schedulers
  unedited.
- Ear: motivated, non-popping, subtle space-fill, distinct per-seed breathing.

---

# Decision-record — superseded occupancy-Markov design (2026-07-09)

Kept for context; **do not implement.** The occupancy model walked a Markov
matrix over an 8-state palette with the stationary set by a per-seed
presence-biased π (Metropolis-Hastings, no Dirichlet drift), tilted by the
energy contour, with per-seed laziness λ for dwell. It was fully built and
offline-validated on *occupancy* metrics (which looked healthy: median ~2.1 min
between changes, meaningful cross-seed distinctness, zero stationary drift) but
failed listen-check because **occupancy validation never measured contiguous
sojourn** — and in an occupancy model absence spans a *run* of sparse states, so
a 1/f trough pinned instruments silent for tens of minutes. An interim
melody-only refractory patched the worst case but couldn't generalize. Root
cause and the pivot to A2 are in `docs/arrangement-research.md` §5. Carried
forward into A2: the curated palette (as a filter, 6 of the 8 states), the
per-seed presence-bias draw, open-at-`FULL` fingerprint preservation, the
energy-contour fBm, and the mask-filter mechanism.

Prior decision log (occupancy era): A→A2 mask-aware schedulers; B flat 8-bar
grid; C1 discrete-state Markov (superseded by A2's event model); C.2 pad-only
floor + 8-state palette (→ 6-state in A2.C); C.3 universal breathing +
energy-contour timing + FULL ceiling; D flagship space-fill (carried forward);
E natural cuts + melody fresh re-entry (carried forward); F open-at-FULL
fingerprint-preserving (carried forward).
