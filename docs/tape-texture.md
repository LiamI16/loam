# Tape texture stage — implementation plan

> **Status: design LOCKED (2026-07-08), ready to implement.** This doc is
> self-contained and written to be handed to an implementation agent with no
> further design discussion. Every open decision (A–E) was resolved in the
> design pass; where a value is still "to be measured," the *measurement
> procedure* is specified so it's an implementation step, not a judgment call.
>
> **Scope guard:** ADAPTER-ONLY. All work is in `@loam/synth-tone`
> (`chains/lofi.ts` + web-demo flag plumbing + offline analysis scripts).
> `@loam/core` is **not** touched, so the engine fingerprint
> (`packages/core/test/ember-engine.test.ts`) **must not move** — verify it
> after the work. Deferred / out-of-scope items live in
> [tape-texture-deferred.md](tape-texture-deferred.md).

## Goal

Add the canonical lofi tape-texture color the chain currently lacks
(`docs/lofi-study.md` §9: the chain today has only vinyl crackle + chorus
depth drift). For launch this reads as *production quality* more than harmony
does. This stage delivers **three** synthesis-friendly texture nodes:

1. **Saturation** (tanh soft-clip) — tape warmth / harmonic glue.
2. **Wow/flutter** — quasi-random tape pitch instability.
3. **Tape hiss** — the medium's noise-floor bed.

## Explicitly NOT in scope: bitcrush / sample-rate reduction

Bitcrush/SRR is **excluded by evidence**, not preference. See
`docs/sampler-character.md`: quantizing pure-synthesis material produces tonal
artifacts (clicky on synthesized noise/drums; buzz on sustained tonal
chords/pads) that additive noise can't mask, because synthesis lacks the
sampled-material spectral density that masks images. A whole-mix crush would
hit both failure modes at once. The one crush effort (`keysCrush`, keys-only)
is a **separate parked workstream** and is *not* part of this stage. Do not
add any crush/quantizer/SRR node here.

## Locked decisions (A–E)

- **A — Grouping & bass.** A single master-bus "tape stage" (saturation +
  wow/flutter) on the whole musical mix, **bass included** (conventional tape
  behavior; adds upper harmonics that help small-speaker translation). Tape
  hiss is a separate parallel bed. No new crush. Bass inclusion is gated by a
  spectrum low-band measurement (Sweep, below).
- **B — Placement.** Tape stage sits **before `warmth`**, ordered as a real
  machine: `saturation (record) → wow/flutter (transport) → warmth (playback
  losses) → master`. So `warmth`'s lowpass tames saturation's upper harmonics
  ("warm," not "fizzy"), and darker warmth ⇒ less audible tape fizz for free.
- **C — Wow/flutter character.** One shared modulated delay on the whole mix
  (single transport; drums/reverb wow together). Modulation = **summed
  incommensurate sine LFOs** (C1) so the composite never obviously repeats —
  a single sine reads as seasick vibrato (the rain lesson:
  periodic modulation → voiced sweep). Audio-domain nodes, NOT engine-driven
  (flutter ~6 Hz is far above the 250 ms ParamEvent cadence).
- **D — Saturation node.** Native `WaveShaper` with a symmetric **`tanh`**
  curve (not `Tone.Distortion`). Gain-staged (drive-in → curve → inverse
  makeup-out). Oversample and drive are **outputs of a measurement sweep**,
  not guessed constants. `4x` is only a conservative fallback; expected
  `2x` (32 kHz context ⇒ low aliasing headroom but gentle drive ⇒ weak high
  harmonics).
- **E — Tape hiss.** _Revised 2026-07-08 (see §"Decision E revision" below)._
  Parallel bed bypassing tape + warmth (like brown/rain/crackle). Baked /
  non-user (foundational color, not an environmental toggle like rain).
  Always-on, mono, cheap. Level exposed as a `ParamSetter` for future drift.
  Original recipe (`Noise('pink') → HP ~1 kHz`) turned out to be **literally
  the rain-bed's recipe** (`docs/rain.md`-equivalent lives in `chains/lofi.ts`
  around `rain = Noise('pink')` → two bandpasses) and read as "distant rain"
  in ear tests. Revised recipe below is broadband-white-with-HF-shelf per
  published cassette bias-noise measurements, and drops all amplitude
  modulation (real tape floor is statistically stationary — audible AM reads
  as vinyl-particle interference or bitcrush, not tape).

## Signal graph

**Before** (today): every musical element `.connect(warmth)`; beds → master.

```
keysPan / padWidener / bassPan / drumBus / reverb ─┐
                                                   ├─▶ warmth (LP) ─▶ master
brown / rain / crackle ────────────────────────────────────────────▶ master
```

