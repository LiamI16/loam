# Platforms — brainstorm

> Capture for future spec. Where Loam lives beyond the web demo +
> Obsidian plugin. The web PWA + Obsidian are the v1 surfaces; this
> doc tracks the *next* surfaces (VS Code, browser extension) and
> the design call that any new surface has to clear to earn its
> place. Informal — promote to a proper spec once one of these moves
> from "interesting" to "planned for build."

---

## The bar any new surface must clear

The web PWA already does ~95% of what most "wrappers" would do: instant
load, offline, standalone window, dock icon, audio playback, no extra
permissions, one URL to share. A new surface is only worth building
if it can do something the PWA structurally **cannot** — typically
because it has access to a platform sensor or distribution channel
the browser doesn't.

If a surface's only pitch is "the PWA, but in a different wrapper,"
don't build it. It will lose to the PWA, and divide attention.

---

## Surface 1: Obsidian plugin

**Status:** planned for v1, not yet started. See
`docs/obsidian-brainstorm.md` (stub).

**Why it earns its place:** Obsidian's audience is exactly the
focus/study/PKM crowd Loam targets. Plugin runs in Electron (Chromium
+ Node), so Web Audio + the existing core/adapter code path work
directly. Distribution via the community plugin browser is real.

**Differentiation over the PWA:** lives inside the user's existing
workflow (note-taking) without forcing a separate window/tab. Can key
to note context — e.g., per-note pinned seed, audio that follows the
active note.

---

## Surface 2: VS Code extension

**Status:** future. Not yet on the v1 roadmap; worth scoping after
Obsidian ships.

**Why it earns its place:** "focus music while coding" is a natural
adjacency. VS Code is the most-loved plugin platform alive,
Marketplace distribution is real, and the audience (developers) is
underserved by current focus-music tools. Reaches beyond the PKM
bubble.

**Differentiation over the PWA:** coders don't want a second browser
window competing for desktop real estate. Native control surface in
the editor (status bar widget, command palette entries, keybinds
matching the user's existing VS Code muscle memory). Could also key
to editor context later (different presets for debugging vs.
writing).

**Porting cost:** moderate. The audio core ports straight; the UI
needs a VS Code Webview wrapper. Webviews can run Web Audio, so the
existing Tone.js adapter should work.

---

## Surface 3: Browser extension (Chrome/Firefox/Edge)

**Status:** future, only build if multiple of the features below get
prioritized. A naive "PWA in extension form" is *not* worth building.

**Why it could earn its place:** the browser is uniquely positioned
as a **sensor for what kind of work you're doing**. Loam can react
to the user's browser context in ways the PWA cannot (no cross-tab
visibility, no background scripts). The positioning becomes "Loam is
a focus companion that watches what you're doing and adapts," not
"Loam is an app that plays generative music."

### Features that justify the extension

Only build the extension if **at least 2–3 of these** are part of the
product vision. Otherwise the PWA is enough.

**Picked (worth pursuing):**

1. **Site-aware adaptive presets.** Coding-focused seed on github.com
   / docs.* / Stack Overflow, ambient on Notion/Obsidian web, fade-out
   on YouTube/Netflix, mute on Meet/Zoom/Discord calls. Keys behavior
   to the active tab's domain. PWA cannot do this — no cross-tab
   visibility.

2. **Tab-audio ducking.** When another tab starts playing audio
   (video, a clip, a podcast), Loam fades down ~12 dB; returns when
   that audio stops. Eliminates "Loam fights with everything else I
   might play." Requires tab-audio monitoring.

6. **Toolbar quick controls.** Click extension icon → play/pause,
   current seed, theme switcher, cycle pinned seeds, without opening
   any Loam tab. Always-there, doesn't compete for screen space.

7. **Background-persistent audio.** Plays even after every Loam-
   related tab is closed (via MV3 offscreen document). The "Loam is
   just there, ambient, never accidentally killed" model. Closest a
   browser gets to a desktop tray app.

**Considered, parked:**

- Reading-mode auto-engage (deep-reading preset when reader view
  activates) — interesting but narrow.
- Calendar-aware fade (fade out before scheduled meetings) — concrete
  and modest scope, but requires Google Calendar API tab or native
  messaging; complexity-to-value ratio unclear.
- Per-domain volume / theme memory — small personal-touch feature.

### Minimum viable extension scope

When this gets built: features 1 + 2 + 6 + 7. Together they tell a
coherent story:

> Loam adapts to what your browser is doing. Click the icon to control
> it; close every tab and it keeps playing in the background.

Features 1 and 2 are the differentiation, 6 is the affordance, 7 is
the trust signal ("it doesn't disappear when I close a tab"). Anything
short of all four leaves a noticeable gap in the pitch.

---

## Surfaces explicitly NOT planned

- **Notion / Evernote / Apple Notes / Google Keep / OneNote / Mem /
  Tana / Reflect / Capacities.** No real plugin systems. Best users
  can do is iframe-embed the web demo (where the target platform
  allows iframes), and that's not a real integration. Don't burn
  engineering effort here.
- **Native iOS / Android apps.** PWA install covers most of this. Real
  native apps only worth it once a sustained mobile audience exists
  and the PWA's iOS audio-lifecycle limits become a measurable
  blocker. See `docs/mobile.md`.
- **Desktop wrapper (Tauri / Electron).** PWA install gives a
  standalone window with dock icon today. Native desktop only earns
  its place if global hotkeys, media-key support, or system tray
  becomes a top user ask.

---

## Order of pursuit (current best guess)

1. Obsidian plugin (in flight / next up).
2. VS Code extension (after Obsidian; same audio core, different
   wrapper; different audience).
3. Browser extension (only when ready to commit to features 1, 2, 6,
   7 as a coherent product direction, not as a vanity port).
