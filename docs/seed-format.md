# Seed format & PRNG derivation

> The contract behind "same seed → same soundscape." Everything random in
> the engine — every noise channel, every Markov decision, every ornament
> timer — pulls from a deterministic stream derived from one root seed.

---

## 1. Surface form

**Root seed: 64-bit unsigned integer.** Minecraft-style.

- **In code:** `bigint` (`123456789n`). 64 bits is plenty of entropy and
  avoids JavaScript's 32-bit bitwise quirks.
- **In the UI:** displayed and accepted as either decimal or a short
  base36 string for shareability (`"k3d8j2f4a1"`). Same value either way.
- **Default:** when no seed is supplied, generate one from
  `crypto.getRandomValues` and show it to the user so they can save / share
  the one they liked.

Single integer in, deterministic 2-hour session out.

---

## 2. Stream PRNG: PCG32

[**PCG32**](https://www.pcg-random.org/) — 64-bit internal state, 32-bit
output, ~50 lines of code, well-studied statistics, no dependencies.

- **Why not `Math.random()`:** not seedable; implementation-defined; not
  reproducible across browsers.
- **Why not xorshift / xoshiro:** PCG has better statistical properties at
  similar speed, and the implementation is canonical.
- **Why not crypto PRNGs:** overkill for non-adversarial use; slower; and
  no seed-based reproducibility.

Output API:
```ts
class Rng {
  next(): number;                // uint32
  nextFloat(): number;           // [0, 1)
  nextRange(a: number, b: number): number;
  pick<T>(xs: readonly T[]): T;
  bernoulli(p: number): boolean;
  // ...
}
```

---

## 3. Sub-seed derivation: splitmix64

The root seed never gets used directly. Every subsystem asks for its own
named child seed:

```ts
const root  = Seed.from(123456789n);
const melodyDensityRng  = root.child("melody/density-fbm").rng();
const chordMarkovRng    = root.child("harmony/markov").rng();
const ornamentGlobalRng = root.child("ornaments/global-rate").rng();
const lorenzRng         = root.child("attractors/lorenz-init").rng();
// ... one per consumer, dozens total
```

Internally, `.child(label)` returns a new `Seed` whose value is
`splitmix64(root, hash64(label))`. Splitmix64 is the standard hash for this
purpose — used by Java's `SplittableRandom`, fast, well-mixed.

**Why named children matter:**

1. **Two consumers never share a stream.** Without this, drawing one extra
   random number in subsystem A shifts everything subsystem B sees from
   then on — a brittle coupling that breaks tests.
2. **Adding new subsystems doesn't perturb old ones.** Same root seed
   yields the same melody whether or not the engine now also has an
   ornament module, because melody pulls from `"melody/..."` and
   ornaments pull from `"ornaments/..."`.
3. **Labels are stable contracts.** Rename a label and you've changed the
   output for every saved seed. So label strings get versioned only
   intentionally.

---

## 4. Determinism scope

**What is guaranteed:** same seed → same event sequence emitted by
`@loam/core` on any browser, any platform. Integer math throughout; no
floats in the PRNG path; no reliance on `Math.random`, `Date.now`, or
anything time-dependent inside the deterministic core.

**What is *not* guaranteed:** byte-exact audio output across machines.
Floating-point rounding in the Web Audio synthesis layer differs slightly
between browsers and architectures. The *notes and parameter trajectories*
are identical; the rendered samples may differ at the LSB. This is fine —
shareability is about the soundscape's character, not bit-exact WAV files.

If we ever want byte-exact rendering (e.g. for offline server-side WAV
export), it gets done in Python via an offline render, not in the browser.

---

## 5. Persistence

Engine state that needs to survive pause/resume (and that the validation
harness needs to snapshot):

- Root seed (immutable for the session)
- Engine-time elapsed (so all derived clocks resume correctly)
- Current state of each long-lived PRNG (PCG32 state is two 64-bit ints —
  trivial to serialize)
- Current state of each Markov chain (one integer — current node)
- Current attractor coordinates (3 floats per attractor)
- fBm phase per channel (one float per channel)
- Ornament last-fire timestamps (global + per-type, in engine-time)

Total persistent state is small (low kilobytes); serialize to JSON for
save/restore.

---

## 6. Implementation note

`Seed`, `Rng`, splitmix64, and PCG32 are the first code written in
`@loam/core`. They go in by themselves with a `vitest` test that pins a
known seed to a known sequence of outputs. That test is the seed-
determinism contract for the entire project — if it ever breaks, every
saved seed is invalidated.

---

## 7. Design assumptions baked in

### 7.1 PCG32 is a one-way door once seeds are published

The hard-coded determinism test in `packages/core/test/determinism.test.ts`
pins splitmix64 + PCG32 forever. Anyone we share a seed with — in the
hosted demo, in the architecture writeup, in a tweet — gets bound to *this*
PRNG algorithm.

**Implication:** swapping to a higher-precision PRNG later (PCG64,
xoshiro256**, etc.) is a breaking change that invalidates every saved seed.
PCG32 is the right call for v1 (excellent statistics, fast, tiny, plenty of
period for any musical use), but the choice doesn't have take-backs without
a v2 seed format. Treat the moment we publish the first shareable seed as a
soft commitment to this PRNG.

### 7.2 Label hashing uses UTF-16 code units, not UTF-8 bytes

`hash64String` (FNV-1a) iterates over `s.charCodeAt(i)` rather than
encoding to UTF-8 first. Avoids pulling `TextEncoder` (and the lib types
that come with it) into `@loam/core`. Stable across platforms because JS
strings are always UTF-16.

**Implication:** all current seed labels are dev-controlled ASCII
identifiers (`"melody/density-fbm"`, `"ornaments/global-rate"`, etc.),
where UTF-16 code units == ASCII bytes. **If the "note title → seed"
growth-space idea is ever implemented**, the title-derived seeds must hash
the same way (code units, not UTF-8 bytes), or seeds derived from non-
ASCII titles will differ between hashing schemes. Stick with this hash
function for any seed-derivation path.

### 7.3a Multi-layered determinism contracts (Stage 5+)

As Phase 2 adds layers on top of the PRNG (value noise, fBm, Markov,
soon-to-be attractors / L-systems), each layer gets its *own* locked-
sequence test. Current set:

- `ValueNoise1D.sample(x)` (Stage 5) — known floats for `Seed.from(42n)`
  at fixed positions; locks the splitmix-on-demand gradient + Hermite
  smoothstep formula.
- `Fbm1D.sample(x)` (Stage 5) — known floats summing 4 octaves with
  persistence 0.5 / lacunarity 2; locks the octave-stacking math.
- `MarkovChordWalk.next()` (Stage 6) — known 16-chord walk from `Am7`
  with `Seed.from(42n).child('harmony/markov')`; locks `HAND_MATRIX`
  weights and the walk's CDF-roll formula.
- `perturbMatrix` (Stage 6) — known floats for the `Am7` row of the
  α=20 perturbation under `Seed.from(42n).child('harmony/markov-config')`;
  locks the Marsaglia–Tsang gamma sampler, Box–Muller normal, and
  Dirichlet normalization.
- `PositionStream.evaluate(t)` (Stage 7a) — known `(x, y)` floats at
  `t = 0, 60, 120` under `Seed.from(42n).child('position')`; locks the
  two-independent-fBm composition that drives all position-derived
  biases (voicing register drift, future mode/key drift).

**Implication:** each layer's contract pins that layer specifically.
A failing PRNG contract means the PRNG changed; a failing fBm contract
with passing PRNG and ValueNoise contracts means the fBm summation
changed; etc. Diagnosing regressions is fast. Every layer-locked test
is also a v2-seed-format breaker if intentionally changed — they're
the project's compatibility contract surface.

### 7.3 Derived methods aren't separately contract-locked

The determinism test pins the `uint32` sequence emitted by `Rng.next()`.
Derived methods (`nextFloat`, `nextInt`, `pick`, `bernoulli`) are
*implementations on top of* `next()` — if their internal formulas change,
the same seed produces different musical decisions even though the locked
`uint32` sequence is unchanged.

**Implication:** treat the wrapper formulas in `rng.ts` as part of the
contract too, even though only `next()` is hard-pinned. If anyone refactors
`nextFloat` (e.g. to use 53-bit float precision instead of 32-bit), every
in-use seed shifts. Probably worth adding a second locked-sequence test for
`nextFloat` and `nextInt` when ornaments start consuming them seriously.
