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
