import { EmberEngine, Seed } from '@loam/core';
import { buildLofiChain, ToneAudioAdapter, volToDb, warmHz } from '@loam/synth-tone';

// Engine's home tempo is now seed-derived (each seed picks its own
// BPM from a range). User-facing tempo control is the speed slider,
// which scales playback on top.

// ── color themes ──────────────────────────────────────────────────
// Palettes are NOT defined here — they live as `.theme-<id>` CSS classes
// in index.html (single source of truth). This list only registers which
// themes exist + their swatch label/order; applying one toggles the class
// on <html>. To add a theme: add a `.theme-x` CSS block + an entry below.
// `label` doubles as the transient title-card text on switch; `hero` =
// what the glowing orb is called in this theme (drives the idle hint +
// page title). Tune wording here, same place as colors.
const THEMES: ReadonlyArray<{
  id: string;
  label: string;
  hero: string;
}> = [
  { id: 'ember', label: 'ember', hero: 'ember' },
  { id: 'forest', label: 'forest', hero: 'firefly' },
  // id stays 'sky' (CSS class + saved prefs); display name is 'tide'.
  { id: 'sky', label: 'tide', hero: 'beacon' },
  { id: 'dusk', label: 'dusk', hero: 'moon' },
];
const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]));
const THEME_IDS = new Set(THEMES.map((t) => t.id));
const THEME_STORAGE_KEY = 'loam.theme';
const DEFAULT_THEME = 'ember';

// `announce` shows the transient "entering <place>" card — true only on a
// user-initiated switch, false on the silent initial load.
function applyTheme(rawId: string, announce = false): void {
  const id = THEME_IDS.has(rawId) ? rawId : DEFAULT_THEME;
  const theme = THEME_BY_ID.get(id)!;
  const root = document.documentElement;
  root.classList.remove(...THEMES.map((t) => `theme-${t.id}`));
  root.classList.add(`theme-${id}`);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* private mode / storage disabled — theme still applies for the session */
  }
  document.querySelectorAll<HTMLButtonElement>('.theme-swatch').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.theme === id));
  });

  // Morph the metaphor: title + the idle "tap the <hero>" prompt. Only
  // rewrite the hint while idle so it never clobbers "listening…"/"paused".
  document.title = `loam · ${theme.label}`;
  const hintEl = document.getElementById('hint');
  if (hintEl && hintEl.textContent?.startsWith('tap the')) {
    hintEl.textContent = `tap the ${theme.hero} to begin`;
  }
  if (announce) showEnterCard(theme.label);
}

// Replay the title-card animation by removing + re-adding the class on the
// next frame (so the keyframes restart even on a rapid second switch).
function showEnterCard(text: string): void {
  const card = document.getElementById('enterCard');
  if (!card) return;
  card.textContent = text;
  card.classList.remove('show');
  void card.offsetWidth; // force reflow
  card.classList.add('show');
}

function currentTheme(): string {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && THEME_IDS.has(saved)) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

// ── favorites (pinned seeds) ──────────────────────────────────────
// Persisted in localStorage as a single JSON blob. Folders are one level
// deep — no nesting, no drag-reorder; ordering is pin-time desc within
// each folder and folder-create-time asc at the top level. Notes are
// optional free text. The drawer renders this list from scratch on every
// mutation (small list; cheap), and `[`/`]` cycle through the flat
// in-display order so the keyboard nav matches what the user sees.
type Pin = {
  seed: string; // bigint serialized; localStorage can't store bigint directly
  bpm: number;
  note: string;
  folderId: string | null;
  pinnedAt: number;
};
type Folder = { id: string; name: string; collapsed: boolean };
type Favorites = { folders: Folder[]; pins: Pin[] };

const FAV_STORAGE_KEY = 'loam.favorites';
const FAV_PIN_CAP = 50; // silently drop the oldest once exceeded

function loadFavorites(): Favorites {
  try {
    const raw = localStorage.getItem(FAV_STORAGE_KEY);
    if (!raw) return { folders: [], pins: [] };
    const parsed = JSON.parse(raw) as Partial<Favorites>;
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
    };
  } catch {
    return { folders: [], pins: [] };
  }
}

function saveFavorites(fav: Favorites): void {
  try {
    localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(fav));
  } catch {
    /* private mode / quota — change still applies for the session */
  }
}

