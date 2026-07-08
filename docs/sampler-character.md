# Vintage-sampler character — per-part bit-crush

> **Design doc.** Decisions below are locked (discussion 2026-07-01). This is
> the **aesthetic** workstream, kept deliberately separate from the CPU
> workstream (`docs/audio-cpu-plan.md`, complete): a bit-crush is a decimation
> *effect* that **adds** a little CPU — it is not an optimization. Don't
> conflate them.

## Goal (why)

Give the keys the grit of the classic 12-bit hip-hop samplers — quantization
fuzz — the texture `lofi.ts` already flags as missing ("wow/flutter, tape hiss,
bitcrush — none currently in the chain"). Aesthetic anchor: **E-mu SP-1200,
12-bit**. Character should read as "sampled through old hardware," never
"broken / harsh digital."

## ⚠️ Finding: bit-crush suits TONAL material, not synthesized noise

**Drum bit-crush was implemented and dropped after an ear test (2026-07-01).**
Tone's `BitCrusher` is pure amplitude quantization
(`val = step·floor(input/step + 0.5)`, `step = 0.5^(bits−1)`). On a *sampled*
drum that adds "dust" because there's tonal body + tape/vinyl hiss to interact
with. Loam's snare/hat are pure synthesized **noise** (`NoiseSynth`), and
quantizing noise makes consecutive random samples stair-step into **correlated
harmonic buzz on the transient** — it read as **"clicky," never "dusty," at
every bit value 6–16**. This is the pure-synthesis constraint biting: the SP-1200
dusty-drum sound assumes sampled material. So:

- **Drums: no bit-crush.** If drum "dust/grit" is wanted later, use a
  synthesis-appropriate tool — **saturation / soft-clip** (harmonic warmth, no
  clicky quantization) — plus the existing vinyl crackle + `drumBus` lowpass.
  Tracked under "Possible future," not now.
- **Keys: bit-crush is the right home.** The FM Rhodes is *tonal/harmonic*, so
  quantization should read as musical "lo-fi digital piano" grit. This is now
  Step 1.

## Development principle (locked)

**Feel first, optimize after. Easier to remove than to add.** Build the
character at its natural cost, get it right by ear, and trim CPU only if we
later decide the feel isn't worth the bill. CPU is *measured and recorded*, not
a gate on Step 1.

## Locked constraints

- **Pure DSP, no samples.** A bit-crush AudioWorklet (`Tone.BitCrusher`) is
  synthesis-domain processing → compatible with "pure synthesis only."
- **Engine fingerprint must not move.** All render-side (`@loam/core`
  untouched). Verify `ember-engine.test.ts` after every change.
- **Behind A/B flags**, same pattern as Phase 2: extend `LofiChainOptions`,
  read URL/localStorage flags in `apps/web-demo/src/main.ts`. Default **off**
  until ear-approved, then bake (owner decides).

## Scope decision: SRR unlocked (revised 2026-07-03)

**Original decision (2026-07-01): "No SRR — possibly ever."** Rationale: the
SP-1200 signature is "really the 12-bit quantization"; from a 32 kHz context,
decimating toward 26 kHz barely moves Nyquist; fractional-rate hold needs an
AudioWorklet (integer holds can't land on 26 kHz).

**Re-evaluated and unlocked 2026-07-03 (owner decision), because all three
premises failed:**

1. *"The signature is the quantization"* — empirically falsified.
   Spectrum-verified + ear-confirmed: pure quantization on clean synthesized
   keys yields correlated harmonic **buzz** ("electrical transformer", 7 bits)
   or noise-floor **air** (5 bits), never the producer texture. Sampled
   material's noise floor acts as natural dither (→ "dust"); pure synthesis
   has none — the drum-crush failure mode, one layer deeper.
2. *"Decimation toward 26 kHz is pointless"* — true but aimed at the wrong
   target. SRR character is the **aliasing** of naive sample-and-hold, not
   the band-limit, and the famous SP sound came from *half-rate* use. Integer
   holds from 32 kHz give 16 k (÷2), 10.7 k (÷3), 8 k (÷4) effective — the
   audible-grit zone. 26 kHz was only ever the spec sheet.
3. *"Needs a fractional worklet"* — only for faithful 26.04 kHz emulation,
   which per (2) isn't the goal. An **integer hold** is a ~20-line
   AudioWorkletProcessor: zero latency, ~Gain-node cost, keys bus only. The
   earlier worklet aversion was really about `Tone.BitCrusher`'s dry/wet
   Effect wrapper, not workletness. (Constraint: AudioWorklet needs a secure
   context — Pages/localhost/Electron all qualify. The offline harness may
   not support worklets; analysis uses an identical pure-JS hold instead.)

**Plan (analysis before implementation):** extract exact error signals
(`processed − clean`) from offline renders, compare recipe candidates in pure
JS — quant-only, quant+TPDF dither, SRR ÷2/÷3/÷4, SRR+quant+dither — via
error tonality metrics (spectral flatness, harmonic-peak prominence) plus
rendered WAV ear checks. Only the winning recipe gets a production worklet,
behind a flag. If dither alone wins, no worklet is built at all.

## ★ Final recipe (locked 2026-07-03, offline A/B `crush-recipes.ts`)

**Linear-interpolation (first-order) hold at ÷4 (8 kHz effective from the
32 kHz context) + 12-bit TPDF-dithered quantization at ×4 drive**, as a
minimal AudioWorklet (`src/chains/sampler-crush.ts`), inserted **after
evoFilter, before the keys taps**. Selection trail:

- Pure quantization (any bits/drive): airy hiss or transformer buzz — never
  the producer texture (see spectrum + error-signature analyses below).
- Zero-order hold (the "authentic" staircase): cricket-like rattle on our
  clean band-limited keys at every tested variant — pre-echo placement,
  reconstruction LP 5 k, even the hardware-faithful ~10.5 k output LP.
  Sampled records masked ZOH imaging in the classic hardware; pure synthesis
  doesn't. **ZOH is ruled out for this material.**
- Linear hold keeps the same image frequencies with a much steeper energy
  rolloff: same character family, no rattle. Ear-picked winner at ÷4
  ("heavy" rung, 8 kHz) over ÷2/÷3, with the 12-bit dither layer.
- **Placement revision:** the effect *is* imaging around the reduced rate —
  an LP 1800 downstream of it before the taps would erase it (that was the
  original quantizer's failure mode). So: `evoFilter → crush → taps`. The
  "crush the source, upstream of every send" doctrine still holds; only the
  "evoFilter tames the fizz" clause is dead (linear hold has no fizz; dither
  handles quantization noise).
- Spec anchor: effective 8-10.7 kHz + 12-bit sits in the historical zone
  (half-speed SP-1200 ≈ 13 k through ~10 k output LPs; MPC60 ≈ 10.5 k
  band-limit; plugin lofi presets 8-16 k, samples only). *(Hardware numbers
  from model knowledge — web verification pending, flagged 2026-07-03.)*

The worklet loads async behind a pass-through gain pair; if AudioWorklet is
unavailable the chain plays uncrushed rather than breaking. Flags:
`?keyscrush=1&keyscrushrate=4&keyscrushbits=12&keyscrushdrive=4` (all
validated/clamped; rate 1–8, bits 1–16).

**✅ Ear-approved in-app 2026-07-08** (seed 42, explicit default flags).
Production-integration findings on the way there:

- **Worklet must use the NATIVE AudioWorklet API** (`rawContext.audioWorklet`
  + `new AudioWorkletNode(raw, …)`), not Tone's
  `addAudioWorkletModule`/`createAudioWorkletNode`: the app wraps a native
  `AudioContext` (32 kHz CPU lever), and Tone's helpers go through
  standardized-audio-context's private module registry → `InvalidStateError`
  and a silent bypass. One module load per context is cached (duplicate
  `registerProcessor` throws on reseed rebuilds).
- **Dither is gated below half-LSB** so silence stays silent — undithered
  the worklet fed a constant noise floor into the reverb/echo sends.
- **Flag persistence is a footgun for ear tests**: stale
  `loam.flag.keyscrushbits=7` from an earlier tuning session made the new
  recipe hiss ("added white noise"). When A/B-ing, always pass every knob
  explicitly once to re-persist.
- Warmth placement is a non-issue, measured: the master LP eats only 1.4 dB
  of the recipe's character (its energy sits mostly below the cutoff).
- In-mix character measures −43 dB rel full mix (−33 dB rel solo keys) —
  deliberately subtle. **Approve intensity changes in-mix, not solo.**
- `crush-spectrum.ts` cannot exercise the worklet (node-web-audio-api has no
  AudioWorklet); production-chain verification of the crush is browser-only.
  The recipe-level ground truth lives in `crush-recipes.ts` (pure JS).

**Status: ⏸ ON HOLD (owner decision 2026-07-08), default OFF.** Shipped
behind the flag; no user-facing change while paused.

Why paused: after in-app approval, careful listening found roughness/buzz on
sustained chords. Numerically confirmed cause: FOH imaging on *sustained*
material is tonal (chord-only error peakProm 7.5 dB / flatness 0.75 in
3–11 k) while on melody it's noise-like grit (1.1 dB / 0.997) — the buzz is
a chord phenomenon. But fix-candidate ear tests then stopped converging
(a post-LP-smoothed variant reported buzzier than the unsmoothed one it was
derived from, which physics rules out), so tuning is paused before it turns
into ear-fatigue roulette.

**Resume here:** the untested structural gap is that all offline sims crush
*after* the room, while the live chain crushes *before* the reverb/echo
sends — reverberated/echoed image tones exist only live, and no current
tool can A/B the real chain offline (node-web-audio-api lacks AudioWorklet).
First step on resume: build a true live-chain capture (in-browser
MediaRecorder/OfflineAudioContext render of the actual graph, or offline
worklet support), THEN re-run the chord-buzz comparison on real output.
Leading fix candidate if the diagnosis holds: **crush the melody path only**
(pre-chorus split; chords stay clean) — 2026-07-08 candidate `24` was
buzz-free and preserved the liked character; implement + verify live when
resumed.

## Superseded: `WaveShaper` quantizer (kept for the decision record)

**Finding (2026-07-01):** `Tone.BitCrusher` coloured the keys ("airy/hollow/
low") **even at a transparent 16-bit** — the tell that it wasn't the
quantization. `Tone.BitCrusher` is a Tone `Effect`: it wraps the quantizer in
an **AudioWorklet** (128-sample latency) inside a **parallel dry/wet crossfade**
with its own stereo handling, and that machinery colours the signal regardless
of bit value.

So the crush is instead a native **`WaveShaper`**: it bakes the same staircase
(`step·round(x/step)`, `step = 2^(1−bits)`) into a lookup curve — pure,
zero-latency, in-series, no worklet, no dry/wet. High bits are a true
passthrough; only the intended quantization remains. **`oversample: 'none'` is
deliberate** (revised from an earlier `4x` — see Iterations #4): the crunch
*is* the aliasing from quantizing at the raw rate; oversampling is an
anti-alias technique that sands that grit off. Curve length 16384 (~14-bit)
keeps high `bits` clean. Bonus: cheaper than the worklet, and it works in the
offline harness.

## Convention basis (still governs the keys placement)

**Crush the source, not "the room."** The crush is an artificial producer move
applied to the (would-be) sampled material; reverb/echo are added *after* as
clean sends on the already-crushed signal. So the crush must sit **upstream of
the sends** → the tail becomes a clean reverb/echo *of a crushed signal*.
*(Placement within that constraint was revised 2026-07-03: originally between
`chorus` and `evoFilter`; now between `evoFilter` and the taps, because the
SRR imaging character must not pass through the LP 1800 — see Final recipe.)*
(For drums, the same principle plus low-end protection would have kept the
kick clean — moot now that drum crush is dropped.)

---

## Keys signal path (current `lofi.ts`)

`keysChord + keysMelody → chorus → evoFilter (LP 1800) → keysPan → warmth`.
Reverb send (`keysSend`) taps at `keysPan`; chord-echo send (`chordEchoSend`)
taps at `evoFilter`. Both keys synths feed `chorus`, so a single crush after
chorus hits chords *and* melody together.

## Step 1 — Keys bit-crush ★ (implemented, awaiting ear-approval)

**Design (revised after ear tests — see "Iterations" below):**
- **Bus crush** (chord+melody are polyphonic single streams — no per-voice),
  a native **`WaveShaper`** (not `Tone.BitCrusher`).
- **Source crush (upstream) + gain-staged.** Inserted on the shared keys signal
  **between `chorus` and `evoFilter`**, upstream of every tap (dry, reverb send,
  chord-echo send), so reverb + echo are of the *crushed* signal — cohesive.
  `evoFilter` (LP 1800) right after tames the fizz before the sends. Boosted by
  `KEYS_CRUSH_DRIVE_DEFAULT` (×4, +12 dB; revised from +6 dB — see Iterations
  #5) into the crusher (bit-crush is relative to full-scale; the keys sit well
  below it, so without a boost the quantizer only sees the noise-floor regime —
  thin "airy hiss," which is also what polluted the reverb/echo in the
  un-staged version), with the exact inverse after so net level + bypassed
  sound are unchanged. Drive is the crunchy-vs-hissy knob; higher drives clip
  against the WaveShaper's ±1 curve, which for bit-crush is characterful
  (harder edge), not a bug.
- **12-bit default**, flag-adjustable. FM Rhodes is tonal, so quantization
  should read as musical "lo-fi digital piano" grit.
- **No SRR, no master crush.**

### Iterations (what broke and why)

1. **`Tone.BitCrusher` → "airy/hollow" even at 16-bit.** Its AudioWorklet +
   parallel dry/wet Effect wrapper coloured the signal independent of bit value.
   Fix: native `WaveShaper` (zero-latency, in-series, no wrapper).
2. **"Random white-noise pollution" + phasing.** Two causes: (a) not gain-staged
   → quantized a low-level signal → giant relative noise floor; (b) crush sat
   upstream of the reverb/chord-echo sends → the feedback delay recirculated and
   the reverb smeared the quantization hash across the whole song. First fix was
   dry-only placement + gain-staging → killed the pollution and the phasing.
3. **Dry-only sounded incoherent** — "a crushed layer on top of the old audio,"
   because reverb + echo were still *clean* copies of the keys. Fix: move the
   crush back to the **source** (upstream, cohesive) but **keep the gain-staging**
   — the gain-staging (not the placement) is what actually cured the pollution,
   so upstream is safe now.
4. **`4x` oversampling → transparent/airy instead of crunchy.** Oversampling
   anti-aliases the staircase, but the aliasing *is* the crunch. Fix:
   `oversample: 'none'`.
5. **+6 dB pregain still hissy, bit values 8–16 undiscriminable.** The keys sit
   far enough below full-scale that ×2 left the quantizer in the noise-floor
   regime. Fix: drive default ×4 (+12 dB), promoted to its own flag
   (`?keyscrushdrive=`) as the crunchy-vs-hissy ear-tuning knob. This is the
   current design — **awaiting programmatic spectrum verification + ear test.**

**Flags** (validated 2026-07-03 — malformed values fall back to defaults,
never break or silence the keys):
- `?keyscrush=1` → `LofiChainOptions.keysCrush?: boolean` (default off).
- `?keyscrushbits=<n>` → `keysCrushBits?: number` (default 12, clamped 1–13 —
  above 13 the 16384-point curve can't represent the staircase), ear-tuning
  knob.
- `?keyscrushdrive=<n>` → `keysCrushDrive?: number` (default 4, linear gain,
  inverted after; must be positive finite), crunchy-vs-hissy knob.

**Watch-fors:**
- **Level on toggle** — verify no jump; makeup gain only if needed. (The async
  worklet-load concern was `Tone.BitCrusher`-specific, moot with WaveShaper.)
- **Legibility:** if 12-bit muddies chords/melody, back the bits up (13–14).
- **`evoFilter` (LP 1800) directly after the crusher** may be removing most of
  the audible quantization products — a candidate explanation for "airy, bits
  8–16 identical." Verify with the spectrum measurement before more ear-tuning.

**Acceptance:** keys gain vintage "lo-fi digital" colour while staying legible;
no harsh clicking (the drum failure mode); no level jump on toggle; fingerprint
unchanged; added CPU measured in-browser (record, not gate).

## Step 2 — Bass + beds stay clean (explicit non-goal)

Bass stays tight/clean (its whole design avoids low-end mud). Brown/rain beds
are texture, not "sampled material." **No work here; documented so it isn't
re-litigated.**

## Measurement (record, don't gate)

### Spectrum verification (2026-07-03, `crush-spectrum.ts`)

Offline band-spectrum A/B (`packages/synth-tone/scripts/crush-spectrum.ts`,
run via `profile-chain.sh <entry>`): seed 42, 24 s @ 32 kHz, rain muted,
OFF rendered twice as the significance floor (noise beds are
nondeterministic; floor ≈ ±0.8 dB, ±1.5 dB in the top band). Findings:

1. **The crush is wired and honest** — bits 4 @ drive 4 adds +14 dB
   (1.2–1.8k), +19 dB (1.8–3k), +6.6 dB (3–6k). Not a wiring bug.
2. **At 12 and even 8 bits the quantization products are below the mix's
   noise floor** — every band delta ≈ the OFF-repeat row. The ear report
   "everything above 7 sounds identical" was *correct by construction*: at
   the keys' real post-drive level, 8–13-bit quantization noise is simply
   inaudible under the beds. The bits knob only starts moving the spectrum
   somewhere below ~8 bits.
3. **What drive ≥4 audibly adds at 12 bits is clipping, not quantization**:
   +3.1 dB @ 150–300 Hz at drive 4 and +3.2 dB at drive 8 (vs −0.3 dB at
   drive 1) — harmonic distortion of chord fundamentals from hitting the
   curve's ±1 edge. "Warm saturation" flavour, not SP-1200 fuzz.
4. **evoFilter (LP 1800) is only half the story**: products leak strongly
   into 1.8–6k at low bits (−24 dB/oct is gentle) and are gone by 6 k. The
   dominant reason high-bit settings are inaudible is #2 (level), not the
   filter.

**Implication for ear-tuning:** the audible range of the bits knob at drive 4
is roughly **4–7 bits**, not 8–16. If "12-bit SP-1200" is the aesthetic
target, the *label* and the *effective* depth differ because the keys sit
below full-scale even after ×4 drive — either ear-tune within 4–7 and accept
the label mismatch, or raise drive further (which per #3 shifts the character
toward clip-saturation). Ear tests should A/B within 4–7 where the knob
demonstrably moves the spectrum.

- **Ear is primary** (Mac, headphones). A/B each flag on/off across ≥5 seeds
  incl. dense.
- **CPU:** the `WaveShaper` is a native node (no worklet, no oversampling), so
  it *can* be measured in `profile-chain.ts` if wanted, and in-browser via
  Chrome Task Manager. Expected negligible. Record it, but per the development
  principle it does not gate shipping the feel. (The earlier secure-context
  blocker was specific to `Tone.BitCrusher`'s worklet, now gone.)

## Rollout

- One flag per step, default off; bake as default only after ear-approval.
  Mirror the Phase-2 override pattern (`?keyscrush=0` to restore).
- Commit notes the aesthetic tradeoff + the A/B outcome, like Phase 2;
  co-author trailer per repo convention.

## Possible future (not now)

- **Drum grit via saturation** (not bit-crush) — soft-clip/waveshaper for
  harmonic warmth on the synthesized drums, since quantization only clicks them.
- Multiband kick crush (highs only) if we ever want kick grit without low-end
  mud.
- Fractional-rate SRR worklet if bit-crush proves too clean on the keys.
