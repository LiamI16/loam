# `@loam/synth-tone` — adapter notes

> Decisions baked into the Tone.js audio adapter. Lives separately from the
> protocol spec (`docs/event-protocol.md`) because these are *adapter
> implementation* choices, not *contract* constraints — different adapters
> (raw Web Audio, Faust, native) could legitimately make different calls.
>
> This doc grows alongside the adapter. Stage 3 lays down the first
> entries.

---

## 1. Scheduling model

A `setInterval`-driven pump that polls the engine every 25 ms and asks for
events 200 ms ahead of the audio clock. Numbers are constants in
`packages/synth-tone/src/adapter.ts`.

```
audio time ──────────────────────────────────────────────►
              ↑     ↑     ↑     ↑     ↑     ↑     ↑   pump (every 25 ms)
              │─────│─────│─────│─────│─────│─────│
              ▼─────▼─────▼─────▼─────▼─────▼─────▼
              ──[ 200 ms of pre-scheduled events ]──
```

**Why these numbers:**

- 200 ms lookahead is the standard Web Audio scheduling number — comfortably
  absorbs a 50–150 ms JS-thread stall (GC, layout) without audio underrun.
- 25 ms pump interval is well under the lookahead, so even a missed pump
  leaves plenty of margin.
- Both are constants today, not config. Stage 5+ may want them tunable per
  surface (Obsidian on a heavy vault might need 400 ms).

**Failure mode to know:** if the JS thread stalls > lookahead, events arrive
in the past and Web Audio plays them late or drops them. Acceptable for
study music in a backgrounded tab; would be a problem for an active editor.

## 2. We deliberately don't use Tone.Transport

The prototype HTML (`ember-generative-study.html`) uses `Tone.Transport`
extensively — `Tone.Transport.swing`, `Tone.Sequence`, `Tone.Loop`, bar/beat
addressing. The adapter ignores all of it and schedules directly against
`Tone.now()` (raw `AudioContext.currentTime`).

**Why:** the engine already emits explicit `time` values in engine-time
seconds. Transport adds bar/beat coordinate translation that the engine
doesn't need, and its musical helpers (`swing`, `Sequence`) live at a layer
of abstraction we want to own in core.

**Implication:** swing, micro-timing, tempo modulation, and pattern looping
are all now **core's responsibility**, not Tone's. Consistent with
`event-protocol.md` §9.2 (humanization belongs in core). Trade is that we
re-implement what Transport gave us for free, but in exchange the adapter
stays small (~100 LoC) and the engine is testable in plain Node without
mocking Tone.

## 3. `TickEvent`s fire UI listeners synchronously, in the pump

`onTick` callbacks run immediately when the adapter pulls a `TickEvent` out
of the engine — *not* at the event's audio-time. So visual updates can lead
the audible beat by up to 200 ms (the lookahead).

**Acceptable** for slow ambient flicker like the ember pulse. **Will need
fixing** if we ever want tight audio-visual sync. Two options when we get
there:

- `Tone.Draw.schedule(callback, audioTime)` — Tone's helper for sample-
  accurate UI scheduling.
- `setTimeout(callback, (audioTime - Tone.now()) * 1000)` — works if we
  don't want to import `Tone.Draw`.

## 4. `ParamEvent` dispatch is a stub (Stage 4 prereq)

The adapter accepts `ParamEvent` and silently no-ops. Stage 3's vamp emits
none, so it doesn't matter yet. Stage 4 (porting the prototype's slow
filter sweep, master warmth slider, etc.) requires a real implementation.

**To build:** a dotted-path target registry. `'fx.chorus.depth'` resolves
to `chorus.depth`, `'master.warmth'` resolves to a registered filter's
cutoff, etc. Adapter walks the path, finds the Tone `Param` node, calls
`.rampTo(value, rampMs / 1000, audioTime)`. Unknown targets log a warning
and drop (same pattern as unknown channels). Per
`event-protocol.md` §9.5, every new dynamics knob needs a matching entry
here.

## 5. The signal chain lives in the demo app, not the adapter

`apps/web-demo/src/main.ts` instantiates the FM Rhodes + chorus + reverb.
The adapter is dumb on purpose — it only knows about channels (synth
references) and parameters (parameter references). The app composes voices
and registers them.

**Trade-off:** clean separation. Adapter is portable; lo-fi character is a
preset, not a hard-coded behavior.

**Risk:** **duplication when the Obsidian plugin lands**. The same Rhodes-
+ -chorus-+-reverb wiring would have to be re-instantiated in
`packages/obsidian`. **Plan:** extract a shared `chains/lofi.ts` helper
(probably in `@loam/core` or a new `@loam/presets-lofi`) before Stage 6
that returns the standard signal chain so both surfaces share it.

## 6. PolySynth voice count is left at default

Tone's `PolySynth` defaults to 32-voice polyphony. The Stage-3 vamp uses 5
notes at a time, well under any limit. Once melody arrives and a per-bar
re-voicing layer kicks in, we may exceed 32 transient voices in a busy
moment.

**Failure mode:** voice-stealing — newest note starts, oldest is stolen.
Sounds like a soft cut, not a crash. Not a Stage-3 problem; worth knowing
when we land melody.