let favorites: Favorites = loadFavorites();
// Tracks which folder (if any) is in its "are you sure?" delete-confirm
// state. Rendered inline in the folder head — no modal. One at a time.
let pendingFolderDelete: string | null = null;
// A freshly-created folder's id, so renderFavoritesList knows to focus +
// select its name input for immediate renaming. Cleared after consumption.
let focusFolderId: string | null = null;
// Latest known engine BPM. Mirrored from setSeedMeta so pinCurrent() can
// stash an accurate BPM without scraping the seedMeta text node.
let currentBpm = 0;
const PIN_NOTE_MAX = 120;
// The favorites UI consts (favList, pinBtn, …) are declared far below, but
// setSeedMeta() — which calls refreshFavoritesUi() — runs during the early
// pre-DOM-const peek block. Touching those consts then is a TDZ
// ReferenceError that aborts the whole module. This flag makes the early
// call a no-op; the trailing init flips it true and paints once.
let favUiReady = false;

function isPinned(seed: bigint): boolean {
  const s = seed.toString();
  return favorites.pins.some((p) => p.seed === s);
}

function pinCurrent(bpm: number): void {
  const s = currentSeed.toString();
  if (favorites.pins.some((p) => p.seed === s)) return;
  favorites.pins.unshift({
    seed: s,
    bpm: Math.round(bpm),
    note: '',
    folderId: null,
    pinnedAt: Date.now(),
  });
  // Cap: drop oldest by pinnedAt
  if (favorites.pins.length > FAV_PIN_CAP) {
    favorites.pins.sort((a, b) => b.pinnedAt - a.pinnedAt);
    favorites.pins.length = FAV_PIN_CAP;
  }
  saveFavorites(favorites);
  refreshFavoritesUi();
}

function unpin(seed: bigint): void {
  const s = seed.toString();
  favorites.pins = favorites.pins.filter((p) => p.seed !== s);
  saveFavorites(favorites);
  refreshFavoritesUi();
}

function togglePinCurrent(): void {
  if (isPinned(currentSeed)) unpin(currentSeed);
  else pinCurrent(currentBpm);
}

