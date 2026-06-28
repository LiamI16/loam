# Mobile — gap analysis + backlog

> What's missing for a phone/tablet user to load Loam and seamlessly
> listen. The web demo today is a desktop-first, keyboard-and-hover UI
> with no mobile audio-lifecycle handling. This doc is the source of
> truth for that work.
>
> Grounded in the actual code as of 2026-06-27 (`apps/web-demo/`), not a
> generic checklist. File/line references are starting points, not an
> exhaustive map.

---

## Why mobile is broken today (root causes)

Three structural assumptions in the web demo are desktop-only:

1. **Layout has no width breakpoints.** `index.html` contains only a
   `prefers-reduced-motion` media query — zero width/pointer ones. The
   ember stage is a fixed 200px, `body` is `overflow: hidden` with
   `min-height: 100%`, and nothing accounts for the notch or the
   mobile-browser viewport.
2. **Controls are keyboard-first.** The core actions are bound to
   `space` / `r` / `m` / `f` / `[` / `]` (`main.ts` ~`window keydown`
   handler). Several have no on-screen equivalent, so they're
   unreachable without a hardware keyboard.
3. **Affordances are hover-first.** Pin chevrons, folder delete, the
   slider thumb, and editable labels all reveal/scale on `:hover`. Touch
   has no hover, so they're invisible or undiscoverable.

Plus: there is **no mobile audio-lifecycle handling at all** — the most
consequential gap for a sustained-focus app, because iOS suspends audio
the moment the screen locks.

---

## Backlog (impact-ordered)

### Tier 1 — blocks basic usability

**M1. Responsive layout**
Add small-screen breakpoints; switch the viewport height to `100dvh`
(mobile browser chrome makes `100vh`/`100%` wrong); add
`env(safe-area-inset-*)` padding so content clears the notch and home
indicator. Audit `overflow: hidden` on `body` for clipping on short
viewports.

**M2. Touch-reachable controls (de-keyboard the core actions)**
Every keyboard shortcut needs an on-screen control reachable by thumb:
reroll (`r`), favorite toggle (`m`/`f`), prev/next pinned seed
(`[`/`]`), menu open. Play/pause (ember tap) and the roll/copy buttons
already exist; the rest do not.

**M3. Replace hover-only affordances with tap-surfaced ones**
Make hover-gated affordances visible/usable on coarse pointers — e.g.
gate them behind `@media (pointer: coarse)` as always-visible, or
tap-to-reveal. Covers pin chevron, folder delete, slider thumb,
editable labels.

### Tier 2 — core mobile experience for a focus-music app

**M4. Background & lock-screen playback** *(highest-value single item)*
iOS Safari suspends the `AudioContext` when the tab backgrounds or the
screen locks, so audio stops the instant the phone is pocketed — fatal
for sustained focus listening. Needs a keep-alive strategy (silent
media-element anchor and/or Media Session) and explicit verification it
survives lock on real iOS.

**M5. Media Session integration**
Lock-screen / notification transport controls + metadata (title, seed,
artwork). Pairs with M4 so users can pause/resume without unlocking.

**M6. iOS audio-lifecycle handling**
Three distinct iOS gotchas, none handled today: the hardware **silent
switch** mutes Web Audio (needs the media-element routing workaround);
**interruptions** (calls, audio-route changes) suspend the context;
**return-to-foreground** needs auto-resume. The existing
`visibilitychange` handler (`main.ts`) only pauses *animations* — it
does nothing for the audio context.

**M7. Screen Wake Lock**
Use the Screen Wake Lock API to keep the screen awake while playing (or
guarantee audio survives screen-off via M4). Without it the session
dies on the default auto-lock timer.

### Tier 3 — polish for parity

**M8. Touch drag-and-drop for favorites**
Reorder / move-to-folder uses HTML5 `draggable` / `dragstart` / `drop`
(`main.ts` favorites rendering), which is inert on touch. Replace with a
Pointer Events reorder, or lean on the existing `movePopup` tap-driven
move flow and drop DnD entirely on coarse pointers.

**M9. Touch ergonomics & input types**
≥44px touch targets (pin chevrons and slider thumbs are far smaller),
usable range sliders under touch, and `inputmode="numeric"` on seed
entry so the numeric keyboard appears.

**M10. Mobile PWA install UX**
iOS has no `beforeinstallprompt`, so the install path needs explicit
"Add to Home Screen" guidance plus standalone-mode polish (splash,
`theme-color`, safe areas). Dovetails with the in-progress PWA work
(`vite-plugin-pwa` in `vite.config.ts`).

---

## Recommended MVP cut

**M1, M2, M3, M4, M6** get a phone user to load the app, control it by
touch, and — critically — keep listening with the screen off. **M5, M7,
M8, M9, M10** are the follow-on polish toward full desktop parity.

## Open questions

- **Obsidian mobile** is a separate surface with its own constraints
  (the plugin runs inside Obsidian's mobile app, not Safari) — out of
  scope here; track under the Obsidian adapter, not this doc.
- Does background playback (M4) need a real audio element in the graph
  for the whole session, or only as an iOS unlock/keep-alive trick? To
  be settled during M4 implementation.
- Silent-switch behaviour (M6): route everything through a media element
  always, or only when the switch is detected? Detection is unreliable;
  likely "always route" is simpler and safe.
