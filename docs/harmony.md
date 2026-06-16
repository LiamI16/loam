# Harmony — implementation notes

> Companion to `docs/lofi-study.md` (the *survey* — chord qualities,
> progression catalog, voicing rules). This doc is the *implementation* —
> what's actually built in `@loam/core` for chord choice and voicing.
>
> Stage 6 lays it down: Markov walk + Dirichlet perturbation + greedy
> voice-leading. Stages 7+ will layer attractor biasing, melody chord-
> awareness, key/mode knobs.

---

## 1. Vocabulary

`packages/core/src/engines/ember/harmony/chords.ts`.

15 chords diatonic to C major / A minor plus two borrowed colors. Each
chord is `{ rootPc: 0–11, intervals: number[], quality: string }` — the
voicing solver builds the actual MIDI pitches.

| Function | Chords |
|---|---|
| **I** | `Cmaj7`, `Cmaj9`, `Cmaj7s11` |
| **ii** | `Dm7`, `Dm9` |
| **iii** | `Em7` |
| **IV** | `Fmaj7`, `Fmaj9` |
| **V** | `G7`, `G9` |
| **vi** | `Am7`, `Am9`, `Am11` |
| **iv (borrowed)** | `Fm6` |
| **♭VII (borrowed)** | `Bbmaj7` |

Pitch-class + intervals (rather than absolute MIDI lists) so future
key/mode transposition doesn't require rewriting the vocabulary. Stage
6 keeps voicings ≤ 5 tones — Stage-9 extensions (drop voicings, spread,
etc.) will not require changing the vocabulary representation.

## 2. Markov walk

`harmony/markov.ts`.

A single hand-tuned `HAND_MATRIX: TransitionMatrix` lives in source.
Sparse — each row lists 3–8 outgoing edges with relative weights.
Biased per `docs/lofi-study.md` §3:

- Strong i↔IV / I↔IV modal vamps.
- ii→V→I cells common but soft (V→I is not so dominant that it pulls
  the loop into a cadential feel).
- vi→IV→I a workhorse.
- Borrowed colors (`Fm6`, `Bbmaj7`, `Cmaj7s11`) reachable but uncommon,
  with strong return weights to the diatonic core.
- Tonic majors are over-represented as destinations.

`MarkovChordWalk` is stateful — one walk per `EmberEngine` instance,
driven by `seed.child('chords').child('markov-walk').rng()`. Starts on
`Am7` by default (lofi home tonic).

Edge case: if a row has been Dirichlet-perturbed to all-zero weights
(astronomically unlikely with α=20 but mathematically possible), the
walk falls back to a uniform pick over the vocabulary.

## 3. Dirichlet perturbation

`harmony/dirichlet.ts`. Deterministic per-seed perturbation of
`HAND_MATRIX` at engine construction.

For each row `(p_1, …, p_K)` of the (normalized) prior, draw the
perturbed row from `Dir(α · p_1, …, α · p_K)`:

- **α high** (50–100): rows barely move; seeds feel harmonically similar.
- **α low** (1–5): rows scatter; seeds feel like different pieces.
- **Stage-6 default α = 20** — chosen as a subtle-but-audible middle
  ground mirroring the Stage-5 liveliness ranges. Tune by listening
  test, not first principles.

**Implementation** (all from passed `Rng`, no `Math.random`):

- Gamma(α, 1) for α ≥ 1: Marsaglia & Tsang (2000) rejection sampler
  with transformed-normal proposal.