// Pick a non-colliding "new folder" / "new folder 2" / ... name so repeated
// "+ folder" clicks don't all read the same.
function nextNewFolderName(): string {
  const base = 'new folder';
  const taken = new Set(favorites.folders.map((f) => f.name));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 999; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

function addFolder(): string {
  const id = crypto.randomUUID();
  favorites.folders.push({ id, name: nextNewFolderName(), collapsed: false });
  // Render will focus + select this folder's name input for inline rename.
  focusFolderId = id;
  saveFavorites(favorites);
  refreshFavoritesUi();
  return id;
}

function renameFolder(id: string, name: string): void {
  const f = favorites.folders.find((x) => x.id === id);
  if (!f) return;
  f.name = name.trim() || 'untitled';
  saveFavorites(favorites);
  // Re-render so other pins' move-to-folder menus reflect the new name.
  refreshFavoritesUi();
}

function deleteFolder(id: string): void {
  favorites.folders = favorites.folders.filter((f) => f.id !== id);
  // Move that folder's pins back to the ungrouped section, preserving them.
  for (const p of favorites.pins) if (p.folderId === id) p.folderId = null;
  saveFavorites(favorites);
  refreshFavoritesUi();
}

function toggleFolderCollapsed(id: string): void {
  const f = favorites.folders.find((x) => x.id === id);
  if (!f) return;
  f.collapsed = !f.collapsed;
  saveFavorites(favorites);
  refreshFavoritesUi();
}

function setPinFolder(seed: string, folderId: string | null): void {
  const p = favorites.pins.find((x) => x.seed === seed);
  if (!p) return;
  p.folderId = folderId;
  saveFavorites(favorites);
  refreshFavoritesUi();
}

function setPinNote(seed: string, note: string): void {
  const p = favorites.pins.find((x) => x.seed === seed);
  if (!p) return;
  // Pasted text bypasses maxLength on the input element; clamp here too so
  // a corrupted localStorage payload can't slip past the limit either.
  p.note = note.slice(0, PIN_NOTE_MAX);
  saveFavorites(favorites);
}

// Flat list of pins in display order (ungrouped first, then folder groups
// in folder order, skipping collapsed folders). Drives `[` / `]` cycling.
function displayPinOrder(): Pin[] {
  const ungrouped = favorites.pins.filter((p) => p.folderId === null);
  const grouped: Pin[] = [];
  for (const f of favorites.folders) {
    if (f.collapsed) continue;
    for (const p of favorites.pins) if (p.folderId === f.id) grouped.push(p);
  }
  return [...ungrouped, ...grouped];
}

function cyclePin(dir: 1 | -1): void {
  const order = displayPinOrder();
  if (order.length === 0) return;
  const cs = currentSeed.toString();
  const idx = order.findIndex((p) => p.seed === cs);
  // If current isn't in the cycle list, start from either end.
  const next =
    idx === -1 ? (dir === 1 ? 0 : order.length - 1) : (idx + dir + order.length) % order.length;
  const target = order[next];
  if (!target) return;
  try {
    // Cycling replaces history instead of pushing. Otherwise scrubbing
    // through a library with `[` / `]` floods the back stack and makes
    // Back useless. The pre-cycle seed remains one Back away.
    void reseed(BigInt(target.seed), 'replace');
  } catch {
    /* shouldn't happen — seed strings come from bigint.toString() */
  }
}

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
  currentBpm = Math.round(bpm);
  $<HTMLElement>('seedMeta').textContent = `· ${currentBpm} bpm`;
  // Heart aria-pressed + chevron visibility track the active seed and
  // pin-list size; do it here so every BPM/seed update keeps them honest.
  refreshFavoritesUi();
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
  if (uiState.rainMode === 'cycle')
    return uiState.rainPhase === 'heavy' ? RAIN_HEAVY_DB : RAIN_LIGHT_DB;
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

// ── pause CSS animations when the tab is hidden ───────────────────
// Pairs with the body[data-hidden=true] rule. The Web Audio scheduler keeps
// running (it lives in a worker), but the visual animations are wasted work
// while invisible and can produce a paint catch-up on resume.
document.addEventListener('visibilitychange', () => {
  document.body.dataset.hidden = String(document.hidden);
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
function makeEditable(
  valueId: string,
  sliderId: string,
  parse: (text: string) => number | null,
): void {
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
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commit(false);
      }
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

// Default hint uses .hint-pair spans so wrapping breaks between key/action
// pairs, not within them. Capture the markup as initially shipped by index.html
// rather than re-encoding it here.
const seedHintEl = $<HTMLElement>('seedHint');
const DEFAULT_SEED_HINT_HTML = seedHintEl.innerHTML;
let seedHintTimer: ReturnType<typeof setTimeout> | null = null;
function setSeedHint(text: string, autoRevertMs = 1500): void {
  seedHintEl.textContent = text;
  if (seedHintTimer !== null) clearTimeout(seedHintTimer);
  seedHintTimer = setTimeout(() => {
    seedHintEl.innerHTML = DEFAULT_SEED_HINT_HTML;
  }, autoRevertMs);
}

// Commit whatever's typed in the seed box — fired on both Enter and blur
// (clicking away), so there's no hidden "press Enter" requirement. Reseeds
// only when the value actually changed; on an invalid entry, snaps the box
// back to the current seed so it never lingers in a broken state.
function commitSeed(): void {
  const raw = seedInput.value.trim();
  let parsed: bigint;
  try {
    parsed = BigInt(raw);
  } catch {
    setSeedHint('invalid · must be an integer');
    seedInput.value = currentSeed.toString();
    return;
  }
  if (parsed === currentSeed) return;
  void reseed(parsed);
}

seedInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  // Drop focus so the user can immediately press space to play/pause
  // without having to click outside the input first. The resulting blur
  // does the actual commit, so we don't reseed twice.
  seedInput.blur();
});
seedInput.addEventListener('blur', commitSeed);

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
    return;
  }
  if (e.key === 'f' || e.key === 'F') {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(t)) return;
    e.preventDefault();
    togglePinCurrent();
    return;
  }
  if (e.key === '[' || e.key === ']') {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(t)) return;
    e.preventDefault();
    cyclePin(e.key === ']' ? 1 : -1);
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

