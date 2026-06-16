# Engine ↔ Adapter event protocol

> The interface across the core/adapter split from `docs/handoff.md`.
> `@loam/core` emits typed events; the synth adapter (`packages/synth-tone`)
> consumes them and renders sound. Core knows nothing about Tone.js or Web
> Audio; the adapter knows nothing about music theory or generation.
>
> First-draft contract — expected to evolve as the engine grows. Adding new
> event kinds is safe (TypeScript discriminated union); changing or
> removing existing kinds is a breaking change.

---

## 1. The event types

```ts
type EngineEvent =
  | NoteEvent
  | ParamEvent
  | TickEvent;

interface NoteEvent {
  kind: 'note';
  channel: string;          // 'rhodes' | 'pad' | 'kick' | 'snare' | 'hat' | 'bass' | ...
  pitch: number;            // MIDI note number, 0–127. C4 = 60.
  velocity: number;         // 0..1
  durationMs: number;       // hold time in ms
  time: number;             // engine-time in seconds, when this event fires
}

interface ParamEvent {
  kind: 'param';
  target: string;           // dotted path: 'warmth.cutoff', 'rhodes.volume', 'reverb.wet'
  value: number;            // target value (units depend on the target)
  rampMs?: number;          // glide duration; default 0 = instantaneous
  time: number;
}

interface TickEvent {
  kind: 'tick';
  bar: number;              // bar count since play start (0-indexed)
  beat: number;             // beat within bar (0..3 for 4/4)
  time: number;
}
```

---

## 2. Time semantics

`time` is **engine-time** — seconds, monotonic, in the same timebase as
the audio output. Derived from `AudioContext.currentTime` and frozen
during pause. See `docs/seed-format.md` §5 for the related state-
serialization implications.

Engine-time is deliberately *not*:

- Wall-clock time (`Date.now()`)
- DOM frame time (`requestAnimationFrame`)
- `setTimeout` time

Each of those drifts relative to the audio hardware. Engine-time is what
Web Audio actually schedules against, so it's the only timebase that
yields sample-accurate playback.

---

## 3. Lookahead scheduling

Web Audio is sample-accurate **only if you schedule events ahead of when
they should play.** The standard pattern:

- The engine runs an internal scheduler loop, typically every 25–50 ms.
- Each tick, the engine generates all events that should fire within the
  next 100–200 ms window of engine-time.
- Events are handed to the adapter with their target `time` set to the
  exact engine-time of fire.
- The adapter immediately translates each into a Tone.js call with that
  time as the schedule argument.
- Web Audio handles the actual sample-accurate firing.

Even if the JS thread pauses for 50 ms (GC, layout), already-scheduled
events still play on time. The lookahead window has to be larger than the
worst expected pause; 100–200 ms is the conventional safe choice.

---

## 4. Channel naming

Channels are strings, not enums, so the engine can introduce new ones
without an adapter change being a blocking dependency. The adapter
maintains a registry mapping channel names to synth instances; unknown
channels are silently dropped with a warning. Reserved channel names for
v1:

| Channel | Instrument |
|---|---|
| `rhodes` | FM/wavetable keys (chords + melody for now) |
| `pad` | Soft AM pad |
| `kick` | Membrane kick |
| `snare` | Noise snare |
| `hat` | Filtered noise hat |
| `bass` | Sub bass (currently absent — added later) |
| `bell` | Sparse bell-tone ornament voice |

The melody and chord voicings both go through `rhodes` until there's a
reason to separate them — the prototype does the same.

---

## 5. Parameter target paths

`ParamEvent.target` is a dotted path. The adapter resolves it. First-draft
namespaces:

| Prefix | Meaning |
|---|---|
| `master.*` | Master bus (`master.volume`, `master.warmth`, `master.reverbWet`) |
| `<channel>.*` | Per-channel (`rhodes.volume`, `pad.attack`, `kick.pitch`) |
| `fx.*` | Effects (`fx.chorus.depth`, `fx.evoFilter.cutoff`, `fx.crackle.density`) |
| `bed.*` | Texture beds (`bed.rain.level`, `bed.vinyl.level`, `bed.brown.level`) |

Like channel names, target paths are strings — adapter rejects unknown
targets with a warning, doesn't crash.

---

## 6. Event ordering

- The engine emits events **in non-decreasing `time` order** within a
  scheduler tick. The adapter may rely on this.