**After** (tape flag ON):

```
keysPan / padWidener / bassPan / drumBus / reverb
        │
        ▼
     tapeInput (Gain 1)
        │
        ▼  ── SATURATION ──        ── WOW/FLUTTER ──
     driveGain ─▶ shaper ─▶ makeupGain ─▶ wowDelay ─▶ warmth (LP) ─▶ master
        (tanh WaveShaper,             (Tone.Delay, delayTime
         gain-staged)                 summed by 3 LFOs)

brown / rain / crackle / HISS ──────────────────────────────────────▶ master
```

**Tape flag OFF** (must be byte-for-byte the current sound): elements →
`tapeInput` → `warmth` directly (no sat/wow inserted), and no hiss bed. The
unity `tapeInput` Gain in series is sonically transparent, so it may exist in
both paths; only the sat/wow/hiss nodes are conditional on `opts.tape`.

## Node specs

### 1. Sum-bus rewire (`tapeInput`)

Introduce `const tapeInput = new Tone.Gain(1)`. Every node that currently
does `.connect(warmth)` — `reverb`, `keysPan`, `padWidener`, `bassPan`,
`drumBus`, and the mono-reverb `conv` — connects to `tapeInput` instead.
(Beds are untouched: `brownBed`, `rain`, `crackle` still → `adapter.master`.)

- If `opts.tape`: build the sat + wow chain and connect
  `tapeInput → driveGain → shaper → makeupGain → wowDelay → warmth`.
- Else: `tapeInput.connect(warmth)`.

### 2. Saturation (tanh WaveShaper, gain-staged)

- `driveGain = new Tone.Gain(TAPE_DRIVE)` — pre-gain into the curve.
- `shaper = new Tone.WaveShaper(curveFn, curveLength)` where `curveFn(x) =
  Math.tanh(x)` sampled over `[-1, 1]`. Curve length ≥ 4096 (smoothness).
- `makeupGain = new Tone.Gain(1 / TAPE_DRIVE)` approx — but set makeup to
  **level-match measured RMS** of bypass vs processed (loudness-fair A/B is
  mandatory; see Acceptance). A pure `1/drive` is a starting estimate only.
- `shaper.oversample = TAPE_OVERSAMPLE` (`'none' | '2x' | '4x'`, chosen by
  Sweep 1).
- `TAPE_DRIVE` and `TAPE_OVERSAMPLE` are **outputs of Sweep 1**, then frozen
  as the baked defaults. Both remain flag-overridable (`?tapedrive=`,
  `?tapeoversample=`).

**Why oversample matters here (and differs from keysCrush):** keysCrush used
`oversample:'none'` because *there the aliasing was the character*. Saturation
is the opposite — its generated harmonics alias against the 16 kHz Nyquist
(32 kHz context) and sound harsh/digital, so we oversample to keep them clean.
Do not "consistency-match" this to the crush's `none`.

### 3. Wow/flutter (shared modulated delay, C1)

- `wowDelay = new Tone.Delay(TAPE_WOW_BASE_S, TAPE_WOW_MAX_S)`.
  `delayTime.value = TAPE_WOW_BASE_S` (base ~5 ms). `maxDelay` ~8 ms.
- Three bipolar sine LFOs summed onto `wowDelay.delayTime` (AudioParam sums
  connected signals on top of its intrinsic value):
  - `lfoWow1`: freq 0.50 Hz, amplitude `A1` (target ±7 cents).
  - `lfoWow2`: freq 0.37 Hz, amplitude `A2` (target ±5 cents).
  - `lfoFlutter`: freq 6.3 Hz, amplitude `A3` (target ±2 cents).
  Each `new Tone.LFO({ frequency, min: -A, max: +A }).start()` then
  `.connect(wowDelay.delayTime)`. Non-integer-ratio freqs ⇒ aperiodic
  composite.
- **Cents → delay-amplitude conversion** (implement exactly): for a sinusoidal
  delay modulation of amplitude `A` seconds at frequency `f` Hz, peak
  fractional pitch deviation `Δ = 2π·f·A`, and `cents = 1200·log2(1+Δ)`.
  Invert for a target `c` cents: `Δ = 2^(c/1200) − 1`, `A = Δ / (2π·f)`.
  Starting values (ear-tunable): `A1 ≈ 1.29 ms`, `A2 ≈ 1.24 ms`,
  `A3 ≈ 0.029 ms`. Sum of peaks ≈ 2.6 ms < 5 ms base ⇒ delayTime stays
  positive.
- Depths are the seasick-vs-flat knob; keep modest. Verify no audible pitch
  wobble on drums beyond gentle tape warble (Sweep 2 ear check).