// ── theme swatches: render one chip per THEMES entry, apply on click ──
{
  const row = $<HTMLDivElement>('themeSwatches');
  for (const { id, label } of THEMES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    // The `theme-${id}` class scopes this chip's palette tokens to itself,
    // so its CSS preview gradient renders in that theme's colors.
    btn.className = `theme-swatch theme-${id}`;
    btn.dataset.theme = id;
    btn.title = label;
    btn.setAttribute('aria-label', `${label} theme`);
    btn.addEventListener('click', () => {
      applyTheme(id, true);
      setMenuOpen(false); // close the drawer so the title card is visible
    });
    row.appendChild(btn);
  }
  applyTheme(currentTheme());
}

// Promote current seed into the URL so a copy yields a permalink, without
// triggering a navigation/reload.
{
  const url = new URL(window.location.href);
  if (!url.searchParams.has('seed')) {
    url.searchParams.set('seed', currentSeed.toString());
    window.history.replaceState({}, '', url.toString());
  }
}

// ── favorites UI ─────────────────────────────────────────────────
const pinBtn = $<HTMLButtonElement>('pin');
const pinPrev = $<HTMLButtonElement>('pinPrev');
const pinNext = $<HTMLButtonElement>('pinNext');
const favList = $<HTMLDivElement>('favList');
const favNewFolder = $<HTMLButtonElement>('favNewFolder');

pinBtn.addEventListener('click', () => togglePinCurrent());
pinPrev.addEventListener('click', () => cyclePin(-1));
pinNext.addEventListener('click', () => cyclePin(1));
favNewFolder.addEventListener('click', () => addFolder());

// Cross-tab sync: another tab editing the same key updates this view.
window.addEventListener('storage', (e) => {
  if (e.key !== FAV_STORAGE_KEY) return;
  favorites = loadFavorites();
  refreshFavoritesUi();
});

// Shrink display: long bigints would push the row's note + actions
// out of the drawer. Keep head + tail visible.
function shortSeed(s: string): string {
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}

function renderPinRow(p: Pin): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'fav-pin';
  if (p.seed === currentSeed.toString()) row.classList.add('is-current');

  const main = document.createElement('div');
  main.className = 'fav-pin-main';
  const head = document.createElement('div');
  const seedSpan = document.createElement('span');
  seedSpan.className = 'fav-pin-seed';
  seedSpan.textContent = shortSeed(p.seed);
  seedSpan.title = p.seed;
  const metaSpan = document.createElement('span');
  metaSpan.className = 'fav-pin-meta';
  metaSpan.textContent = `${p.bpm} bpm`;
  head.append(seedSpan, metaSpan);
  // Inline contenteditable note. Save on blur / Enter; revert on Esc.
  const note = document.createElement('input');
  note.className = 'fav-pin-note';
  note.type = 'text';
  note.value = p.note;
  note.placeholder = '+ add note';
  note.spellcheck = false;
  note.maxLength = PIN_NOTE_MAX;
  note.addEventListener('click', (ev) => ev.stopPropagation());
  note.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') note.blur();
    else if (ev.key === 'Escape') {
      note.value = p.note;
      note.blur();
    }
  });
  note.addEventListener('blur', () => {
    if (note.value !== p.note) setPinNote(p.seed, note.value);
  });
  main.append(head, note);

  // Hover-revealed actions: move-to-folder + unpin.
  const actions = document.createElement('div');
  actions.className = 'fav-pin-actions';

  const moveBtn = document.createElement('button');
  moveBtn.type = 'button';
  moveBtn.className = 'fav-pin-act fav-pin-act-icon';
  moveBtn.title = 'move to folder';
  // Small folder glyph, matching the heart/comment SVG language elsewhere.
  moveBtn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';
  moveBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openMovePopup(p.seed, moveBtn);
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'fav-pin-act';
  del.title = 'unpin';
  del.textContent = '×';
  del.addEventListener('click', (ev) => {
    ev.stopPropagation();
    try {
      unpin(BigInt(p.seed));
    } catch {
      /* unreachable */
    }
  });
  actions.append(moveBtn, del);

  row.append(main, actions);

  // Clicking the row body (anywhere outside an action) loads that seed.
  row.addEventListener('click', () => {
    try {
      void reseed(BigInt(p.seed));
      setMenuOpen(false);
    } catch {
      /* unreachable */
    }
  });
  return row;
}

