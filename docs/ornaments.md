# Ornaments — rate, refractory, and distribution

> **Status:** Stage 8 partially shipped. The rate/refractory framing
> (§1–2) drives vinyl crackle in `packages/synth-tone` today; the
> bell-tone ornament and other ornament types described in §3+ are
> design notes, not yet implemented. The point-process math is the
> load-bearing part — treat the specific ornament catalog as deferred.

> A revision of the strict "never produce a salient moment" rule
> (see `README.md`'s cardinal-rule framing and `dynamics-brainstorm.md`).
> Pure featurelessness tips past
> *unobtrusive* into *soporific* — losing the listener as surely as a hook
> would. The fix is a thin layer of subtle ornaments, statistically governed
> so they never form a pattern, never cluster, and never deplete.

---

## 1. Why "salience budget" is the wrong frame

The initial instinct was a "salience budget" — N ornaments per session,
spent down. That model breaks immediately for our use case:

- **The engine is indefinite.** A budget implies a denominator. There isn't
  one — sessions can be 20 minutes or 8 hours; the engine shouldn't know.
- **Budgets imply scarcity, which implies depletion or refill semantics**,
  neither of which is musical. We don't want ornaments to vanish in hour 2
  and we don't want them to surge after a "refill."
- **It pushes the listener to count.** A budget produces non-stationary
  behavior (front-loaded or back-loaded); a stationary statistical process
  doesn't.

The correct frame is a **rate**, not a budget. The engine is a *continuous-
time point process* generating ornaments — characterized by an inter-arrival
distribution, an instantaneous rate, and optional refractory and modulation
structure. Statistics are stationary in expectation; any window of an hour
looks like any other window of an hour. That's exactly the property we want.

Candidate framings, in roughly ascending sophistication:

| Frame | What it specifies | When it's enough |
|---|---|---|
| **Threshold** | Probability per discrete unit (per bar / per beat) | Bernoulli baseline; easy and good |
| **Rate** (λ) | Expected events per unit time | Stationary Poisson process; cleaner mental model |
| **Inter-arrival distribution** | Distribution over time-to-next-event | Lets us shape clustering vs spacing |
| **Refractory period** | Hard minimum gap between events | Vetoes runs; usually needed |
| **Modulated rate** | λ(t) varies over time | Couples ornament rate to mood / time-of-day / macro state |
| **Self-interacting process** (Hawkes, anti-Hawkes) | Past events bias future rate | Probably overkill but interesting |

The right answer for v1 is likely **refractory-renewal with modulated rate** —
detailed below.

---

## 2. The candidate point processes

### 2.1 Bernoulli per bar (geometric inter-arrival)

The simplest: each bar, flip a coin with probability `p`. Inter-arrival
times are geometrically distributed.

- **Mean spacing:** `1/p` bars.
- **Variance:** high. Without a refractory floor, you'll occasionally get
  two ornaments back-to-back, which is exactly the salience cluster we don't
  want.
- **Pros:** trivially implementable in the existing per-bar scheduling loop.
- **Cons:** clustering, and the per-bar grid means you can't get spacings
  finer than 1 bar.

### 2.2 Poisson process (exponential inter-arrival)

Continuous-time analog. Sample the next inter-arrival time from
`Exp(λ)` — i.e., `−ln(U)/λ` for `U ~ Uniform(0,1)`. At each event, schedule
the next one.

- **Mean spacing:** `1/λ` seconds.
- **Memoryless** — same clustering problem as Bernoulli, in continuous time.
  The probability density of inter-arrival times is highest at *zero*, which
  is the opposite of what we want.
- **Pros:** clean math, easy long-run statistics, well-understood.
- **Cons:** unmodified Poisson is wrong on its own; the high density at small
  gaps is a feature for queueing theory and a bug here.

### 2.3 Refractory renewal process

The fix. Inter-arrival time = `R + Exp(λ)` where `R` is a hard refractory
floor. Sometimes called a **dead-time-modified Poisson process** or, with a
gradual recovery curve instead of a hard floor, a **gamma renewal process**.

- **Mean spacing:** `R + 1/λ`.
- **Inter-arrival density is zero below R**, then exponential.
- **Pros:** kills clustering by construction. Two knobs (`R`, `λ`) cover the
  whole behavior cleanly.
- **Cons:** none material.

This is my default recommendation for v1.

### 2.4 Soft refractory / recovery curve

Like §2.3 but with a smooth recovery instead of a step. The instantaneous
rate after an event is suppressed and recovers (e.g., `λ(t) = λ_∞·(1 −
e^{−t/τ})`).

- **Pros:** no hard discontinuity; smoother long-run statistics; ornaments
  *can* land closer than the refractory floor but it's rare.
- **Cons:** one more parameter. Probably overkill unless the hard floor
  becomes audible as a too-regular minimum spacing.

### 2.5 Gamma / Erlang renewal

Inter-arrivals drawn from `Gamma(k, θ)` directly. `k=1` is Poisson; `k>1`
gives unimodal inter-arrival distributions — more regular, less clustered.

- **Pros:** a single distribution that interpolates from random (k=1) to
  near-periodic (k→∞). The shape parameter is musically meaningful — it
  controls how *regular* the ornament spacing feels.
- **Cons:** harder to add an *additional* refractory floor cleanly (though
  not difficult).

### 2.6 Hawkes process — *probably an anti-pattern here*

Self-exciting: each event temporarily raises the rate. Used for earthquake
aftershocks, social-media cascades, neuronal bursting. The defining property
is **clustering** — events beget events.

- For ornaments, we want the *opposite* of clustering, so plain Hawkes is
  wrong. But the **inverse** ("anti-Hawkes" / inhibitory point process) is
  exactly the refractory model in §2.3–§2.4. Mention here mainly to set the
  vocabulary correctly.

### 2.7 Cox process (doubly stochastic Poisson)

A Poisson process whose rate `λ(t)` is itself a random process — e.g.,
driven by an fBm/pink-noise envelope or an attractor coordinate.

- **Pros:** lets the ornament rate **breathe** over the session without ever
  becoming periodic. Quiet stretches and slightly busier stretches arise
  organically. Couples cleanly to the macro mood/attractor architecture from
  `dynamics-brainstorm.md` — the attractor is already there; route one of
  its coordinates to `λ(t)`.
- **Cons:** more moving parts; needs care that `λ(t)` is always positive and
  bounded.

### 2.8 The recommended stack

Combine: a **Cox process with refractory floor**.
- A slow pink-noise / attractor signal produces a positive, bounded `λ(t)`.
- Inter-arrival times sample from `R + Exp(λ(t))`, refreshed after each event.
- Stationary-in-expectation but locally varying; never clusters; never feels
  metronomic.

This is two parameters the seed actually picks (`R`, baseline rate) plus the
modulation depth, and it covers the full design intent.

---

## 3. What an ornament *is*

Distinct from the question of *when*. An ornament is one event drawn from a
small set of allowed gesture types, each small enough to slip past focused
attention but distinct enough to register if you happen to be listening.

Candidate ornament types:

- **Held extension** — one chord voicing held an extra beat with the 9th or
  ♯11 on top.
- **Single bell tone** — a high, soft pentatonic note, decaying into the
  reverb, sitting above the texture.
- **Brief modal-mixture chord** — one bar of borrowed iv or ♭VImaj7.
- **Voicing bloom** — an extra inner voice fades in for two bars and out.
- **Pad swell** — pad layer crescendos by 3 dB over 8 bars, then recedes.
- **Texture shift** — vinyl-bed briefly thickens, or rain crossfades a notch.
- **Bass slide** — one slid bass note (octave glide up to the next root).
- **Drum drop-and-return** — one bar of just hat, drums return next bar.

Each is a *single, soft, brief* gesture — *not* a melodic phrase, *not* a
fill, *not* something with a contour the listener could hum back.

### Per-type inhibitory rate (no bag, no cycles)

Naïve approaches to "don't repeat the same ornament" — drawing without
replacement, or rejecting if it matches the last K — all introduce
artificial periodicity. A bag that empties and refills *is* a cycle, even
with cooldown; last-K rejection biases the sampler toward "anything except
the last one" in a structural way.

The clean answer is to apply the **same statistical machinery used for the
global ornament rate** (§2) one level down — per type. Each ornament type
`i` carries its own instantaneous selection rate that collapses after the
type fires and recovers smoothly over time:

```
λ_i(t) = λ_i^∞ · (1 − exp(−(t − t_i^{last}) / τ_i))
```

- `λ_i^∞` — that type's baseline weight (its share of the bag when fully
  recovered). Set per ornament type; the seed picks the distribution.
