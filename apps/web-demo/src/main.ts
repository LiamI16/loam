import { EmberEngine, Seed } from '@loam/core';
import { buildLofiChain, ToneAudioAdapter, volToDb, warmHz } from '@loam/synth-tone';

// Engine's home tempo is now seed-derived (each seed picks its own
// BPM from a range). User-facing tempo control is the speed slider,
// which scales playback on top.

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
function setSeedMeta(bpm: number): void {
  $<HTMLElement>('seedMeta').textContent = `· ${Math.round(bpm)} bpm`;
}
// Build a throwaway engine just to peek the seed's home BPM, so both the
// idle ember pulse and the seed-meta readout match the seed before play.
// EmberEngine init is pure JS — no audio context, cheap.
{
  const peek = new EmberEngine(Seed.from(currentSeed)).getOptions().bpm;
  setBeatCss(peek);
  setSeedMeta(peek);
}
seedInput.value = currentSeed.toString();

// ── state ─────────────────────────────────────────────────────────
let initialised = false;
let playing = false;
let adapter: ToneAudioAdapter | null = null;
let engine: EmberEngine | null = null;
// Rain has three modes: 'off' (silent), 'on' (steady), 'cycle' (slow
// intensity modulation between heavier and lighter rain — never silent,
// designed to be imperceptible if you're not paying attention).
// `rainPhase` tracks the cycle's current intensity bucket.
type RainMode = 'off' | 'on' | 'cycle';
const uiState: { rainMode: RainMode; rainPhase: 'heavy' | 'light'; vinyl: boolean } = {
  rainMode: 'off',
  rainPhase: 'light',
  vinyl: true,
};
const RAIN_STEADY_DB = -33; // user-toggled "on" mode
const RAIN_HEAVY_DB = -33; // cycle: foreground rain
const RAIN_LIGHT_DB = -50; // cycle: rain through a wall — still ambient, never silent
const RAIN_SILENT_DB = -60; // dedicated "off" mode; -∞ would break rampTo

function rainTargetDb(): number {
  if (uiState.rainMode === 'on') return RAIN_STEADY_DB;
  if (uiState.rainMode === 'cycle') return uiState.rainPhase === 'heavy' ? RAIN_HEAVY_DB : RAIN_LIGHT_DB;
  return RAIN_SILENT_DB;
}

// ── audio init ────────────────────────────────────────────────────
function buildEngine(seedValue: bigint): EmberEngine {
  // BPM omitted → engine derives it from the seed.
  return new EmberEngine(Seed.from(seedValue), {
    vinylEnabled: uiState.vinyl,
    speedMultiplier: Number($<HTMLInputElement>('speed').value) / 100,
  });
}

function buildAudio(seedValue: bigint): { adapter: ToneAudioAdapter; engine: EmberEngine } {
  const a = new ToneAudioAdapter();
  buildLofiChain(a);

  const e = buildEngine(seedValue);
  a.setEngine(e);
  const bpm = e.getOptions().bpm;
  setBeatCss(bpm);
  setSeedMeta(bpm);

  // Apply current UI slider values to the chain on init
  a.setParam('master.volume', volToDb(Number($<HTMLInputElement>('vol').value) / 100));
  a.setParam('master.warmth', warmHz(Number($<HTMLInputElement>('warm').value) / 100));
  a.setParam('bed.rain.level', rainTargetDb());

  return { adapter: a, engine: e };
}

/** Swap a freshly-built engine into the running adapter. Brief fade for
 * clean handoff if currently playing; otherwise just swap. Used by
 * reseed (the only remaining lifecycle that swaps engines). */