function renderFavoritesList(): void {
  // Anchor button is about to be detached — close the popup so it doesn't
  // track a stale element.
  closeMovePopup();
  favList.replaceChildren();
  // Ungrouped pins (flat, top of section).
  const ungrouped = favorites.pins.filter((p) => p.folderId === null);
  for (const p of ungrouped) favList.appendChild(renderPinRow(p));

  for (const f of favorites.folders) {
    const wrap = document.createElement('div');
    wrap.className = 'fav-folder';
    if (f.collapsed) wrap.classList.add('collapsed');

    const head = document.createElement('div');
    head.className = 'fav-folder-head';
    const pinsInFolder = favorites.pins.filter((p) => p.folderId === f.id);

    if (pendingFolderDelete === f.id) {
      // Inline confirm state: replaces the normal head until user resolves it.
      head.classList.add('confirm');
      const label = document.createElement('span');
      label.className = 'fav-folder-confirm-text';
      label.textContent = `delete "${f.name}"?`;
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'fav-confirm-btn confirm-yes';
      yes.textContent = 'delete';
      yes.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pendingFolderDelete = null;
        deleteFolder(f.id);
      });
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'fav-confirm-btn confirm-no';
      no.textContent = 'cancel';
      no.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pendingFolderDelete = null;
        refreshFavoritesUi();
      });
      head.append(label, no, yes);
    } else {
      // Normal head: twist (collapse), editable name, count, × (enter confirm).
      const twist = document.createElement('button');
      twist.type = 'button';
      twist.className = 'fav-folder-twist';
      twist.textContent = '▾';
      twist.setAttribute('aria-label', f.collapsed ? 'Expand folder' : 'Collapse folder');
      twist.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleFolderCollapsed(f.id);
      });
      const nameInput = document.createElement('input');
      nameInput.className = 'fav-folder-name';
      nameInput.value = f.name;
      nameInput.spellcheck = false;
      nameInput.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') nameInput.blur();
        if (ev.key === 'Escape') {
          nameInput.value = f.name;
          nameInput.blur();
        }
      });
      nameInput.addEventListener('blur', () => {
        if (nameInput.value !== f.name) renameFolder(f.id, nameInput.value);
      });
      if (focusFolderId === f.id) {
        // Defer to the next frame so the element is in the DOM and focusable.
        const target = nameInput;
        queueMicrotask(() => {
          target.focus();
          target.select();
        });
        focusFolderId = null;
      }
      const count = document.createElement('span');
      count.className = 'fav-folder-count';
      count.textContent = String(pinsInFolder.length);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'fav-folder-del';
      del.title = 'delete folder (keeps pins)';
      del.textContent = '×';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        // Only one pending confirm at a time — switching folders cancels any prior.
        pendingFolderDelete = f.id;
        refreshFavoritesUi();
      });
      head.append(twist, nameInput, count, del);
    }

    const body = document.createElement('div');
    body.className = 'fav-folder-body';
    for (const p of pinsInFolder) body.appendChild(renderPinRow(p));

    wrap.append(head, body);
    favList.appendChild(wrap);
  }
}

function refreshFavoritesUi(): void {
  // Called from setSeedMeta during the pre-DOM-const peek block, before the
  // favorites module consts (favList, …) are initialized. Touching them then
  // is a TDZ throw, so bail until the trailing init flips favUiReady. (The
  // elements exist in the DOM at peek time — deferred module — so an
  // element-presence check is NOT enough; the const init is what's pending.)
  if (!favUiReady) return;
  const pin = document.getElementById('pin') as HTMLButtonElement | null;
  const prev = document.getElementById('pinPrev') as HTMLButtonElement | null;
  const next = document.getElementById('pinNext') as HTMLButtonElement | null;
  const section = document.getElementById('favSection');
  const list = document.getElementById('favList');
  if (!pin || !prev || !next || !section || !list) return;

  const pinned = isPinned(currentSeed);
  pin.setAttribute('aria-pressed', String(pinned));
  pin.setAttribute('aria-label', pinned ? 'Unpin this seed' : 'Pin this seed');
  pin.title = pinned ? 'unpin (F)' : 'pin this seed (F)';

  const order = displayPinOrder();
  const showChevrons = order.length >= 2;
  prev.classList.toggle('is-empty', !showChevrons);
  next.classList.toggle('is-empty', !showChevrons);

  const empty = favorites.folders.length === 0 && favorites.pins.length === 0;
  section.hidden = empty;

  renderFavoritesList();
}

