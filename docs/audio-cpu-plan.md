# Audio DSP CPU reduction — implementation plan

> Handoff plan for a separate agent. Goal: lower the **steady-state CPU
> floor** (and bursty peaks) of the lofi audio graph so Loam holds together
> on weaker machines / under foreground compute load, **without degrading
> audio quality unless explicitly approved.**
>
> All work is in `@loam/synth-tone` (the audio chain) + a small flag plumb in
> `apps/web-demo`. **None of it touches `@loam/core`**, so the engine
> fingerprint (`packages/core/test/ember-engine.test.ts`, `Seed.from(42n)`)
> MUST NOT move — if it does, something is wrong. Verify it's unchanged.

## Background (why)

A reporter's Windows machine stutters; another Windows machine floors at
57-60% CPU, the reporter's at 100%+, a Mac at <30% — same graph. The cost is
the **always-on DSP** (the "floor"), not musical peaks. Windows' audio stack
(~2× Mac) multiplies whatever DSP we run, so cutting absolute DSP work pays
off most there. Diagnosis details: the rendering-side fixes already shipped
(`feacce7`, `5d96a87`); this plan is the audio-graph half.

Profiling facts already established (don't re-derive):
- `Tone.Reverb` uses a native **FFT** `ConvolverNode` — already optimal; cost
  scales with **IR length** and the IR is **stereo** (`OfflineContext(2,…)`).
- `Tone.Noise` plays a **cached buffer** (memory reads) → pink/brown noise is
  ~free. Rain's only cost is 2 always-on bandpass biquads.

## Guiding principles (read first)

1. **Quality-free tasks (Phase 1) ship first.** Then STOP and measure. Only
   proceed to the quality-tradeoff tasks (Phase 2) if Phase 1 misses the
   target. We may not need to trade any quality.
2. **Measure between phases** with the protocol in Phase 0. Every change gets
   a before/after floor+peak number.
3. **Engine fingerprint must not change.** Run the full test suite after each
   task. Changes here are render-side only.
4. Phase-2 (audible) changes go behind **A/B flags** so they can be judged by
   ear before commitment.

## Files

- `packages/synth-tone/src/chains/lofi.ts` — the graph (primary).
- `packages/synth-tone/src/adapter.ts` — only if a chain handle needs exposing.
- `apps/web-demo/src/main.ts` — flag plumbing + rain-toggle hook.

---

## Phase 0 — Measurement harness (do before any change)

> **Measure with `OfflineAudioContext` render-timing, NOT process CPU.** This
> is the most important instruction in this doc. We already tried whole-Chrome
> process CPU (`ps` over the tab's process tree) and it **could not resolve
> the deltas** — two A/B trials of Task 1+2 gave **+8.8%** and **−7.4%** (i.e.
> the true effect was below the ~±3-point process-CPU jitter). Don't repeat
> that. Render the graph (or a node-in-isolation) in an `OfflineAudioContext`,
> trigger representative notes, and **time `context.render()` wall-clock** —
> that's pure DSP cost with zero browser-overhead noise, and the *ratios* port
> directly to Windows even though absolute numbers don't.

> **Set expectations before you start:** that same inconclusive result implies
> Task 1+2 (polyphony caps, rain) are **nearly-free tidy-ups, not the win** —
> the floor is very likely dominated by the **always-on convolution reverb**
> (Phase 2). Measure Phase 1 honestly and do **not** declare victory after it
> without a real before/after render-time number. The reverb is the suspected
> dominant cost; the checkpoint exists to confirm whether Phase 2 is required
> (it probably is).

The CPU number that ultimately matters is Windows, which the implementing
agent likely can't reach — so rely on the offline render-time *ratios* locally
and have the owner validate absolute Windows numbers.

1. **Per-node offline profiling:** render N seconds of the full graph in an
   `OfflineAudioContext` and time it; then re-time with the reverb bypassed,
   with mono reverb, with shorter decay, and with polyphony capped. Report
   each as a % of the full-graph render time. This gives the
   decision-relevant numbers (reverb share; mono/decay/cap savings).
2. **Optional sanity check (not the primary metric):** Chrome **Task Manager**
   ("Window → Task Manager" on macOS; `Shift+Esc` on Win/Linux) floor at
   steady playback — useful for an order-of-magnitude gut check only; it
   cannot resolve sub-~5% deltas (see warning above).
3. **Voice-count instrumentation (needed for Task 1):** temporarily log the
   **max concurrent active voices per PolySynth**. Either read Tone's
   `polySynth.activeVoices` (verify the API exists in tone@14.9.17) sampled on
   an interval, or instrument the `trigger`/`releaseAll` registrations in
   `lofi.ts` to count overlapping notes per channel. Run **≥5 varied seeds for
   several minutes each** (include dense seeds) and record the max for
   `keysChord`, `keysMelody`, and `pad` separately. **Pad matters most** — its
   release is 4s (`envelope.release: 4`, lofi.ts:118), so pad notes overlap
   heavily; do not under-measure it.
4. Remove the instrumentation before shipping.

Target (tune with the owner): bring the Mac floor down meaningfully and,
ideally, get the reporter's Windows floor under ~70% with headroom for peaks.
The owner will validate Windows.

---

## Phase 1 — Quality-free (ship these first)

### Task 1 — Cap `maxPolyphony` on the 3 PolySynths  ★ highest value

**Why:** None of the PolySynths set `maxPolyphony`, so each defaults to Tone's
**32**. The keys are `FMSynth` (2 osc + 2 env per voice), the pad is
`AMSynth`. Tone pools voices and a voice's oscillators **keep running once
started** (envelope only gates amplitude), so a dense passage can leave a big
pool of idle-but-running voices inflating the floor. Capping to real need
reclaims that with **zero audible change — provided the cap ≥ actual
simultaneous voices.**

**Where:** `lofi.ts`
- `keysChord` — `new Tone.PolySynth(Tone.FMSynth, { … })` at ~line 91.
- `keysMelody` — at ~line 102.
- `pad` — `new Tone.PolySynth(Tone.AMSynth, { … })` at ~line 115.

**How:**
1. From Phase 0 voice counts, set `maxPolyphony` = observed max **+ ~50%
   margin** (floor of 8). Example *starting* guesses to replace with measured
   values: `keysChord: 12`, `keysMelody: 6`, `pad: 12`. **Do not guess-ship —
   use the measured numbers; the margin is the safety.**
2. Add `maxPolyphony: <n>` to each PolySynth options object.
3. **Verify no audible voice-stealing:** play several dense seeds; listen for
   notes being cut off / chords dropping voices. If anything cuts, raise that
   synth's cap. The pad (4s release) is the likeliest to need a higher cap.

**Acceptance:** floor (and dense-passage peak) drops in Task-Manager vs Phase-0
baseline; no audible note-stealing across the test seeds; fingerprint test
still passes.

### Task 2 — Stop the rain source when rain is off  ☆ low value, do if cheap

**Why:** `rain = new Tone.Noise('pink').start()` (lofi.ts:195) runs
continuously, muted only by `rainVol` at `-Infinity`. Rain **defaults off**
(`uiState.rainMode: 'off'`, main.ts:390), so most sessions pay for the rain
path for nothing. **Note the realistic ROI is small** — the pink noise is a
cached buffer (~free); the only saving is the **2 idle bandpass biquads +
gain** (lofi.ts:196-204). Include it for tidiness; don't expect much floor.

**How (chain side, lofi.ts):**
1. The rain level is driven via `setParam('bed.rain.level', …)` →
   `registerParam('bed.rain.level', …)` (~line 297). Add a silence threshold:
   when the *target* dB is ≤ ~`-120` (treat as "off"), `rain.stop()`; when it
   rises above the threshold and the source is stopped, **restart it**.
2. **Web Audio gotcha:** a stopped `BufferSource` cannot be restarted. Verify
   `Tone.Noise` recreates its internal source on `start()`/`restart()` in
   tone@14.9.17. If `stop()`→`start()` doesn't resume, use `rain.restart()`,
   or recreate the `Tone.Noise` on enable. Test the full off→on→off→on cycle
   audibly — rain must come back every time with no click/dropout.
3. Keep the existing fade behaviour (`RAIN_TOGGLE_FADE_MS`) — stop the source
   only **after** the fade-out completes so there's no abrupt cut.

**Crackle:** vinyl-off already stops crackle *events* (the engine's
`crackle-scheduler.ts` skips them when `vinylEnabled=false`). Only gate the
idle `crackle` `NoiseSynth` source if Phase-0 shows it runs continuously AND
it's a measurable cost — otherwise **skip** (needs new vinyl→chain plumbing
for ~nothing). Default: skip crackle.

### ▶ CHECKPOINT — measure, then decide

After Tasks 1-2: re-measure floor+peak (Phase 0). Have the **owner verify on
the reporter's Windows machine**. **If the target is met, STOP — do not do
Phase 2.** Only continue if the floor is still too high.

---

## Phase 2 — Quality tradeoffs (only if Phase 1 is insufficient)

Each is **audible**, so put it behind an **A/B flag** and get an ear
judgement before baking it in. The owner prefers **Mono reverb (Task 3) over
shortening decay (Task 4)**.

### Flag plumbing (do once, up front for Phase 2)

- Change `buildLofiChain(adapter)` → `buildLofiChain(adapter, opts?)` with
  `opts: { monoReverb?: boolean; reverbDecay?: number; monoBed?: boolean }`.
- In `apps/web-demo/src/main.ts` (`buildAudio`, the `buildLofiChain(a)` call
  ~line 417), read flags from `URLSearchParams(location.search)` /
  `localStorage` and pass them: `?monoverb=1`, `?reverbdecay=3`, `?monobed=1`.
- These are dev A/B switches; once a choice is made, bake the chosen value as
  the default and keep (or drop) the flag at the owner's discretion.

### Task 3 — Mono reverb IR  ★ owner's preferred Phase-2 lever

**Why:** the reverb IR is **stereo** (independent L/R noise,
`OfflineContext(2,…)` in Tone's `Reverb.js generate()`), so the
`ConvolverNode` does 2-channel convolution. A **mono IR ≈ halves** it. Cost:
the reverb tail collapses toward center (less stereo width) — possibly
on-aesthetic for lofi; owner judges by ear.

**How:** `Tone.Reverb` hard-codes a stereo IR and exposes no channel option,
so replace it with a **custom mono-IR convolver** as a drop-in for the `const
reverb = new Tone.Reverb({ decay: 7, preDelay: 0.02, wet: 1 })` at lofi.ts:32:
1. Create a raw `ConvolverNode` (or `Tone.Convolver`) and generate a
   **1-channel** IR: render decaying noise into a mono buffer via an
   `OfflineAudioContext(1, (decay+preDelay)*sampleRate, sampleRate)` — mirror
   Tone's `generate()` shape (noise → gain ramp from 1 at `preDelay` down over
   `decay`, exponential-ish) but **mono**. Reference: Tone's `Reverb.js`
   `generate()` (noiseL/noiseR + gain envelope) — replicate with a single
   noise source.
2. A `ConvolverNode` fed a **mono** buffer convolves both input channels with
   the same IR (centered reverb) at ~½ the cost. Keep `disableNormalization`
   consistent with Tone's default to preserve level.
3. Preserve the **send/return wiring**: output `.connect(warmth)`; all existing
   sends (`keysSend`, `padSend`, `snareSend`, `hatSend`, `chordEcho`) connect
   into it exactly as now. Wet is implicit (it's a 100%-wet return).
4. Gate behind `opts.monoReverb` (fall back to `Tone.Reverb` when false) so
   it's A/B-able. Also honor `opts.reverbDecay` for the IR length (Task 4).

**Acceptance:** reverb CPU ~halves; owner confirms the narrower tail is
acceptable by ear (Mac); Windows floor drops.

### Task 4 — Shorten reverb decay  (fallback / companion to Task 3)

**Why:** convolution cost scales with IR length; `decay: 7` → `~3` ≈ halves
it and is likely imperceptible in dense, continuous lofi (tail beyond ~3s is
low-amplitude and masked). Owner prefers Task 3, so treat this as a knob
already exposed via `opts.reverbDecay` — use it only if mono alone isn't
enough, or combine (mono + shorter ≈ ~4× cheaper).

**How:** the `reverbDecay` opt already threads into the IR generation (Task 3
mono path and/or the `Tone.Reverb({ decay })` fallback). A/B `?reverbdecay=3`,
`=2` by ear before settling on a value.

### Task 5 — Drop the brown-bed StereoWidener  ☆ small

**Why:** `brownBedWidener = new Tone.StereoWidener(0.9)` (lofi.ts:186) runs
mid/side math on the **always-on** brown bed. Removing it → mono bed (slightly
narrower) for a small always-on saving.

**How:** behind `opts.monoBed`, connect `brownBedFilter → brownBedVol`
directly (drop `brownBedWidener` from the `brownBed.chain(...)` at lofi.ts:188).
A/B `?monobed=1` by ear (bed width is subtle).

---

## Verification (after each task / before commit)

- `pnpm -r typecheck` — clean.
- `pnpm -r test` — all pass; **`ember-engine.test.ts` fingerprint unchanged**
  (these changes are render-side; if the fingerprint moves, investigate).
- `pnpm --filter web-demo build` — succeeds.
- `npx biome check <changed files>` — clean.
- **Manual A/B:** Mac for ears (quality), Chrome Task Manager floor+peak for
  CPU; owner re-tests Phase-1 (and any Phase-2) on the reporter's Windows
  machine.

## Commit guidance

- Phase 1 as its own commit(s): "perf(synth-tone): cap polyphony / stop idle
  rain source — lower DSP floor, no audible change."
- Phase 2 (if done) separately, noting the audible tradeoff and the A/B
  outcome that justified it.
- Co-author trailer per repo convention.

## Sequencing summary

1. Phase 0 harness + baseline numbers (incl. per-synth voice counts).
2. **Task 1 (polyphony caps)** → measure.
3. **Task 2 (rain gating)** → measure. → **CHECKPOINT: stop if target met.**
4. Only if needed: flag plumbing → **Task 3 (mono reverb)** → measure/ear →
   Task 4 (decay) / Task 5 (mono bed) as required.

---

## Progress & decisions (living — updated 2026-07-01)

Measurement harness lives at `packages/synth-tone/scripts/profile-chain.ts`
(run `profile-chain.sh`; offline `OfflineAudioContext` render-timing via
`node-web-audio-api`). Ratios port to Windows; absolutes don't.

### Cost composition (measured, Mac)

- **Note synthesis (FM/AM voices) ≈ 70% of total DSP.**
- Always-on floor ≈ 30%, of which reverb ≈ 43% (≈ 13% of total).
- Implication: floor-side work (Phases 1–2) caps out around **~12%**. Only the
  global sample rate scales the dominant 70%.

### Shipped

- **Phase 1** (`fdba5f4`): polyphony caps (chord 18 / melody 8 / pad 8, from
  measured max 12/4/4) + rain-source gating. ~free tidy-up, no audible change.
- **Phase 2 baked as defaults** (`ab39194`): mono reverb + `reverbDecay 3`
  (was 7) + mono bed. Ear-confirmed identical (removed reverb tail is all
  below −66 dB); ~12% DSP cut. Overridable for regression A/B via
  `?monoverb=0` / `?reverbdecay=7` / `?monobed=0`.
- **Sample rate → 32 kHz default** (`2dc074d`, defaulted after ear-check). The
  real CPU lever — 32 kHz −21%, 22.05 kHz −35% whole-graph. Global + applied on
  first adapter construction (needs a page reload to change). 32 kHz is
  transparent (16 kHz Nyquist, above most hearing + lofi's rolled-off highs);
  22.05 kHz stays opt-in (audible dulling + long-chord phase artefacts).
  Override via `?samplerate=44100` / `=22050` (bounds 8k–96k).

### Status (2026-07-01)

**CPU-first workstream complete and shipped/deployed.** Net effect on the live
site vs the original chain: **~30% less DSP**, all ear-transparent (Phase 1 ~0%
typical + Phase 2 ~12% + 32 kHz ~21%, stacked). The engine fingerprint is
unchanged throughout — every change was render-side.

- **Sample-rate mechanism confirmed honoured** by Chrome:
  `new AudioContext({ sampleRate: 32000 }).sampleRate` returns `32000` (not the
  44100 hardware rate), so the graph genuinely renders at 32 kHz and resamples
  to hardware at output (the "resampled at 44.1k" seen in `chrome://media-
  internals` is that expected output stage, not a failure).
- **Open item — real-world CPU payoff on the reporter's Windows machine.** Not
  yet measured; the owner lacks access and is awaiting a GitHub-issue response.
  Expectation: at least the offline ratios (reverb share is larger on Windows'
  ~2× audio stack), though Windows process-CPU jitter (±3–5 pts) may under-read
  the true delta — the clean A/B is deployed 32 kHz vs `?samplerate=44100` in
  the same session. This is the only thing gating "done" for CPU.

### Direction: CPU first, then aesthetic (two SEPARATE workstreams)

- **CPU = global context sample rate.** One rate per Web Audio context; you
  cannot run parts at different real rates without rewriting synths as low-rate
  AudioWorklets. 32 kHz (Nyquist 16 kHz) is transparent-to-authentic for lofi.
- **Per-part downsampling is AESTHETIC only, not a CPU optimization.** In Web
  Audio it's a decimation/bitcrush *effect* (Tone.BitCrusher = sample-and-hold
  at full rate) → it *adds* CPU. Anchor drums to **26.04 kHz (SP-1200)**, the
  canonical boom-bap crush, not a generic high end; keys ~32 kHz; bass/beds
  clean. Fits the roadmap — `lofi.ts` already flags bitcrush / wow-flutter /
  tape-hiss as missing authentic textures. The two reinforce: a low global
  rate is authentic (classic-sampler territory), and per-part crush layers on
  the grit a clean band-limit lacks.
