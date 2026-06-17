import { EmberEngine, Seed } from '@loam/core';
import { buildLofiChain, ToneAudioAdapter, volToDb } from '@loam/synth-tone';

// Engine's natural tempo. Hidden from the user — the speed slider is
// the user-facing tempo control. Will become seed-derived in a future
// stage (each seed picks its own home BPM from a range).
const ENGINE_BPM = 74;

// ── seed handling ─────────────────────────────────────────────────
function seedFromUrl(): bigint | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    console.warn(`[loam] ignoring invalid ?seed=${raw}`);
    return null;
  }
}

function randomSeed(): bigint {
  const buf = new BigUint64Array(1);
  crypto.getRandomValues(buf);
  return buf[0] as bigint;
}

let currentSeed: bigint = seedFromUrl() ?? randomSeed();

// ── DOM ───────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLDivElement>('stage');
const hint = $<HTMLDivElement>('hint');
const seedInput = $<HTMLInputElement>('seed');

function setBeatCss(bpm: number): void {
  stage.style.setProperty('--beat', `${60 / bpm}s`);
}
setBeatCss(ENGINE_BPM);
seedInput.value = currentSeed.toString();

// ── state ─────────────────────────────────────────────────────────
let initialised = false;
let playing = false;
let adapter: ToneAudioAdapter | null = null;
let engine: EmberEngine | null = null;
const uiState = { rain: false, vinyl: true };

// ── audio init ────────────────────────────────────────────────────
function buildEngine(seedValue: bigint): EmberEngine {
  return new EmberEngine(Seed.from(seedValue), {
    bpm: ENGINE_BPM,
    density: 0.05 + (Number($<HTMLInputElement>('den').value) / 100) * 0.33,
    vinylEnabled: uiState.vinyl,
    speedMultiplier: Number($<HTMLInputElement>('speed').value) / 100,
  });
}

function buildAudio(seedValue: bigint): { adapter: ToneAudioAdapter; engine: EmberEngine } {
  const a = new ToneAudioAdapter();
  buildLofiChain(a);

  const e = buildEngine(seedValue);
  a.setEngine(e);

  // Apply current UI slider values to the chain on init
  a.setParam('master.volume', volToDb(Number($<HTMLInputElement>('vol').value) / 100));
  a.setParam('master.warmth', warmHz(Number($<HTMLInputElement>('warm').value) / 100));
  a.setParam('bed.rain.level', uiState.rain ? -28 : -Number.POSITIVE_INFINITY);

  return { adapter: a, engine: e };
}

/** Swap a freshly-built engine into the running adapter. Brief fade for
 * clean handoff if currently playing; otherwise just swap. Shared by
 * reseed and BPM-change since both have the same lifecycle. */
async function swapEngine(next: EmberEngine): Promise<void> {
  if (!initialised || !adapter) {
    engine = next;
    return;
  }
  if (playing) {
    adapter.stop();
    await new Promise((r) => setTimeout(r, 30));
    adapter.setEngine(next);
    engine = next;
    await adapter.start();
  } else {
    adapter.setEngine(next);
    engine = next;
  }
}

function warmHz(v: number): number {
  return 900 * (14000 / 900) ** v;
}

// ── play/pause ────────────────────────────────────────────────────
async function toggle(): Promise<void> {
  if (!initialised) {
    hint.textContent = 'warming up…';
    const built = buildAudio(currentSeed);
    adapter = built.adapter;
    engine = built.engine;
    initialised = true;
  }
  if (!adapter) return;
  if (!playing) {
    await adapter.start();
    stage.classList.add('on');
    hint.textContent = 'listening · leave it running';
    playing = true;
  } else {
    adapter.stop();
    stage.classList.remove('on');
    hint.textContent = 'paused';
    playing = false;
  }
}

stage.addEventListener('click', () => {
  void toggle();
});
stage.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation(); // prevent the window-level spacebar handler from double-firing
    void toggle();
  }
});

// ── stop buttons from latching focus on mouse click ───────────────
// Default browser behavior focuses a button when you click it, which
// means subsequent spacebar presses re-activate that button instead of
// triggering play/pause. preventDefault on mousedown cancels the focus
// move without affecting the click event itself; Tab keyboard
// navigation still focuses buttons normally (different code path).
document.addEventListener('mousedown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && t.tagName === 'BUTTON') e.preventDefault();
});

