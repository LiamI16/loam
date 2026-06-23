# Ember scheduler utilities

`packages/core/src/engines/ember/util.ts` — small, pure numeric helpers
shared by the ember sub-schedulers (bass, chord, drum, melody) and the
harmony layer (modes, voicing). Extracted in the Tier 2 dedup pass so
these behavior-defining primitives have **one definition** instead of
being re-derived per file.

## Why this file exists

Three helpers had drifted into multiple copies across the schedulers:

- `clamp01` was defined verbatim in `bass-`, `chord-`, and
  `drum-scheduler.ts`.
- The positive-modulo-12 idiom `((x % 12) + 12) % 12` appeared 9 times
  across 5 files.
- The "nearest pitch with a given pitch class, within a register" loop
  was copy-pasted in `bass-scheduler`, `chord-scheduler`, and
  `harmony/voicing`.

Duplicated *computation* (unlike a shared string key on the
engine↔adapter event bus) can drift silently — one copy gets a fix the
others don't. Centralizing removes that risk. These are deliberately
left as free functions, not a class: no state, no seed, pure inputs →
outputs.

## Contents

### `mod12(n): number`

Positive modulo 12, always in `[0, 12)`. Unlike the bare `%` operator
(which keeps the sign of the dividend in JS), this is correct for
negative inputs. Two semantic uses, same math:

- **Pitch class** of a MIDI note — `mod12(midi)`.
- **Interval class** of a semitone difference — `mod12(a - b)`.

### `clamp01(v): number`

Clamp to `[0, 1]`. Used for note velocities / normalized amplitudes
before they go out as events.

### `nearestPitchClassInRange(pc, target, low, high): number`

The MIDI pitch in `[low, high]` whose pitch class is `pc`, nearest to
`target`. Returns `-1` if no pitch in the range has that class. Callers
pass their own register, which keeps distinct registers explicit at the
call site rather than hidden behind same-named constants — e.g. the
bass *line* register (`BASS_LOW`/`BASS_HIGH`, 36–48) vs. the pad *root*
register (`PAD_ROOT_LOW`/`PAD_ROOT_HIGH`, 36–50) are deliberately
different and now read as such.

## Constraints

These functions sit under the **engine fingerprint** (pinned at
`Seed.from(42n)`, `bpm: 74` in `packages/core/test/ember-engine.test.ts`).
Any change to their behavior shifts the fingerprint and is therefore a
deliberate seed-format break — document it in the commit message and
`docs/seed-format.md` §7.3a. The extraction that created this file was
verified behavior-preserving by the fingerprint test passing unchanged.