async function swapEngine(next: EmberEngine): Promise<void> {
  const nextBpm = next.getOptions().bpm;
  setBeatCss(nextBpm);
  setSeedMeta(nextBpm);
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

// ── play/pause ────────────────────────────────────────────────────
async function toggle(): Promise<void> {
  if (!initialised) {
    hint.textContent = 'warming up…';
    try {
      const built = buildAudio(currentSeed);
      adapter = built.adapter;
      engine = built.engine;
      initialised = true;
    } catch (err) {
      // Build threw (audio context, chain construction, engine init). Surface
      // it so the user can retry instead of staring at "warming up…" forever.
      console.error('[loam] audio build failed', err);
      hint.textContent = 'audio failed to start · tap to retry';
      return;
    }
  }
  if (!adapter) return;
  stage.classList.remove('attract');
  if (!playing) {
    try {
      await adapter.start();
    } catch (err) {
      console.error('[loam] audio start failed', err);
      hint.textContent = 'audio failed to start · tap to retry';
      return;
    }
    stage.classList.add('on');
    hint.textContent = 'listening · leave it running';
    playing = true;
    // Resume the rain cycle alongside playback so transitions only happen
    // against audible audio.
    if (uiState.rainMode === 'cycle') {
      adapter.setParam('bed.rain.level', rainTargetDb(), RAIN_TOGGLE_FADE_MS);
      clearRainCycle();
      scheduleNextRainPhase();
    }
  } else {
    adapter.stop();
    stage.classList.remove('on');
    hint.textContent = 'paused';
    playing = false;
    // Freeze the cycle while paused — no transitions happening to silence.
    clearRainCycle();
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
  $<HTMLElement>('warmVal').textContent = v < 35 ? 'dark' : v < 78 ? 'soft' : 'open';
  adapter?.setParam('master.warmth', warmHz(v / 100));
});

$<HTMLInputElement>('speed').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  const mult = v / 100;
  $<HTMLElement>('speedVal').textContent = `${mult.toFixed(1)}×`;
  engine?.setOption('speedMultiplier', mult);
});

