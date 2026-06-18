/**
 * Dev-time CLI: render a snippet of engine output for offline analysis.
 *
 * Usage:
 *   node --experimental-strip-types scripts/render-snippet.ts \
 *     --seed 42 [--bpm 74] [--seconds 16] [--start 0] [--ending t]
 *
 *   # Multi-seed comparison:
 *   node --experimental-strip-types scripts/render-snippet.ts \
 *     --seeds 42,1,2 --seconds 12
 *
 * The output is plain text grouped bar-by-bar, channel-aware, with slot
 * annotations. Designed to be pasted into an LLM chat for "look at this
 * snippet and tell me what's musically off" analysis — the artifact
 * approach to fighting ear fatigue (see docs/seed-identity.md +
 * stage-list.md discussion 2026-06-17).
 *
 * Not built or distributed — intended for development use only.
 */

// Imports from the built dist so Node can resolve `.js` extensions
// without needing a transpiler. Build first: `pnpm --filter @loam/core build`.
import { EmberEngine, Seed } from '../dist/index.js';
import type { EngineEvent } from '../dist/index.js';

interface Options {
  seeds: bigint[];
  bpm?: number;
  seconds: number;
  start: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { seeds: [], seconds: 16, start: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--seed' && next) {
      opts.seeds.push(BigInt(next));
      i++;
    } else if (a === '--seeds' && next) {
      opts.seeds.push(...next.split(',').map((s) => BigInt(s.trim())));
      i++;
    } else if (a === '--bpm' && next) {
      opts.bpm = Number(next);
      i++;
    } else if (a === '--seconds' && next) {
      opts.seconds = Number(next);
      i++;
    } else if (a === '--start' && next) {
      opts.start = Number(next);
      i++;
    }
  }
  if (opts.seeds.length === 0) opts.seeds = [42n];
  return opts;
}

type NoteEvent = Extract<EngineEvent, { kind: 'note' }>;
type ParamEvent = Extract<EngineEvent, { kind: 'param' }>;

function formatTime(t: number): string {
  return t.toFixed(3).padStart(7, ' ');
}