### 4. Tape hiss bed (§E revised recipe, spectrally locked 2026-07-08)

Reference target — Sony HF-90 (Type I ferric, normal-bias), the middle-tier
consumer cassette that anchors "everyday tape" character. Type I is broadband,
peaking around 5–9 kHz with a gentler HF tilt than the premium Type II /
metal formulations. Numbers below are **peak-normalized** (peak band = 0 dB)
so the shape check decouples from the absolute-level knob `TAPE_HISS_DB`.

| band (Hz) | 50–150 | 150–500 | 500–1.2k | 1.2k–2.5k | 2.5k–5k | 5k–9k (peak) | 9k–12k | 12k–15.5k |
| --------- | ------ | ------- | -------- | --------- | ------- | ------------ | ------ | --------- |
| target    | −20    | −12     | −9       | −6        | −3      | **0**        | −3     | −10       |
| tolerance | (info) | (info)  | ±2       | ±2        | ±2      | ±2           | ±2     | ±2        |

Bands below 500 Hz are marked `(info)` because the always-on brown bed
(LP 480 Hz, mono, −30 dBV) swamps the hiss's contribution there — power
subtraction of two similar-magnitude quantities is dominated by the
between-render noise floor, not by real signal. Those bands are printed
for context but excluded from the pass/fail tolerance check.

Verification tool: `packages/synth-tone/scripts/tape-hiss-spectrum.ts`
(pattern shared with `crush-spectrum.ts`, uses `offline-harness.ts` +
`spectrum-util.ts`). Run:

```
bash packages/synth-tone/scripts/profile-chain.sh \
  packages/synth-tone/scripts/tape-hiss-spectrum.ts
```

Renders 30 s of silence-mode chain (music channels muted, rain muted) with
`tape: true` and `tape: false`, power-subtracts to isolate the hiss PSD,
peak-normalizes, and reports each band's delta from target with a ±2 dB
pass/fail marker.

**Frozen constants (2026-07-08, per spectrum harness above):**

| constant                  | value | rationale                                    |
| ------------------------- | ----- | -------------------------------------------- |
| `TAPE_HISS_HP_HZ`         | 60    | keeps low body audible, kills sub / DC       |
| `TAPE_HISS_SHELF_HZ`      | 1000  | matches +3 dB/oct rise inflection point      |
| `TAPE_HISS_SHELF_GAIN_DB` | +4    | tuned to land 5k–9k as peak within tolerance |
| `TAPE_HISS_LP_HZ`         | 11000 | positions peak in 5k–9k, rolls off top       |
| `TAPE_HISS_LP_ROLLOFF`    | −12   | −24 dB/oct over-attenuates 12k–15.5k         |
| `TAPE_HISS_DB_DEFAULT`    | −50   | starting level; in-mix ear-tune              |

Node chain:

```ts
const hiss = new Tone.Noise('white').start();
const hissHp = new Tone.Filter({ type: 'highpass', frequency: TAPE_HISS_HP_HZ });
const hissShelf = new Tone.Filter({
  type: 'highshelf',
  frequency: TAPE_HISS_SHELF_HZ,
  gain: TAPE_HISS_SHELF_GAIN_DB,
});
const hissLp = new Tone.Filter({
  type: 'lowpass',
  frequency: TAPE_HISS_LP_HZ,
  rolloff: TAPE_HISS_LP_ROLLOFF,
});
const hissVol = new Tone.Volume(hissDb);
hiss.chain(hissHp, hissShelf, hissLp, hissVol, adapter.master);
```

Mono. Always-on when `opts.tape`. Bypasses tape stage + warmth (it is the
noise floor; must not be wowed/saturated, and warmth must not eat it).

**No amplitude modulation.** No AM LFOs, no noise-modulator, no carrier
waveshaper. Real cassette floor is statistically stationary at the
timescales we can hear — audible AM instantly reads as a different medium
(vinyl, bitcrush). If the ear test wants "grain," the answer is spectrum,
not envelope. Verified: the recipe above lands all six reliable bands
within ±2 dB of Sony HF-90 published measurements.

## Measurement sweeps (do these BEFORE baking defaults)

Both are offline/analysis steps. `WaveShaper`, `Delay`, and `LFO` are native
Web Audio nodes supported by `node-web-audio-api`, so — unlike the keysCrush
worklet — the saturation + wow tuning CAN be measured offline. Extend the
existing spectrum harness (`packages/synth-tone/scripts/crush-spectrum.ts`,
run via `profile-chain.sh <entry>`) or add a sibling `tape-sweep.ts`.

**Sweep 1 — saturation drive + oversample (sets `TAPE_DRIVE`,
`TAPE_OVERSAMPLE`):**