// ── sliders + toggles ─────────────────────────────────────────────
$<HTMLInputElement>('vol').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  $<HTMLElement>('volVal').textContent = String(v);
  adapter?.setParam('master.volume', volToDb(v / 100));
});

$<HTMLInputElement>('warm').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  $<HTMLElement>('warmVal').textContent = v < 33 ? 'dark' : v < 66 ? 'soft' : 'open';
  adapter?.setParam('master.warmth', warmHz(v / 100));
});

$<HTMLInputElement>('den').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  $<HTMLElement>('denVal').textContent = v < 33 ? 'low' : v < 66 ? 'med' : 'busy';
  const density = 0.05 + (v / 100) * 0.33;
  engine?.setOption('density', density);
});

$<HTMLInputElement>('speed').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  const mult = v / 100;
  $<HTMLElement>('speedVal').textContent = `${mult.toFixed(2)}×`;
  engine?.setOption('speedMultiplier', mult);
});

$<HTMLButtonElement>('rain').addEventListener('click', (e) => {
  uiState.rain = !uiState.rain;
  (e.target as HTMLButtonElement).classList.toggle('active', uiState.rain);
  adapter?.setParam('bed.rain.level', uiState.rain ? -33 : -Number.POSITIVE_INFINITY);
});

$<HTMLButtonElement>('vinyl').addEventListener('click', (e) => {
  uiState.vinyl = !uiState.vinyl;
  (e.target as HTMLButtonElement).classList.toggle('active', uiState.vinyl);
  engine?.setOption('vinylEnabled', uiState.vinyl);
});

// ── seed input + roll + copy ─────────────────────────────────────
async function reseed(newSeed: bigint): Promise<void> {
  currentSeed = newSeed;

  // Permalink without reload — preserves slider state.
  const url = new URL(window.location.href);
  url.searchParams.set('seed', newSeed.toString());
  window.history.replaceState({}, '', url.toString());
  seedInput.value = newSeed.toString();
  await swapEngine(buildEngine(newSeed));
}

const DEFAULT_SEED_HINT = 'enter to reseed · space to play';
let seedHintTimer: ReturnType<typeof setTimeout> | null = null;
function setSeedHint(text: string, autoRevertMs = 1500): void {
  $<HTMLElement>('seedHint').textContent = text;
  if (seedHintTimer !== null) clearTimeout(seedHintTimer);
  seedHintTimer = setTimeout(() => {
    $<HTMLElement>('seedHint').textContent = DEFAULT_SEED_HINT;
  }, autoRevertMs);
}

seedInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const raw = seedInput.value.trim();
  let parsed: bigint;
  try {
    parsed = BigInt(raw);
  } catch {
    setSeedHint('invalid · must be an integer');
    return;
  }
  // Drop focus so the user can immediately press space to play/pause
  // without having to click outside the input first.
  seedInput.blur();
  void reseed(parsed);
});

$<HTMLButtonElement>('roll').addEventListener('click', () => {
  void reseed(randomSeed());
});

$<HTMLButtonElement>('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentSeed.toString());
    setSeedHint('copied');
  } catch {
    setSeedHint('clipboard blocked');
  }
});

// ── global keyboard: spacebar plays/pauses ──────────────────────────
// Skipped when focused on:
//   - text-like inputs (user is typing)
//   - buttons (browser activates them on space — would double-fire)
// Range sliders are deliberately *allowed* — they use arrow keys, not
// space, so the user dragging a slider then hitting space should toggle
// play/pause rather than do nothing.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'number', 'tel', 'url']);
window.addEventListener('keydown', (e) => {
  if (e.key !== ' ') return;
  const t = e.target as HTMLElement | null;
  if (!t) {
    e.preventDefault();
    void toggle();
    return;
  }
  if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return;
  if (t.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((t as HTMLInputElement).type)) return;
  e.preventDefault();
  void toggle();
});

// Promote current seed into the URL so a copy yields a permalink, without
// triggering a navigation/reload.
{
  const url = new URL(window.location.href);
  if (!url.searchParams.has('seed')) {
    url.searchParams.set('seed', currentSeed.toString());
    window.history.replaceState({}, '', url.toString());
  }
}