- Two events at the same `time` may be emitted in any internal order; the
  adapter schedules them all for the same audio frame.
- `TickEvent`s are emitted at the bar boundary's time but may arrive
  intermixed with adjacent `NoteEvent`s. UI consumers should not assume
  `tick` is the first event of its frame.

---

## 7. What the protocol deliberately doesn't include

- **No audio buffers.** Core never sees PCM.
- **No frequency values.** Pitches are MIDI integers; the adapter converts
  to Hz at the boundary (Tone.js takes either, but integers are easier to
  test).
- **No envelope curves or effect chains.** Those live in the adapter as
  fixed signal-chain choices; core only sends parameter *values*.
- **No "section" or "transition" events.** Form-scale changes are
  expressed as ordinary `ParamEvent`s with longer `rampMs`. The protocol
  has no notion of structure.
- **No metadata or annotations.** If the engine wants to log "ornament
  fired" it does so out-of-band (e.g. dev console), not as an event.

---

## 8. Transport / control

Separate from the event stream, the adapter exposes a control surface:

```ts
interface AudioAdapter {
  start(): Promise<void>;       // resume AudioContext, start Transport
  pause(): void;
  resume(): void;
  stop(): void;
  setEventSource(source: EventSource): void;  // subscribe to engine events
  registerChannel(name: string, synth: Tone.AudioNode): void;
  setMasterVolume(v: number): void;
}
```

The engine has the symmetric counterpart:

```ts
interface Engine {
  start(time: number): void;    // engine-time = 0 at this audio-time
  pause(atEngineTime: number): void;
  resume(atEngineTime: number): void;
  stop(): void;
  events(): AsyncIterable<EngineEvent>;  // or push subscription
  setSeed(seed: bigint): void;
}
```

These shapes are first-draft — the actual API will firm up during Stage 2
of `current-stage-list.md`.

---

## 9. Design assumptions baked in

A handful of contracts inherited from the first-draft types that affect
musical and architectural choices downstream. Surface here so they don't
have to be rediscovered.

### 9.1 Velocity is linear (0..1), not perceptually curved

`NoteEvent.velocity` is a raw 0..1 number. Human loudness perception is
roughly logarithmic — a linear-mapped synth makes `0.7` and `0.5` sound
nearly identical, which reads as "no dynamics" even when the engine is
deliberately varying velocity.

**Implication:** the adapter must apply a per-channel velocity curve
(commonly `v²` for keys, gentler for percussion). Tone.js does not do this
automatically. Until it's added in the adapter, dynamics will feel
mechanical regardless of how alive the engine's note generation is.

### 9.2 Velocity humanization lives in core, not the adapter

The protocol delivers exactly what core emitted. Adapters don't add jitter,
swing, or velocity variation on their own. If core sends the same velocity
for every snare hit, every snare hit will play at that velocity forever.

**Implication:** the "two hits are never at the same velocity" rule (and
all per-event humanization — micro-timing, ornament jitter, ghost-hit
variation) has to be implemented in core's emit logic using its own `Rng`.
The adapter is dumb by design.

### 9.3 Pitch is integer MIDI — no per-note detune

`NoteEvent.pitch: number` is 0..127, 12-TET, integer semitones. No field
exists for per-note pitch offset.

**Implication:** tape wow/flutter, vibrato, and pitch drift are *global*
parameter effects in the current design — driven by `ParamEvent`s on a
filter/pitch bus, not by per-note pitch jitter. That's authentic enough for
v1 lofi. If we ever want per-hit pitch authenticity (different wobble on
every Rhodes note, microtonal experimentation, sample-accurate vibrato),
the protocol needs an optional `detuneCents?: number` on `NoteEvent`.
Strictly additive — won't break existing consumers when added.

### 9.4 Notes are fire-and-forget; duration is baked in

`durationMs` is set when the `NoteEvent` is emitted and cannot be changed.
There is no `NoteOffEvent`. The adapter schedules attack and release
together.

**Implication:** "play a pad and release it whenever the next chord change
happens" can't be expressed dynamically — the engine has to *predict* the
chord-change time and bake the duration in at emit time. For deterministic
scheduling (the engine schedules ahead anyway) this is fine. Forecloses
"hold indefinitely, release on cue" without a protocol extension.

### 9.5 Every dynamic knob = one ParamEvent target + one adapter route