_Implemented as `packages/synth-tone/scripts/tape-sweep.ts` and run
2026-07-08._ Renders seed 42 / 24 s / 32 kHz with music active + rain muted
+ hiss muted (`bed.hiss.level = -120`) so the tape-ON − OFF delta isolates
saturation. Two OFF renders establish the significance floor. Drive sweep
`{2, 5, 10, 20, 40}`; oversample sweep `{none, 2x, 4x}` at the chosen drive.

**Frozen values (2026-07-08):**

| constant                  | value | rationale                                    |
| ------------------------- | ----- | -------------------------------------------- |
| `TAPE_DRIVE_DEFAULT`      | 5     | highest drive that passes the bass low-band gate after the A-fallback (see below) |
| `TAPE_OVERSAMPLE_DEFAULT` | `'2x'` | conservative pick; `none`/`2x`/`4x` statistically indistinguishable at drive 5 |

**Drive pick — deviation from plan target.** The plan called for "+1 to +2 dB
odd-harmonic rise in the mids." That target assumed a pure-tone probe; on a
real mix, tanh at moderate drive manifests as **compression** (peaks squashed,
proportional drop across all bands), not measurable additive harmonics. At the
drives tested, no drive produced a distinct mid-band rise vs. OFF baseline;
instead the visible effect is a proportional RMS drop (drive 2 → −0.4 dB
RMS, drive 5 → −0.9 dB, drive 10 → −2.2 dB, drive 40 → −6.9 dB). Drive 5
was chosen as the highest drive that still passes the bass-mud gate — mild
tape-squeeze compression without breaking bass — after the A-fallback.

**A-fallback applied (bass exclusion).** At drive 5 pre-fallback, the 30–150
Hz band showed −0.79 dB attenuation vs. an OFF-repeat floor of ~0.03 dB —
i.e. the bass fundamentals were being pulled by the saturator. Plan §A
allowed either (i) pre-saturation HP on the bass path or (ii) excluding
bass from `tapeInput` entirely; **(ii) was chosen** because the lofi bass is
already a clean sine + tight envelope — the "small-speaker translation" benefit
that motivated including it doesn't apply to a signal that's already punchy.
Applied by wiring `bassPan.connect(warmth)` (skipping tape). After the
fallback, drive 5's 30–150 band delta drops to −0.32 dB — near-floor.

**Oversample pick — inconclusive at drive 5.** At drive 5, deltas between
`none`, `2x`, and `4x` sit entirely within the between-render noise floor
across all bands (12k–16k floor ~2 dB, deltas ≤ 1 dB). No measurable
aliasing to remove. Kept `2x` per the plan's expected pick and as insurance
against browser vs. `node-web-audio-api` fidelity gaps in
`WaveShaper.oversample`. If a future in-browser probe finds real aliasing
under `none`, revisit.

**Level-matched makeup gain — Sweep 1 follow-up (done 2026-07-08):**

Implemented as `packages/synth-tone/scripts/tape-makeup-match.ts` — renders
seed 42 / 24 s / 32 kHz, music active + rain/hiss muted, N=8 renders each
of tape OFF and tape ON at the frozen drive/oversample, reports the mean
RMS delta and the linear correction needed. Initial N=4 measurement showed
delta −0.87 dB but overshot on the applied trim; refined at N=8 to
−0.35 dB mean delta (SE ≈ 0.10 dB). Applied `TAPE_SAT_MAKEUP_TRIM = 1.041`
(≈ +0.35 dB) as a multiplier on top of the `1/drive` base in both node
construction and the `fx.tape.saturationDrive` param setter. Post-trim
delta measured at −0.08 dB, well within the stability floor of ~0.3 dB —
bypass A/B is now loudness-fair. Trim is drive-dependent; re-run
harness if `TAPE_DRIVE_DEFAULT` changes.

**Sweep 2 — wow/flutter sanity + hiss level (done 2026-07-08):**

Per plan, this sweep is primarily perceptual. Two properties the design
guarantees mathematically (no measurement needed):

- **Aperiodicity by construction.** The three LFO frequencies (0.5, 0.37,
  6.3 Hz) are non-integer ratios — the composite modulation never
  obviously repeats. Verified by inspection of `TAPE_WOW_LFOS` in
  `chains/lofi.ts`.
- **Bounded peak deviation.** Amplitudes derive from target cents via the
  exact `centsToDelayAmp` formula (Δ = 2^(c/1200) − 1; A = Δ/(2π·f)).
  Theoretical peak deviation is 7+5+2 = 14 cents — generous vs. real
  Sony HF-90 wow (typically 1–3 cents WRMS) but on the "gentle" side.

