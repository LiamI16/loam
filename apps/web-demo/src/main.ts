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
// Placeholder pulse before the engine builds; gets corrected when
// buildAudio / reseed produces an engine and reports its derived BPM.
setBeatCss(74);
seedInput.value = currentSeed.toString();

// ── state ─────────────────────────────────────────────────────────
let initialised = false;
let playing = false;
let adapter: ToneAudioAdapter | null = null;
let engine: EmberEngine | null = null;
const uiState = { rain: false, vinyl: true };

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
  setBeatCss(e.getOptions().bpm);

  // Apply current UI slider values to the chain on init
  a.setParam('master.volume', volToDb(Number($<HTMLInputElement>('vol').value) / 100));
  a.setParam('master.warmth', warmHz(Number($<HTMLInputElement>('warm').value) / 100));
  a.setParam('bed.rain.level', uiState.rain ? -28 : -Number.POSITIVE_INFINITY);

  return { adapter: a, engine: e };
}

/** Swap a freshly-built engine into the running adapter. Brief fade for
 * clean handoff if currently playing; otherwise just swap. Used by
 * reseed (the only remaining lifecycle that swaps engines). */
async function swapEngine(next: EmberEngine): Promise<void> {
  if (!initialised || !adapter) {
    engine = next;
    return;
  }
  setBeatCss(next.getOptions().bpm);
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
    const built = buildAudio(currentSeed);
    adapter = built.adapter;
    engine = built.engine;
    initialised = true;
  }
  if (!adapter) return;
  // First interaction — retire the attract pulse so it never competes
  // with the beat-synced breathe.
  stage.classList.remove('attract');
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