The protocol decouples *which* parameter (a string path like
`'fx.chorus.depth'`) from *how* it's actually rendered. Beautiful for
portability and core/adapter separation; means each of the ~50 knobs in
`lofi-study.md` §12 needs a matching entry in the adapter's target
registry.

**Implication:** adapter complexity grows linearly with knob count. Each
entry is one line of glue (look up `Tone.Param`, call `rampTo`), but
forgetting one means a `ParamEvent` silently drops with a warning instead
of producing sound. Plan to surface unknown-target warnings prominently
during dev so this stays visible.

### 9.6a Engine is purely pull-based — no background work in core

The `Engine` interface (`packages/core/src/engine.ts`) exposes only
`scheduleUntil(t)` and `reset()`. There is no internal ticker, no
background task, no async work. The adapter drives everything by polling.

**Implication:** every generation decision must be computable at pump-time
from the cursor and the engine's persistent state. This works fine for
event-based generation (chord changes, note triggers, ornament firings) but
**doesn't accommodate continuous background processes** — e.g. integrating
a Lorenz attractor on its own fine-grained clock independent of when the
next event happens to fire.

The work-around when we need it: lazily advance such state at the start of
each `scheduleUntil` call, integrating from the previous cursor to the new
one in fixed sub-steps. Cheap because we're doing it at scheduling rate
(40 Hz), not audio rate. Worth knowing in case the design ever bumps into
the limit.

### 9.6b `scheduleUntil` is forward-only past the cursor

Calling `scheduleUntil(t)` with `t <= cursor` is a no-op. The only way to
revisit emitted events is `reset()`, which goes back to time 0.

**Implication:** exact pause/resume — where the engine resumes producing
the *same* events it would have produced without the pause — needs either
(a) the adapter to remember which events were already dispatched to Web
Audio, or (b) the engine to support `rewindTo(t)`. Neither exists yet;
Stage 3 doesn't pause. Will matter at the first real pause implementation.

### 9.6c Engine options are a shared mutable object across sub-schedulers

Stage 4's `EmberEngine` composes four sub-schedulers (chord, drum, melody,
crackle) and constructs *one* `ResolvedEmberOptions` object that's passed
by reference to all of them. `engine.setOption(name, value)` mutates the
shared object in place; sub-schedulers read fresh on every tick.

**Implications:**

- Sub-schedulers must read `this.opts.x` on each call, not cache values
  derived from options at construction. The Stage 4 schedulers cache
  `secondsPerStep` / `secondsPerBeat` / `secondsPerChord` though — meaning
  **`bpm` is effectively immutable for the life of an engine instance**.
  Live BPM change requires rebuilding the engine entirely (and the demo's
  BPM slider does exactly that via swap-engine on `change`).
- The reference-sharing discipline is invisible in the type system. If
  any sub-scheduler ever shallow-copies its options, live mutations stop
  propagating. Worth noting in any new sub-scheduler review.

### 9.6d Sub-scheduler `reset()` re-derives `Rng` from the seed

Each Stage 4 sub-scheduler stores its `Seed` (not just an `Rng`) and on
`reset()` builds a fresh `Rng = seed.rng()`. So resets are
*reproducible* — the first events after reset are identical to the first
events after construction. This is what makes "stop then start with the
same seed → same opening event sequence" true.

If a sub-scheduler were to store the `Rng` directly and reset only its
cursors, the Rng would carry forward and "reset" wouldn't actually
reset — the seed-determinism contract on resets would break silently.

### 9.6e `Channels.BELL` is temporarily reused for vinyl crackle

Stage 4's `CrackleScheduler` emits on `Channels.BELL` because the lo-fi
chain registers the crackle NoiseSynth there. Stage 5's ornament work
will:
1. Add a dedicated `Channels.VINYL` (or similar) for crackle.
2. Free `Channels.BELL` to mean what its name suggests — a soft bell-tone
   ornament voice per `docs/ornaments.md` §3.

Anything referring to "BELL" today should be treated as a Stage-4-only
alias.

### 9.6 Channels are strings (no compile-time check)

`channel: string` on `NoteEvent` allows new channels without an adapter API
change, but a typo (`'rhoded'` instead of `'rhodes'`) compiles fine and
results in silence with a runtime warning.

**Implication:** worth exporting a canonical `Channels` const from
`@loam/core` once the set stabilizes, so consumers can use
`Channels.RHODES` and get autocomplete. Until then, mind the spelling.