**Numerical corroboration attempted — abandoned.** A `tape-wow-check.ts`
harness was written to short-time-FFT-track pad pitch and inspect the
modulation spectrum. It doesn't work cleanly on polyphonic pad content:
chord changes shift the tracked fundamental, so note transitions
appear as pitch modulation (baseline RMS ~500 cents from note changes
alone, swamping the wow signal). A clean measurement would require
probe injection (feed a pure sine into the tape stage) — bigger refactor
than justified for a perceptual sweep. Script removed. Wow depths
frozen at the design values.

**Wow depths — frozen (design-locked values):**

| LFO       | frequency | target peak | base amp (s) |
| --------- | --------- | ----------- | ------------ |
| wow 1     | 0.50 Hz   | ±7 cents    | ≈ 1.29 ms    |
| wow 2     | 0.37 Hz   | ±5 cents    | ≈ 1.24 ms    |
| flutter   | 6.30 Hz   | ±2 cents    | ≈ 0.029 ms   |

**Hiss level — frozen at −72 dB.** Iterated in-mix from the −50 dB
placeholder; −72 lands the hiss as subliminal "air" under the music, as
Sony HF character sits in real recordings. Solo-audition will sound
near-silent — that's correct; character check is in-mix only.

Record CPU (in-browser Chrome Task Manager + `profile-chain.ts` for the native
nodes). Per project convention CPU is **measured and recorded, not a gate** on
the feel — but note it, since this is always-on floor.

## Flags & rollout

Mirror the keysCrush / Phase-2 convention: flag-gated, **default OFF**, baked
as default **before launch** only after ear + spectrum approval. Keeps `main`
shippable and allows regression comparison against the current sound.

Add to `LofiChainOptions` (`chains/lofi.ts`), all validated/clamped —
a malformed flag falls back to the default, never breaks or silences audio:
- `tape?: boolean` — master switch for the whole stage (default off pre-bake).
- `tapeDrive?: number` — saturation drive (positive finite; fallback default).
- `tapeOversample?: 'none' | '2x' | '4x'` — fallback default from Sweep 1.
- `tapeHissDb?: number` — hiss level in dB (finite; fallback default).
- `tapeWowDepth?: number` — optional scalar multiplier on `A1..A3`
  (default 1) for ear-tuning wow intensity without recompiling.

Read these in `apps/web-demo/src/main.ts` alongside the existing
`?keyscrush=` / `?monoverb=` flag plumbing (URL + localStorage). Baking =
flip the `tape` default to `true` (and set the measured constants) in a single
commit noting the aesthetic tradeoff + A/B outcome.

## Params exposed (adapter `registerParam`)

