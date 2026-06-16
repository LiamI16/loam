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