- Gamma(α, 1) for α < 1: Stuart's reduction `Gamma(α) = Gamma(α+1) ·
  U^(1/α)`.
- Standard normals: Box–Muller.

Verified by `harmony-dirichlet.test.ts` — same seed → byte-identical
perturbed row at α=20.

## 4. Voice-leading solver

`harmony/voicing.ts`. Pure function.

```ts
voiceChord(prev: number[] | null, chord: ChordSymbol, opts?): number[]
```

Algorithm (per `docs/lofi-study.md` §4 priorities):

1. **Common-tone retention** is automatic — if a previous pitch's pc
   is in the new chord, its closest-pitch search distance is 0.
2. **Greedy nearest-pitch:** each previous voice picks the in-register
   chord tone closest in semitones, searching across all octaves.
3. **Seed voicing** (no `prev`): place the first N intervals at
   octaves nearest `register.low + 7`, then sort.

Output: MIDI pitches, sorted ascending, voice count matches `prev`.
Default register E3–E5 (52–76), a Rhodes-ish mid.

Approximations vs an exact L1-optimal assignment:
- Voices are assigned independently, so two prev voices can collapse
  to the same pc (octave doubling). Musically a wash for 4-voice
  chords; revisit if Stage 7+ wants strict 4-distinct-pc voicings.
- Top-voice continuity is emergent, not enforced.
- Drop-2/drop-3 spread voicings, chromatic approach tones, and
  rootless-from-bass rules are **not** implemented in Stage 6.

## 5. Engine wiring

`EngineState` gained `currentChord: ChordSymbol | null` (Stage 6).
`ChordScheduler` writes it on every emission. `MelodyScheduler` reads
it for its filter (§6).

Two seed children consumed by `ChordScheduler`:

- `chords.child('markov-config')` — Dirichlet perturbation. One draw
  at engine construction.
- `chords.child('markov-walk')` — per-step walk decisions.

A new chord (and rerolled engine) doesn't perturb the rest of the
engine state — `density-fbm`, `evofilter-fbm`, drums, crackle, melody
all pull from their own `seed.child(...)` siblings.

## 6. Melody filter (WIP — Stage 9 revisit)

`MelodyScheduler` filters its A-minor pentatonic bag against
`state.currentChord`: drops any pentatonic pitch class that is a
half-step above or below any chord tone (the worst clashes the wider
Stage-6 harmony introduces — e.g. natural E pentatonic over `Fm6`
containing E♭).

If the filter empties, falls back to a chord tone projected into the
pentatonic's register (A4–C6).

**This is a guardrail, not a real chord-aware melody.** Stage 9's
L-system melody will subsume it with a proper pitch-selection model
that knows scale + chord + phrase contour. Documented here so the
half-fix is intentional, not forgotten.

## 7. Multi-layered determinism contracts (additions)

Per `docs/seed-format.md` §7.3a, each layer gets its own locked-
sequence test. Stage 6 adds three:

- `MarkovChordWalk.next()` — 16 known chord names from `Seed.from(42n)`
  starting at `Am7`.
- `perturbMatrix` — known floats (6-decimal) for the `Am7` row of the
  α=20 perturbation under `Seed.from(42n).child('harmony/markov-config')`.
- `voiceChord` — common-tone-retention and greedy-octave cases lock
  the assignment algorithm.

Engine fingerprint (`ember-engine.test.ts`) also updated: total event
count unchanged (63 in 5 s), but the first 6 events now reflect the
Markov starting chord (`Am7`) voiced at C–E–G–A instead of the old
`Fmaj7` static pick. Treat any future change to these contracts as a
v2 seed-format break.

## 8. What's intentionally NOT in Stage 6

- **Key/mode knobs.** Still C major / A minor only. Modal/key
  selection is a future stage; the pc + intervals representation
  doesn't block it.
- **Bass scheduler.** Pad still does root + 5 in the bass register
  (computed from `chord.rootPc + 36`); no walking bass, no
  groove-aware bassline.
- **Real chord-aware melody.** §6 is a guardrail. Stage 9.
- **Voicing variation.** No drop-2/drop-3, no chromatic approach
  tones, no per-bar re-voicing of a held chord.
- **Lorenz-biased matrix.** The Dirichlet perturbation is constant for
  the session. Stage 7 lets a Lorenz attractor reweight transition
  probabilities in slow motion.
- **Python corpus mining.** The hand-tuned matrix is the single source
  of truth. Mining TheoryTab or similar is deferred until vocabulary
  grows beyond what's hand-tunable (Stage 7+).