- `τ_i` — type-specific recovery time constant. Larger τ = the type stays
  unlikely for longer.
- `t_i^{last}` — wall-clock (playback-clock) time the type last fired.

When the global Cox+refractory process from §2.8 fires an ornament event,
the **type** is sampled in proportion to current `λ_i(t)`. Just after type
`j` fires, `λ_j` is ~0 (effectively excluded), then recovers smoothly. No
type is ever *banned*; just very unlikely for a while.

Properties this gives us:

- **No cycles.** There's no bag to empty, no refill event, no horizon.
- **Stationary in expectation.** Long-run frequency of each type tends to
  its `λ_i^∞`-weighted share.
- **Architectural symmetry.** The global ornament process gates *when*; the
  per-type inhibitory rate gates *what*. Same mathematical shape at both
  scales — pleasing, and easier to reason about and validate.
- **Couples cleanly to macro state.** A slow attractor coordinate or
  pink-noise signal can modulate `λ_i^∞` per type, so the *flavor* of
  ornaments breathes over the session (e.g. bell-tones more likely during
  one mood basin, pad-swells more likely in another) without breaking the
  no-cycles guarantee.

Two ornaments of the same type land close in time only when the recovery
curve happens to be far enough along *and* the global process happens to
fire — both rare, jointly rarer. That's the desired behavior: same-type
adjacency isn't forbidden, just genuinely unusual, which is exactly how
naturally-occurring incidental gestures behave.