function renderSeed(seedValue: bigint, opts: Options): string {
  const lines: string[] = [];
  const engineOpts = opts.bpm ? { bpm: opts.bpm } : {};
  const engine = new EmberEngine(Seed.from(seedValue), engineOpts);
  const all = engine.scheduleUntil(opts.start + opts.seconds);
  const events = all.filter(
    (e) => e.time >= opts.start - 0.01 && e.time <= opts.start + opts.seconds + 0.01,
  );
  const bpm = engine.getOptions().bpm;
  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = secondsPerBeat * 4;

  lines.push(`============================================================`);
  lines.push(`SEED ${seedValue}`);
  lines.push(`BPM ${bpm}  |  bar = ${secondsPerBar.toFixed(3)}s  |  beat = ${secondsPerBeat.toFixed(3)}s`);
  lines.push(`Window: ${opts.start.toFixed(3)}s → ${(opts.start + opts.seconds).toFixed(3)}s`);
  lines.push(`============================================================`);

  // Partition note events into channels and pad-slot markers.
  const noteEvents = events.filter((e): e is NoteEvent => e.kind === 'note');
  const paramEvents = events.filter((e): e is ParamEvent => e.kind === 'param');

  // Slot starts = times where the pad fires (two pad notes share a time
  // at each slot boundary).
  const padTimes = new Set<number>();
  for (const e of noteEvents) if (e.channel === 'pad') padTimes.add(e.time);

  // For each pad-emission time, also extract the rhodes voicing fired
  // at the same time so we can annotate "archetype + voicing" inline.
  // Voicing thickness = count of distinct rhodes pitches at that time.
  const padTimesSorted = [...padTimes].sort((a, b) => a - b);
  const slotAnnotations = padTimesSorted.map((t) => {
    const rhodesAtT = noteEvents
      .filter((e) => e.channel === 'rhodes_chord' && Math.abs(e.time - t) < 1e-6)
      .map((e) => e.pitch)
      .sort((a, b) => a - b);
    const padAtT = noteEvents
      .filter((e) => e.channel === 'pad' && Math.abs(e.time - t) < 1e-6)
      .map((e) => e.pitch);
    const padRoot = padAtT[0];
    return { time: t, voicing: rhodesAtT, padRoot, thickness: rhodesAtT.length };
  });

  // Group events by quantized 16th-step time so simultaneous attacks land
  // on the same row. Quantization step = secondsPerBeat / 4.
  const step = secondsPerBeat / 4;
  const eps = step * 0.05;
  const buckets = new Map<number, NoteEvent[]>();
  for (const e of noteEvents) {
    // Round to nearest step boundary; events that don't align (e.g.,
    // pickup at 3.5 beats, sync at beat 2.5, hat micro-timing) get
    // rendered at their actual offset.
    const bucketKey = Math.round((e.time - opts.start) / step);
    const arr = buckets.get(bucketKey) ?? [];
    arr.push(e);
    buckets.set(bucketKey, arr);
  }

  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
  // Walk slot annotations as we walk buckets, inserting annotation
  // lines when we cross a slot boundary.
  let slotIdx = 0;
  let currentBar = -1;
  for (const key of sortedKeys) {
    const bucket = buckets.get(key)!;
    const time = opts.start + key * step;
    const barIdx = Math.floor(time / secondsPerBar + 1e-6);
    const beatInBar = (time / secondsPerBeat) % 4;

    // Slot annotation
    while (
      slotIdx < slotAnnotations.length &&
      slotAnnotations[slotIdx].time <= time + eps
    ) {
      const s = slotAnnotations[slotIdx];
      lines.push(
        `  ───── SLOT @ ${formatTime(s.time)}s  pad-root=${s.padRoot}  voicing=[${s.voicing.join(',')}] (${s.thickness} voices)`,
      );
      slotIdx++;
    }

    // Bar separator
    if (barIdx !== currentBar) {
      lines.push(`[bar ${barIdx}] ↓`);
      currentBar = barIdx;
    }

    // Channel-aware label per bucket
    const byChannel = new Map<string, NoteEvent[]>();
    for (const e of bucket) {
      const arr = byChannel.get(e.channel) ?? [];
      arr.push(e);
      byChannel.set(e.channel, arr);
    }
    const labels: string[] = [];
    for (const [ch, evs] of byChannel) {
      const pitches = evs.map((e) => e.pitch);
      if (ch === 'hat' || ch === 'kick' || ch === 'snare' || ch === 'bell') {
        labels.push(ch.toUpperCase());
      } else if (ch === 'rhodes_chord') {
        labels.push(`CHORD:[${pitches.sort((a, b) => a - b).join(',')}]`);
      } else if (ch === 'rhodes_melody') {
        labels.push(`MEL:[${pitches.sort((a, b) => a - b).join(',')}]`);
      } else if (ch === 'pad') {
        labels.push(`PAD:[${pitches.sort((a, b) => a - b).join(',')}]`);
      } else if (ch === 'bass') {
        labels.push(`BASS:${pitches[0]}`);
      } else {
        labels.push(`${ch.toUpperCase()}:${pitches.join(',')}`);
      }
    }
    const beatMarker = ` b${beatInBar.toFixed(2).padStart(5, '0')} `;
    lines.push(`  ${formatTime(time)}s${beatMarker}| ${labels.join('  ')}`);
  }

  // Footer: param events (mostly evo filter / chorus / drum bus drift).
  // Truncated — drift events are noisy; just count them.
  if (paramEvents.length > 0) {
    const paramCounts = new Map<string, number>();
    for (const e of paramEvents) {
      paramCounts.set(e.target, (paramCounts.get(e.target) ?? 0) + 1);
    }
    lines.push(`  --- ${paramEvents.length} param events ---`);
    for (const [target, n] of paramCounts) {
      lines.push(`    ${target}: ${n} updates`);
    }
  }

  return lines.join('\n');
}

const opts = parseArgs(process.argv.slice(2));
const blocks: string[] = [];
for (const seed of opts.seeds) {
  blocks.push(renderSeed(seed, opts));
}
console.log(blocks.join('\n\n'));