// ── click-to-type on slider values ───────────────────────────────
// Clicking a value label swaps it for a transient input. On commit we
// just set the slider and re-dispatch its 'input' event, so the existing
// slider handler does all the real work (param update + label refresh).
// `parse` maps typed text → a slider value (or null to reject).
function makeEditable(valueId: string, sliderId: string, parse: (text: string) => number | null): void {
  const valEl = $<HTMLElement>(valueId);
  const slider = $<HTMLInputElement>(sliderId);
  valEl.classList.add('editable');
  valEl.title = 'click to type a value';
  let editing = false;

  valEl.addEventListener('click', () => {
    if (editing) return;
    editing = true;
    const input = document.createElement('input');
    input.className = 'val-edit';
    // Edit the bare number — strip any decorative unit (e.g. the speed
    // "×"), which is wider than 1ch and throws off the width fit.
    input.value = (valEl.textContent ?? '').replace(/[^\d.-]/g, '');
    input.setAttribute('inputmode', 'decimal');
    // Size the input to its content so the underline doesn't jump wider
    // than the number it replaced. ch ignores the inherited letter-spacing
    // (0.22em/char), so add that back in or the right-aligned digits clip.
    const fit = () => {
      const n = Math.max(2, input.value.length + 1);
      input.style.width = `calc(${n}ch + ${(n * 0.22).toFixed(2)}em)`;
    };
    fit();
    input.addEventListener('input', fit);
    valEl.style.display = 'none';
    valEl.after(input);
    input.focus();
    input.select();

    const commit = (apply: boolean): void => {
      if (!editing) return;
      editing = false;
      if (apply) {
        const sv = parse(input.value.trim());
        if (sv !== null && Number.isFinite(sv)) {
          const lo = Number(slider.min);
          const hi = Number(slider.max);
          const step = Number(slider.step) || 1;
          // Snap to the slider's step so the value always matches what the
          // readout shows (e.g. typing 0.85× lands on 0.9×, not a hidden 0.85).
          const snapped = lo + Math.round((sv - lo) / step) * step;
          slider.value = String(Math.min(hi, Math.max(lo, snapped)));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      input.remove();
      valEl.style.display = '';
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
  });
}

// Volume: shown as a 0–100 integer; type it straight through.
makeEditable('volVal', 'vol', (t) => {
  const n = Number.parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
});
// Speed: shown as a multiplier (e.g. 0.85×); slider value is mult×100.
// Accept a trailing × and stray whitespace.
makeEditable('speedVal', 'speed', (t) => {
  const n = Number.parseFloat(t.replace('×', ''));
  return Number.isNaN(n) ? null : n * 100;
});

// ── rain: off → on → cycle → off ─────────────────────────────────
// Cycle = slow intensity modulation. Phase durations live in the
// multi-minute range so transitions slip below conscious attention; the
// cycle crossfade is long for the same reason. User-triggered mode
// changes (off↔on, anything↔cycle) get a short fade — long enough to
// avoid a click, short enough to feel responsive to the button press.
const RAIN_TOGGLE_FADE_MS = 800;
const RAIN_CYCLE_FADE_MS = 30_000;
const RAIN_HEAVY_MIN_MS = 4 * 60_000;
const RAIN_HEAVY_MAX_MS = 8 * 60_000;
const RAIN_LIGHT_MIN_MS = 2 * 60_000;
const RAIN_LIGHT_MAX_MS = 4 * 60_000;

let rainCycleTimer: ReturnType<typeof setTimeout> | null = null;

function clearRainCycle(): void {
  if (rainCycleTimer !== null) {
    clearTimeout(rainCycleTimer);
    rainCycleTimer = null;
  }
}

function scheduleNextRainPhase(): void {
  const heavy = uiState.rainPhase === 'heavy';
  const lo = heavy ? RAIN_HEAVY_MIN_MS : RAIN_LIGHT_MIN_MS;
  const hi = heavy ? RAIN_HEAVY_MAX_MS : RAIN_LIGHT_MAX_MS;
  const dur = lo + Math.random() * (hi - lo);
  rainCycleTimer = setTimeout(() => {
    if (uiState.rainMode !== 'cycle') return; // mode changed under us
    uiState.rainPhase = uiState.rainPhase === 'heavy' ? 'light' : 'heavy';
    adapter?.setParam('bed.rain.level', rainTargetDb(), RAIN_CYCLE_FADE_MS);
    scheduleNextRainPhase();
  }, dur);
}

function applyRainMode(): void {
  const btn = $<HTMLButtonElement>('rain');
  btn.classList.toggle('active', uiState.rainMode !== 'off');
  btn.classList.toggle('cycle', uiState.rainMode === 'cycle');
  btn.textContent = uiState.rainMode === 'cycle' ? 'cycle' : 'rain';

  if (uiState.rainMode === 'cycle') {
    adapter?.setParam('bed.rain.level', rainTargetDb(), RAIN_TOGGLE_FADE_MS);
    clearRainCycle();
    scheduleNextRainPhase();
  } else {
    clearRainCycle();
    adapter?.setParam('bed.rain.level', rainTargetDb(), RAIN_TOGGLE_FADE_MS);
  }
}

$<HTMLButtonElement>('rain').addEventListener('click', () => {
  const prev = uiState.rainMode;
  const next: RainMode = prev === 'off' ? 'on' : prev === 'on' ? 'cycle' : 'off';
  // Cycle entry: start at the opposite of the current audible level so the
  // click always produces an audible change. Off→cycle kicks in at heavy;
  // on→cycle eases off to light. Within-cycle phase flips stay randomized
  // (the next 2–8 min phase), so the cycle still varies organically.
  if (next === 'cycle') {
    uiState.rainPhase = prev === 'off' ? 'heavy' : 'light';
  }
  uiState.rainMode = next;
  applyRainMode();
});

$<HTMLButtonElement>('vinyl').addEventListener('click', (e) => {
  uiState.vinyl = !uiState.vinyl;
  (e.target as HTMLButtonElement).classList.toggle('active', uiState.vinyl);
  engine?.setOption('vinylEnabled', uiState.vinyl);
});

// ── seed input + roll + copy ─────────────────────────────────────
// Apply a seed to the running engine + UI, without touching history.
// Shared by reseed (which also writes the URL) and popstate (where the
// URL already reflects the target, so only the apply half is needed).
async function applySeed(newSeed: bigint): Promise<void> {
  currentSeed = newSeed;
  seedInput.value = newSeed.toString();
  await swapEngine(buildEngine(newSeed));
}

// Reseed from an explicit user action (roll / R / seed-input enter).
// Pushes a history entry by default so Back returns to the previous seed;
// pass 'replace' to overwrite the current entry instead (initial promote).
async function reseed(newSeed: bigint, history: 'push' | 'replace' = 'push'): Promise<void> {
  // Permalink without reload — preserves slider state.
  const url = new URL(window.location.href);
  url.searchParams.set('seed', newSeed.toString());
  if (history === 'push') window.history.pushState({}, '', url.toString());
  else window.history.replaceState({}, '', url.toString());
  await applySeed(newSeed);
}

// Back / Forward: the URL already carries the target seed, so re-apply it
// without writing history (a write here would fight the navigation).
window.addEventListener('popstate', () => {
  const seed = seedFromUrl();
  if (seed !== null && seed !== currentSeed) void applySeed(seed);
});

const DEFAULT_SEED_HINT = 'enter to reseed · r to roll · space to play';
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
  // Copy a permalink, not the bare integer — pasting into chat/email gives
  // the recipient a one-click playable URL rather than an opaque number.
  const url = new URL(window.location.href);
  url.searchParams.set('seed', currentSeed.toString());
  try {
    await navigator.clipboard.writeText(url.toString());
    setSeedHint('link copied');
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
function isTypingTarget(t: HTMLElement | null): boolean {
  if (!t) return false;
  if (t.tagName === 'TEXTAREA') return true;
  if (t.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((t as HTMLInputElement).type)) return true;
  return false;
}

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (e.key === ' ') {
    // Buttons activate on space — skip so we don't double-fire.
    if (t?.tagName === 'BUTTON') return;
    if (isTypingTarget(t)) return;
    e.preventDefault();
    void toggle();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd/Ctrl-R (reload) alone
    if (isTypingTarget(t)) return;
    e.preventDefault();
    void reseed(randomSeed());
    return;
  }
  if (e.key === 'm' || e.key === 'M') {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(t)) return;
    e.preventDefault();
    setMenuOpen(!menu.classList.contains('open'));
  }
});

// ── extras menu (feedback, future donate, …) ─────────────────────
const menu = $<HTMLDivElement>('menu');
const menuBtn = $<HTMLButtonElement>('menuBtn');
const menuBackdrop = $<HTMLDivElement>('menuBackdrop');
const menuDrawer = $<HTMLElement>('menuDrawer');
const feedbackLink = $<HTMLAnchorElement>('feedbackLink');

const FEEDBACK_REPO = 'LiamI16/loam';

function feedbackIssueUrl(seed: bigint): string {
  const body =
    `**Seed:** \`${seed.toString()}\`\n\n` +
    `## Your feedback\n\n` +
    `<!-- what worked, what didn't, what you'd change -->\n`;
  const params = new URLSearchParams({
    title: `Feedback on seed ${seed.toString()}`,
    labels: 'feedback',
    body,
  });
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${params.toString()}`;
}

function refreshFeedbackLink(): void {
  feedbackLink.href = feedbackIssueUrl(currentSeed);
}
refreshFeedbackLink();

function setMenuOpen(open: boolean): void {
  menu.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  menuDrawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) refreshFeedbackLink(); // keep URL in sync with the live seed
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenuOpen(!menu.classList.contains('open'));
});
menuBackdrop.addEventListener('click', () => setMenuOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.classList.contains('open')) setMenuOpen(false);
});
feedbackLink.addEventListener('click', () => setMenuOpen(false));

// Promote current seed into the URL so a copy yields a permalink, without
// triggering a navigation/reload.
{
  const url = new URL(window.location.href);
  if (!url.searchParams.has('seed')) {
    url.searchParams.set('seed', currentSeed.toString());
    window.history.replaceState({}, '', url.toString());
  }
}