---

## 4. Parameters the seed picks

A first pass at the actual knob surface:

| Parameter | Description | Reasonable range |
|---|---|---|
| `ornament_rate_baseline` | λ_∞ in events/minute | 0.2 – 3.0 |
| `ornament_refractory_period` | R, hard minimum gap | 20 – 120 s |
| `ornament_rate_modulation_depth` | How much λ(t) breathes | 0.0 – 0.7 |
| `ornament_rate_modulation_source` | Which slow signal drives λ(t) | pink-noise / attractor-coord / off |
| `ornament_types_enabled` | Which ornament types are active for this seed | subset of §3 list |
| `ornament_type_baseline_weights` | `λ_i^∞` per enabled type — long-run share | normalized over enabled types |
| `ornament_type_recovery_tau` | `τ_i` per type — inhibitory recovery time constant | 60 – 600 s |
| `ornament_softness` | Gain ceiling on ornaments relative to bed | −6 to −18 dB below lead |
| `ornament_phase_lock` | Quantize ornaments to bar boundaries? | bool |

The **rate** plus the **refractory** plus the **modulation depth** are the
three knobs that matter most. The rest are flavor.

---

## 5. Use-mode presets

Plausible high-level presets, each a setting of the knobs above:

| Mode | Rate (/min) | Refractory | Modulation | Ornament bag |
|---|---|---|---|---|
| **Sleep / pure ambient** | 0 | — | — | none |
| **Deep focus** | 0.2 | 90 s | low | held-extension, pad-swell only |
| **Default study** | 0.6 | 60 s | medium | most types, no bell |
| **Light study / passive listen** | 1.5 | 30 s | medium | all types |
| **Café / lean-in** | 2.5 | 15 s | high | all types, bell weighted up |

These are the actual user-facing modes: a single high-level "presence" slider
that picks among these presets, plus the existing density/warmth/rain.

---

## 6. Validation

Same offline-Python pattern as the rest of the engine: render an N-hour run,
extract the ornament timestamps, and check that:

1. **Inter-arrival distribution** has the expected shape (refractory floor
   visible; exponential tail at the chosen rate).
2. **Long-run stationarity** — split the run into 30-minute chunks; the
   event rate per chunk should match the modulated mean and not drift.
3. **No type clustering** — autocorrelation of the type-sequence near zero
   for short lags (anti-repeat memory working).
4. **No coincidence with macro changes** — ornaments shouldn't accidentally
   align with attractor lobe switches, which would make them feel like
   structural moments.

These are cheap statistics to compute and they're the kind of check that
catches "actually it sounds repetitive" before a user does.

---

## 7. Decisions & open questions

**Decided:**

- **Ornament timing is phase-locked to bar boundaries.** The global Cox
  process schedules a target time; the actual ornament fires on the next
  downbeat. Avoids fighting the groove; at the rates we're using (≤ a few
  per minute) the quantization loss is musically negligible.
- **Refractory periods (global and per-type) count playback time, not wall-
  clock.** Pausing does not advance recovery; resuming continues from where
  the timers stood. The engine's notion of time is always "audio played,"
  never "human seconds elapsed."

**Still open — revisit as the engine develops:**

- **Are some ornament types *too* salient to ever ship?** The bell tone is
  the obvious candidate to gate behind the "café" preset only. Won't know
  until we hear it in long sessions.
- **Do we want the ornament rate to vary on circadian / wall-clock scales
  too?** "Quieter at midnight" is plausible but invasive (engine reads
  clock). Probably skip for v1 — flagged for later.