Register these so future drift is a drop-in (the drift *driver* itself is
deferred — see deferred doc, it's an engine/fingerprint change):
- `fx.tape.saturationDrive` → sets `driveGain.gain` (+ recompute `makeupGain`).
- `fx.tape.wowDepth` → scales the three LFO amplitudes.
- `bed.hiss.level` → sets `hissVol.volume` (dB).

Follow the existing `registerParam` `set` / `ramp` wrapping pattern. Guard all
of them so they no-op cleanly when `opts.tape` is off (nodes don't exist).

## Files to touch

- `packages/synth-tone/src/chains/lofi.ts` — `LofiChainOptions` additions;
  `tapeInput` rewire; saturation + wow/flutter nodes; hiss bed; param
  registration; constants (`TAPE_*_DEFAULT`) with the measured values.
- `apps/web-demo/src/main.ts` — flag reads (URL + localStorage), passed into
  `buildLofiChain`.
- `packages/synth-tone/scripts/` — extend `crush-spectrum.ts` or add
  `tape-sweep.ts` for Sweep 1 (+ any wow spectral corroboration).
- `docs/tape-texture.md` — append an assumptions log + the measured
  `TAPE_DRIVE` / `TAPE_OVERSAMPLE` / hiss level on close-out.
- `stage-list.md` — mark the item done on close-out.
- **Do NOT touch** `packages/core/**` (fingerprint) or the crush worklet.

## Verification & acceptance

Run the gate unsilenced from repo root and fix failures first:
`pnpm lint && pnpm typecheck && pnpm test`.

Acceptance criteria:
- Engine fingerprint (`ember-engine.test.ts`) **unchanged** (adapter-only).
- Tape OFF path is sonically identical to today (regression via `?tape=0`).
- Saturation adds warmth (measured +1–2 dB mid harmonics) with **low bands
  within the OFF floor** (bass not mudded); if not, the A fallback was applied
  and documented.
- Oversample is the lowest alias-free factor (Sweep 1), not a guess.
- Wow/flutter reads as irregular tape warble, **no seasick sine vibrato**,
  drums not wobbly.
- Hiss is subliminal "air" in-mix (approve in-mix, not solo).
- Bypass A/B is **level-matched** (makeup gain set by measured RMS).
- Flag default OFF until ear+spectrum approved; bake in a documented commit.
- CPU recorded (not a gate).

## Implementation status (2026-07-08)

The original Task order below is preserved for reference. Where the code
diverges from the plan, the state is called out here rather than by rewriting
the plan — doc-and-code drift is what we're trying to avoid, so the plan
stays as-written and this section reconciles.

### Done

- **Task 1** — `tapeInput` rewire + `opts.tape` OFF/ON branching. Engine
  fingerprint unchanged; OFF path is unity-Gain-transparent.
- **Task 2** — Saturation node (`tapeDriveGain → shaper (tanh, oversampled)
  → tapeMakeupGain`). Curve sampled at length 4096 via
  `new Tone.WaveShaper(x => Math.tanh(x), 4096)`. Placeholder drive `1.5`,
  placeholder oversample `'2x'`. `fx.tape.saturationDrive` param wrapped
  (recomputes makeup gain on set/ramp).
- **Task 3** — Wow/flutter. Three summed LFOs at 0.5 / 0.37 / 6.3 Hz
  targeting 7 / 5 / 2 cents peak, amplitudes computed via `centsToDelayAmp`
  (the plan's Δ = 2^(c/1200) − 1, A = Δ/(2π·f) formula, implemented exactly).
  `fx.tape.wowDepth` param rescales all three from stored base amps.
- **Task 4** — Hiss bed. Recipe locked spectrally against Sony HF-90 (Type I
  ferric) via `packages/synth-tone/scripts/tape-hiss-spectrum.ts` — all six
  reliable bands within ±2 dB of published measurements. Frozen constants
  and the target-band table live in §"Node spec 4" above. `bed.hiss.level`
  param wrapped; flag plumbing (`?tapehissdb=`) in place.
- **Task 5** — Flag plumbing in `apps/web-demo/src/main.ts`. `?tape`,
  `?tapedrive`, `?tapeoversample`, `?tapehissdb`, `?tapewowdepth` all
  validated and localStorage-persistent, following the `?keyscrush=` pattern.

### Outstanding

- **~~§E hiss recipe rebuild~~** — done 2026-07-08 (spectrum-locked per §4;
  diagnostic knobs culled, no AM in graph).
- **~~Sweep 1~~** — done 2026-07-08. `TAPE_DRIVE_DEFAULT = 5`,
  `TAPE_OVERSAMPLE_DEFAULT = '2x'` frozen via
  `packages/synth-tone/scripts/tape-sweep.ts`. A-fallback applied (bass
  bypasses `tapeInput` and goes directly to `warmth`). See §Measurement
  sweeps for the frozen-values table and the deviation-from-plan note
  (real mix reads as compression not additive harmonics).
- **~~Level-matched RMS makeup gain~~** — done 2026-07-08. Applied
  `TAPE_SAT_MAKEUP_TRIM = 1.041` on top of the `1/drive` base at frozen
  drive 5, measured via `packages/synth-tone/scripts/tape-makeup-match.ts`
  (N=8 renders each side). Verified post-trim delta lands within the
  between-render noise floor (~0.3 dB).
- **~~Sweep 2~~** — done 2026-07-08. Wow depths frozen at design-locked
  values (aperiodic + peak-deviation guarantees are constructive; no
  measurement needed). Hiss level frozen at −72 dB per in-mix ear pass.
  Numerical wow verification attempted via pitch tracking and abandoned
  (chord changes swamp the wow signal on polyphonic pad content).
- **~~CPU recording~~** — skipped by user preference at close-out (per
  project convention, CPU is measured-not-gated; the added always-on
  cost is small — one broadband hiss chain (noise → 3 filters → gain),
  a symmetric tanh WaveShaper, and a delay + 3 sub-audio LFOs, all
  Web-Audio-native). Chrome Task Manager check deferred until a
  first-listen report says otherwise.
- **~~Assumptions log~~** — appended below.
- **~~Default bake~~** — `tape` default flipped to `true` at close-out
  (2026-07-08). `if (opts.tape ?? true)` in `chains/lofi.ts`; `?tape=0`
  still available for regression A/B.
- **~~`stage-list.md`~~** — line marked done at close-out.

## Suggested order from here

Sequenced by dependency and cheapest-to-highest-cost. Steps 1–2 are done
(both landed 2026-07-08); steps 3–7 are the plan's original Tasks 6–8
rescoped for what's still outstanding.

1. ~~**Hiss recipe rebuild (§E revised).**~~ Done — white → HP 60 → HF
   shelf +4 dB @ 1 kHz → LP 11k with −12 dB/oct. Diagnostic knobs culled.
2. ~~**`tape-hiss-spectrum.ts`.**~~ Done — sibling of `crush-spectrum.ts`.
   All six reliable bands within ±2 dB of Sony HF Type I target shape.
3. ~~**Sweep 1** → freeze `TAPE_DRIVE` + `TAPE_OVERSAMPLE`.~~ Done —
   `tape-sweep.ts` written; drive 5 + oversample '2x' frozen; A-fallback
   (bass excluded from `tapeInput`) applied. See §Measurement sweeps.
4. ~~**Level-matched makeup gain.**~~ Done — `tape-makeup-match.ts`
   written; `TAPE_SAT_MAKEUP_TRIM = 1.041` applied on top of the `1/drive`
   base. Post-trim delta within noise floor.
5. ~~**Sweep 2** → freeze wow depths + in-mix hiss level.~~ Done — wow
   depths at design-locked constructive values; hiss at −72 dB per
   in-mix ear pass. Numerical wow tracking abandoned (polyphony breaks
   peak tracking).
6. ~~**CPU recording.**~~ Skipped at close-out per user preference.
7. ~~**Close-out.**~~ Done — assumptions log below, `tape` default
   flipped to `true` in `chains/lofi.ts`, `stage-list.md` line marked
   done.

## Original task order (2026-07-08, for reference)

Kept verbatim so the reconciliation above stays honest. This is what the
plan called for at design-lock time; deviations are the "Outstanding" list
above.

1. `tapeInput` rewire + `opts.tape` OFF/ON branching; confirm OFF path
   identical (fingerprint + `?tape=0` A/B).
2. Saturation node (gain-staged tanh) with placeholder drive; wire params.
3. Wow/flutter node (three summed LFOs, cents→delay math) with placeholder
   depths; wire param.
4. Hiss bed; wire param.
5. Flag plumbing in `main.ts`.
6. Sweep 1 → freeze `TAPE_DRIVE` + `TAPE_OVERSAMPLE` (apply bass fallback if
   the low-band gate fails).
7. Sweep 2 + in-mix ear pass → freeze wow depths + hiss level.
8. Gate green; record CPU; write assumptions log; bake defaults; close out
   `stage-list.md`.

## Assumptions log (close-out, 2026-07-08)

Decisions and deviations made during implementation that weren't in the
locked plan. Ordered by structural impact.

### 1. §E hiss recipe replaced wholesale after ear-test

The plan's decision E specified `Noise('pink') → HP ~1 kHz → Volume →
master`. Ear-tested and it read as "distant rain." Diagnosis: that recipe
is literally the rain bed's recipe (`chains/lofi.ts` uses pink noise +
bandpass for `rain` too), so the ear-collision was inevitable.

Rebuilt against published Sony HF-90 Type I ferric bias-noise
measurements: **white noise + broadband HF shelf**, no bandpass, no
resonant peak, no amplitude modulation. Frozen constants + target-band
table in §"Node spec 4"; verification tool in
`packages/synth-tone/scripts/tape-hiss-spectrum.ts` (all six reliable
bands within ±2 dB of published shape).

**Also-tried-and-abandoned during ear-tuning:** peaking filter at 6.5 kHz
(read as "tuned wash"); two-timescale amplitude modulation (slow brown
mod + fast pink mod for "grain"); carrier tanh soft-clip. All were
attempts to add perceptual "grain" via the envelope; all made it read as
a different medium (vinyl, bitcrush). Real cassette hiss's grain lives
in the **spectrum**, not the envelope — corroborated by published
statistically-stationary measurements. All three attempts culled at
step 1 of the rebuild along with their diagnostic URL knobs.

### 2. Saturation reads as compression, not additive harmonics

The plan's Sweep-1 drive target was "+1 to +2 dB odd-harmonic rise in
the mids." That's pure-tone reasoning. On the real music mix (measured
via `tape-sweep.ts` at drive 2 / 5 / 10 / 20 / 40), no drive produced a
measurable mid-band harmonic rise; the visible effect is **proportional
RMS compression** (peaks squashed, all bands drop together).

Drive was picked by the bass-mud gate instead: drive 5 is the highest
value that keeps the 30–150 Hz band delta within the OFF-repeat noise
floor after the A-fallback. Above 5, bass fundamentals break the gate;
below 5, saturation is essentially bypass.

### 3. A-fallback: bass excluded from `tapeInput`

Even at drive 5, feeding bass through the saturator pulled the 30–150 Hz
band −0.79 dB (vs. ~0 dB noise floor) — bass fundamentals were being
crushed. Plan §A allowed either (i) pre-saturation HP on bass or (ii)
excluding bass from `tapeInput` entirely. Chose **(ii)**: the lofi bass
is already a clean sine at −15 dB with a tight envelope; it doesn't need
the "small-speaker translation benefit" that motivated including it.
Implemented as `bassPan.connect(warmth)` instead of
`bassPan.connect(tapeInput)`. Post-fallback delta: −0.32 dB, near-floor.

### 4. Level-match trim added: `TAPE_SAT_MAKEUP_TRIM = 1.041`

Plan §D specified "level-match measured RMS" for the makeup gain. Initial
N=4 measurement gave a noisy −0.87 dB delta which overshot when applied;
refined at N=8 to a stable −0.35 dB (SE ≈ 0.10 dB). Applied as a
multiplier on top of the `1/drive` base in both node construction and
the `fx.tape.saturationDrive` param setter, so drive-knob drift also
stays level-fair. Post-trim delta lands within the between-render noise
floor of ~0.3 dB. Trim is drive-dependent; re-run
`tape-makeup-match.ts` if `TAPE_DRIVE_DEFAULT` changes.

### 5. Oversample inconclusive; kept `'2x'`

At drive 5 the `none` / `2x` / `4x` band deltas sit entirely within the
between-render noise floor (12k–16k floor ~2 dB, deltas ≤ 1 dB). No
measurable aliasing to remove. Kept `2x` per plan expectation and as
insurance against browser vs. `node-web-audio-api` fidelity gaps in
`WaveShaper.oversample` (plan noted this caveat). If a future in-browser
probe finds aliasing under `none`, revisit.

### 6. Wow depths locked at design values without numerical verification

Wow depths are already mathematically anchored: three non-integer LFO
ratios ⇒ aperiodic composite by construction; amplitudes exact from the
`centsToDelayAmp` formula ⇒ ±14 cents theoretical peak. Attempted a
`tape-wow-check.ts` harness that short-time-FFT-tracked pad pitch and
computed the modulation spectrum. It doesn't work cleanly on polyphonic
pad content: chord changes shift the tracked fundamental so note
transitions appear as pitch modulation (baseline RMS ~500 cents from
note changes alone, swamping any wow signal). Clean measurement would
need probe injection (pure sine into the tape stage) — bigger refactor
than justified for a perceptual sweep. Script removed; wow depths frozen
at design values.

### 7. Hiss level ear-tuned to −72 dB (from −50 dB placeholder)

Started at −50 dB per Node-spec-4's "start value." In-mix iteration
landed at −72 dB — solo-audition sounds near-silent but in-mix it reads
as subliminal "air." Character check is in-mix only.

### 8. Diagnostic knobs added during ear-tuning, later culled

Three URL flags were added mid-implementation while chasing "grainy tape
hiss" via envelope modulation:

- `?tapehissslow` — slow brown-noise AM depth
- `?tapehissfast` — fast pink-noise AM depth
- `?tapehissshape` — carrier tanh soft-clip drive

All three culled at the §E hiss rebuild once the recipe was corrected to
"spectrum, not envelope." Not part of the shipped surface.

### 9. New dev-time analysis tools written

Three offline analysis scripts landed in
`packages/synth-tone/scripts/`, all following the `crush-spectrum.ts` /
`offline-harness.ts` pattern. None are shipped; all are dev-only.

- `tape-hiss-spectrum.ts` — Welch-averaged band-power check of the
  hiss-only bed vs. a hardcoded Sony HF-90 Type I target-band table.
  Marks brown-bed-contaminated bands informational.
- `tape-sweep.ts` — Sweep-1 harness. Drive sweep + oversample sweep +
  significance floor from two OFF renders.
- `tape-makeup-match.ts` — level-match harness. N=8 renders each side,
  outputs the linear correction multiplier for `TAPE_SAT_MAKEUP_TRIM`.

### 10. Fingerprint remained locked throughout (adapter-only)

The plan's scope guard held: `packages/core/**` untouched, `Seed.from(42n)
with bpm: 74` engine fingerprint unchanged, `ember-engine.test.ts` still
green at all 15 tests. Verified after every gate.

### 11. CPU recording skipped at close-out

Per project convention, CPU is measured-not-gated. User skipped the
Chrome Task Manager check at close-out; deferred until a first-listen
report warrants it. Rough estimate: added always-on cost is one hiss
chain (noise + 3 filters + gain), one WaveShaper, one delay + 3
sub-audio LFOs, and one Gain — all Web-Audio-native. No worklets. No
async render loops. Fixed cost, not per-voice.

### 12. Default flipped to `tape: true` at close-out

`if (opts.tape ?? true)` in `chains/lofi.ts` — the stage is now on by
default. `?tape=0` still available for regression A/B.
