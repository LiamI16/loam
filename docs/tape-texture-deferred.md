# Tape texture — deferred & out-of-scope

> Companion to [tape-texture.md](tape-texture.md). Items intentionally **not**
> in the launch tape-texture stage, with the reason and the resume conditions,
> so none of these get re-litigated or accidentally pulled into the
> implementation.

## Out of scope — do not build in this stage

### Global / master bitcrush or sample-rate reduction
Excluded **by evidence**, not preference. See `docs/sampler-character.md`:
quantizing pure-synthesis material yields tonal artifacts (clicky on
synthesized noise/drums, buzz on sustained tonal chords) that additive noise
can't mask. A whole-mix crush hits both failure modes at once. The crush story
belongs entirely to the parked, keys-only `keysCrush` workstream.

### Engine-driven "tape condition" drift (coupled fBm)
The intent is one slow fBm axis (~minutes) drifting saturation drive +
wow/flutter depth + hiss level together, so the whole tape character breathes
(Stage 7b listen-distance spirit). **Deferred because it is a render-side
change**: emitting drift `ParamEvent`s requires a new fBm stream / seed child
in `@loam/core`, which **moves the engine fingerprint** — a deliberate
seed-format break needing `docs/seed-format.md` §7.3a documentation. The
launch stage is adapter-only and keeps the fingerprint frozen; it *exposes*
the params (`fx.tape.saturationDrive`, `fx.tape.wowDepth`, `bed.hiss.level`)
so the driver is a clean drop-in later.
**Resume when:** post-launch, bundled with any other planned seed-format break
so the fingerprint moves once. Add the fBm stream + one-shot/ramped
ParamEvents, couple the three targets to a shared stream, document §7.3a.

### User-facing tape controls
Tape character is **baked / non-user** for v1 (foundational color, like the
brown bed — not an environmental toggle like rain). No new UI. The UI work is
already complete and we don't want a "tape amount" slider competing with
seed-identity (same reasoning that removed the density/BPM sliders).
**Resume when:** only if user feedback specifically asks for it.

## Quality upgrades (v2 tuning, not launch-blocking)

### C2 — noise-driven random-walk wow/flutter
The launch build uses summed incommensurate sine LFOs (C1) — convincingly
aperiodic and cheap. A noise source → heavy lowpass → scaled into
`delay.delayTime` gives *genuine* aperiodic mechanical drift (most authentic).
Deferred for its harder-to-tune level path (mapping filtered-noise amplitude
to cents). **Resume when:** if C1 reads as too regular after extended
listening.

### Asymmetric (even-harmonic / "tube-warm") saturation
The launch curve is symmetric `tanh` (odd harmonics, clean). A slightly
asymmetric curve adds even harmonics ("fuller/warmer"), but introduces a DC
offset that needs a DC-blocking highpass after the shaper. **Resume when:** a
tuning pass wants more "tube" character than symmetric tanh gives.

### Stereo-decorrelated hiss
Launch hiss is mono (CPU, matches `monoBed` default). Decorrelated L/R noise
would widen it. Trivial but non-essential. **Resume when:** if the bed feels
narrow after the rest lands.

## Related §9 texture rows NOT in this stage
From `docs/lofi-study.md` §9, deliberately left for later texture work:
- **Vinyl hum** (60/120 Hz sines, very quiet) — separate small bed.
- **Sidechain ducking** (pump under kick) — dynamics-adjacent, its own stage.
- **Vinyl crackle responsive to dynamics** — already tracked under
  `stage-list.md` "Open scope questions."

## keysCrush resume note (cross-reference)
The parked keysCrush effort (chord-buzz, `docs/sampler-character.md`) has a
second resume candidate surfaced during this design pass, worth logging
alongside the existing "crush the melody path only" candidate:
**pre-dirty the signal before the crush** — run saturation → a light noise
bed → *then* crush, so the SRR image-tones fold into an already-occupied
spectrum and get masked (the mechanism sampled material gets for free). Not
part of the tape-texture stage; recorded here so it isn't lost.