## 7. `stop()` kills audio in ~10 ms via master-fade, not by cancelling events

The naive `stop()` (just clear the pump) leaves a ~5-second audible tail
because each chord triggers `triggerAttackRelease(freq, fullDuration, ...)`
and the synth is then committed to the envelope's decay + release tail.
Pending events in the 200 ms lookahead also still fire.

Current `stop()` instead:

1. Clears the pump (no new events generated).
2. Ramps `Tone.getDestination().volume` to `-Infinity` over 10 ms
   (`STOP_FADE_SEC`) — fast enough to feel instant in A/B testing, slow
   enough to avoid a click. 30 ms was perceptibly delayed; below ~5 ms
   risks a discontinuity click depending on signal phase.
3. After the fade, calls `releaseAll()` on each registered synth so voice
   state doesn't leak.

The absolute floor on perceived stop latency is the AudioContext's
`outputLatency` (hardware-dependent, usually 5–30 ms on macOS) plus DOM
event dispatch (~5–10 ms). To inspect on a given machine:
`Tone.getContext().rawContext.outputLatency`.

Pre-scheduled events in the lookahead window still trigger but are silent
under the muted master.

Trade: this touches the **global `Tone.Destination`**, not an adapter-owned
master Gain. Fine while there's only one adapter (which is the only case
for v1), but technically a second adapter sharing the AudioContext would
see its output muted by the first one's `stop()`. Stage 4 will introduce a
master warmth filter anyway — natural moment to add an adapter-owned
master Gain (`adapter.output`) and route channels through it instead of
straight to destination. The fade then targets the adapter master, not the
global destination.

## 8. Two-node master pipeline (Volume + mute-gate Gain)

Stage 4 introduced an adapter-owned master bus replacing the global-
destination touching from Stage 3:

```
[channels] ─► warmth ─► master (Tone.Volume, dB) ─► out (Tone.Gain, 0/1) ─► destination
                                                  ▲
                                        adapter's start/stop fades this
```

- **`master`** (Tone.Volume) — user-facing volume in dB. The volume slider
  drives `master.volume.value` via `setParam('master.volume', dB)`. Stays
  put across play/pause.
- **`out`** (Tone.Gain) — adapter-internal mute gate. Fades 0↔1 on
  start/stop via explicit `linearRampToValueAtTime`, *not* Tone's
  `rampTo` — the latter can asymptote rather than reach exactly 0,
  leaving always-on noise beds (brown bed, rain) faintly audible during
  pause. Bit me in Stage 4 testing; the explicit AudioParam call is the
  reliable fix.

Texture beds (rain, vinyl crackle, brown bed) connect directly to
`master`, bypassing the warmth filter — that way "warmth = dark" muffles
the music only, not the ambient layer. Departure from the prototype.

## 9. `latestScheduledAudioTime` watermark

Tone's per-voice synths track "last scheduled time" internally and reject
events scheduled before it. After stop+swap+start within the 200 ms
lookahead window (e.g. mid-playback reseed or BPM change), pre-scheduled
events from the previous run can still be in the future — new engine
events anchored at "now" land *before* them and Tone throws.

Fix: the adapter remembers the furthest absolute audio time any pump has
reached (`latestScheduledAudioTime`). On `start()`, the new
`startAudioTime` is `max(Tone.now(), latestScheduledAudioTime + 5 ms)`.
First-ever start: watermark is 0, no offset. Subsequent restarts within
the lookahead: anchor just past pending events. Inaudible because the
master gate is faded down during the swap anyway.

## 10. Channels register a `(trigger, releaseAll?)` callback pair

Stage 3's first cut had channels register a `Tone.PolySynth` directly.
Stage 4's chain ports drums (`MembraneSynth`, `NoiseSynth`) and vinyl
crackle, which have different `triggerAttackRelease` signatures and no
useful pitch. Forcing a uniform synth type would either lose pitch info
on `PolySynth` or wedge non-pitched synths into a misleading shape.

So `ChannelRegistration` is now:

```ts
interface ChannelRegistration {
  trigger: (event: NoteEvent, audioTime: number) => void;
  releaseAll?: () => void;
}
```

The chain knows what each voice expects and supplies a small adapter
closure. The adapter dispatches and is otherwise dumb. `releaseAll` is
optional because percussion voices don't sustain.

## 11. Param dispatch via setter callbacks (not raw Tone.Param)

Same pattern as channels — `registerParam` takes a `{set, ramp}` pair, not
a Tone Param reference. Avoids the generic `Param<unit>` type incompatibility
(Frequency vs Gain vs Decibels) leaking into the adapter, and lets each
chain wrap its Params with whatever units make sense locally. Adapter
always speaks numbers; chains translate at the boundary.

## 12. Adapter currently runs only in a browser

`packages/synth-tone/tsconfig.json` includes `"DOM"` in `lib` because the
adapter uses browser globals (`console.warn`, `setInterval`). The adapter
isn't a portable library — it specifically targets browser Web Audio. A
hypothetical `synth-node` adapter for offline rendering would be a separate
package.