// ── shared move-to-folder popup ──────────────────────────────────
// One popup at body level using position:fixed, so it escapes the
// #favList overflow clip. Built lazily on first open. Anchored to the
// triggering moveBtn via getBoundingClientRect; flips above if it would
// run past the viewport bottom.
let movePopup: HTMLDivElement | null = null;
let movePopupAnchor: HTMLElement | null = null;
function ensureMovePopup(): HTMLDivElement {
  if (movePopup) return movePopup;
  const el = document.createElement('div');
  el.className = 'fav-move-popup';
  el.setAttribute('role', 'menu');
  document.body.appendChild(el);
  movePopup = el;
  return el;
}
function openMovePopup(seed: string, anchor: HTMLElement): void {
  const el = ensureMovePopup();
  movePopupAnchor = anchor;
  el.replaceChildren();
  const mk = (label: string, folderId: string | null): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fav-move-opt';
    b.textContent = label;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setPinFolder(seed, folderId);
      closeMovePopup();
    });
    return b;
  };
  // Hide the "(no folder)" option if the pin is already ungrouped, and
  // hide the pin's current folder so the menu only shows real moves.
  const pin = favorites.pins.find((x) => x.seed === seed);
  const currentFolderId = pin?.folderId ?? null;
  if (currentFolderId !== null) el.appendChild(mk('(no folder)', null));
  for (const f of favorites.folders) {
    if (f.id === currentFolderId) continue;
    el.appendChild(mk(f.name, f.id));
  }
  // Inline "+ new folder…" — saves a round trip to the section header.
  // Creates a folder, moves the pin into it, and lets the trailing render
  // pick up focusFolderId so the user can name it immediately.
  const newOpt = document.createElement('button');
  newOpt.type = 'button';
  newOpt.className = 'fav-move-opt fav-move-new';
  newOpt.textContent = '+ new folder…';
  newOpt.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = addFolder();
    setPinFolder(seed, id);
    closeMovePopup();
  });
  el.appendChild(newOpt);
  el.classList.add('show');
  positionMovePopup();
}
function positionMovePopup(): void {
  if (!movePopup || !movePopupAnchor) return;
  const a = movePopupAnchor.getBoundingClientRect();
  // Make it visible (off-screen during measure) to read its height.
  movePopup.style.left = '-9999px';
  movePopup.style.top = '0px';
  const mh = movePopup.offsetHeight;
  const mw = movePopup.offsetWidth;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  // Flip upward if dropping below the anchor would overflow viewport.
  const below = a.bottom + 4;
  const wantsUp = below + mh > vh - 6;
  const top = wantsUp ? Math.max(6, a.top - 4 - mh) : below;
  // Align right edge of menu to right edge of anchor; clamp to viewport.
  let left = a.right - mw;
  if (left < 6) left = 6;
  if (left + mw > vw - 6) left = vw - 6 - mw;
  movePopup.style.left = `${left}px`;
  movePopup.style.top = `${top}px`;
}
function closeMovePopup(): void {
  if (!movePopup) return;
  movePopup.classList.remove('show');
  movePopupAnchor = null;
}

// Outside click / Escape closes the popup. Scrolling/resize repositions.
document.addEventListener('click', (e) => {
  if (!movePopup?.classList.contains('show')) return;
  const t = e.target as HTMLElement | null;
  if (t === movePopupAnchor || movePopupAnchor?.contains(t)) return;
  if (movePopup.contains(t)) return;
  closeMovePopup();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && movePopup?.classList.contains('show')) closeMovePopup();
});
window.addEventListener('resize', () => {
  if (movePopup?.classList.contains('show')) positionMovePopup();
});
// Reposition during favList scroll so the popup tracks its anchor.
document.addEventListener(
  'scroll',
  () => {
    if (movePopup?.classList.contains('show')) positionMovePopup();
  },
  true, // capture, to catch internal #favList scroll
);

// Initial paint. Flip the readiness flag first so this call (and all later
// setSeedMeta-driven ones) actually render — earlier peek-time calls no-op'd.
favUiReady = true;
refreshFavoritesUi();
