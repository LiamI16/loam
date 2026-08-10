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

## Status (2026-08-08) — device-tested on iOS Safari + installed PWA

Shipped and confirmed on a real iPhone:

- **M1 layout** ✅ — safe-area painting (`html` base color + `viewport-fit=cover`),
  `100dvh`, landscape reflow (`max-height:600px`) + `margin:auto`/`overflow-y:auto`
  scroll fallback, viewport-fixed background (no rotate seam), drawer scroll.
- **M6 silent switch** ✅ — the launch-critical fix. Audio routes through a
  `MediaStreamAudioDestinationNode` → hidden `<audio playsinline>` on iOS only
  (`adapter.ts` `setupOutput`/`isIOS`), so Web Audio ignores the ringer switch.
  Desktop/Android keep plain `toDestination()`.
- **M5 Media Session** ✅ — lock-screen metadata (seed/BPM) + play/pause handlers
  (`main.ts`). Play from the lock screen is a valid gesture, so it resumes.
- **M2 touch controls** ✅ — audit found every keyboard shortcut already has an
  on-screen control (roll/menu/pin/chevrons/ember tap); nothing was missing.
- **M3 hover affordances + M9 touch ergonomics** ✅ — a `@media (pointer: coarse)`
  block (`index.html`) surfaces the previously hover-only pin-row actions and
  folder-delete, brightens the pin chevrons, and enlarges the primary tap targets
  (seed input/buttons, toggles, chevrons, swatches) toward ~44px. Seed input gets
  `inputmode="numeric"` for the number pad. Desktop (`pointer: fine`) unchanged.
- **Copy/folder/slider robustness** ✅ — `navigator.clipboard` and
  `crypto.randomUUID()` are secure-context-only; added an `execCommand` copy
  fallback + a `newId()` UUID fallback, and `touch-action:none` on the range
  inputs so touch-drag adjusts them instead of scrolling. Seed box also accepts a
  pasted Loam permalink and extracts the integer (`parseSeedInput`).
- **Share + tap/zoom polish** ✅ (2026-08-09) — on touch devices the copy button
  becomes a native **share** sheet (`main.ts`), else it stays copy. Gated on
  `navigator.share` **and** a coarse primary pointer — desktops (incl. Windows
  Chrome/Edge) expose `navigator.share` but open a clunky dialog, so they keep
  copy. `-webkit-tap-highlight-color:transparent` + `touch-action:manipulation`
  remove the grey tap flash and double-tap-zoom delay; 16px inputs on coarse
  pointers stop iOS zooming the viewport on focus.

**M4 background/lock — partially shipped, with a known limit.** The media-element
route *does* keep the context alive in the background, but iOS throttles the
**live-synth render** when the screen locks, so continued playback **stutters
immediately** (a render underrun, not a scheduler-starvation one — a deep
scheduling lookahead was tried and reverted because it targeted the wrong layer).
**v1 behaviour (chosen 2026-08-08): pause when hidden** on the
background-constrained (iOS) path — `adapter.backgroundRenderConstrained` gates a
pause in the `visibilitychange` handler — and resume on a tap / lock-screen play.
`stop()` pauses the media element (clean silence while locked, vs a kept-alive
live stream that jitters); `start()` rebuilds a fresh MediaStream + `<audio>`
element within the gesture so resume never rides a stream that went stale during
the lock-suspend. Device-confirmed reliable across repeated lock/unlock cycles.
Residual: a brief (~½ s) glitch at the lock and resume transitions — the render
is already throttling before the pause handler fires, and the fresh stream takes
a beat to spin up. Accepted for v1; the real cure is the deferred pre-render.
No continuous locked playback.

### Deferred — smooth background playback (ideally before launch)

The *proper* fix for continuous locked-screen playback is to stop synthesizing
live in the background: **pre-render** audio into a buffer (offline render ahead
of time, or move the engine into an **AudioWorklet** that runs on the audio
thread, immune to the main-thread/CPU throttle) and play *that* through the media
element. Significant work; the maintainer wants it before launch if feasible, but
it does not block the silent-switch launch win. Until then, M4 stays "pause on
lock."

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

**M1. Responsive layout** *(✅ shipped 2026-08-08 — see Status.)*
Add small-screen breakpoints; switch the viewport height to `100dvh`
(mobile browser chrome makes `100vh`/`100%` wrong); add
`env(safe-area-inset-*)` padding so content clears the notch and home
indicator. Audit `overflow: hidden` on `body` for clipping on short
viewports.

**M2. Touch-reachable controls (de-keyboard the core actions)** *(✅ shipped 2026-08-08 — already covered; see Status.)*
Every keyboard shortcut needs an on-screen control reachable by thumb:
reroll (`r`), favorite toggle (`m`/`f`), prev/next pinned seed
(`[`/`]`), menu open. Play/pause (ember tap) and the roll/copy buttons
already exist; the rest do not.

**M3. Replace hover-only affordances with tap-surfaced ones** *(✅ shipped 2026-08-08 — see Status.)*
Make hover-gated affordances visible/usable on coarse pointers — e.g.
gate them behind `@media (pointer: coarse)` as always-visible, or
tap-to-reveal. Covers pin chevron, folder delete, slider thumb,
editable labels.

### Tier 2 — core mobile experience for a focus-music app

**M4. Background & lock-screen playback** *(highest-value single item)*
*(Partially shipped 2026-08-08 — pause-on-lock; smooth playback deferred. See Status.)*
iOS Safari suspends the `AudioContext` when the tab backgrounds or the
screen locks, so audio stops the instant the phone is pocketed — fatal
for sustained focus listening. Needs a keep-alive strategy (silent
media-element anchor and/or Media Session) and explicit verification it
survives lock on real iOS.

**M5. Media Session integration** *(✅ shipped 2026-08-08 — see Status.)*
Lock-screen / notification transport controls + metadata (title, seed,
artwork). Pairs with M4 so users can pause/resume without unlocking.

**M6. iOS audio-lifecycle handling** *(silent switch ✅ shipped 2026-08-08 — see Status; interruption/return handling still open.)*
Three distinct iOS gotchas, none handled today: the hardware **silent
switch** mutes Web Audio (needs the media-element routing workaround);
**interruptions** (calls, audio-route changes) suspend the context;
**return-to-foreground** needs auto-resume. The existing
`visibilitychange` handler (`main.ts`) only pauses *animations* — it
does nothing for the audio context.

**M7. Screen Wake Lock** *(post-launch — but note: cheap alternative to the deferred M4 pre-render; see backlog.)*
Use the Screen Wake Lock API to keep the screen awake while playing (or
guarantee audio survives screen-off via M4). Without it the session
dies on the default auto-lock timer.

**Key insight (2026-08-09):** an opt-in "keep screen on" wake-lock toggle is a
*cheap alternative* to the deferred smooth-background work. With the screen kept
awake the phone never locks, so there's no CPU throttle and playback stays smooth
and continuous — satisfying most "leave it running" cases without the heavy
offline-render / AudioWorklet rewrite. Weigh this before committing to that task.

### Tier 3 — polish for parity

**M8. Touch drag-and-drop for favorites**
Reorder / move-to-folder uses HTML5 `draggable` / `dragstart` / `drop`
(`main.ts` favorites rendering), which is inert on touch. Replace with a
Pointer Events reorder, or lean on the existing `movePopup` tap-driven
move flow and drop DnD entirely on coarse pointers.

**M9. Touch ergonomics & input types** *(✅ shipped 2026-08-08 — see Status. Drag-and-drop reorder M8 + PWA-install polish M10 still open.)*
≥44px touch targets (pin chevrons and slider thumbs are far smaller),
usable range sliders under touch, and `inputmode="numeric"` on seed
entry so the numeric keyboard appears.

**M10. Mobile PWA install UX**
iOS has no `beforeinstallprompt`, so the install path needs explicit
"Add to Home Screen" guidance plus standalone-mode polish (splash,
`theme-color`, safe areas). Dovetails with the in-progress PWA work
(`vite-plugin-pwa` in `vite.config.ts`).

---

## Post-launch polish backlog (from 2026-08-09 mobile audit)

Non-blocking niceties surfaced while hardening mobile. None gate launch.

- **Wake-lock "keep screen on" toggle (M7)** — the cheap alternative to the
  deferred smooth-background work (see M7 note above). Likely the highest-value
  item here.
- **iOS "Add to Home Screen" hint** — iOS has no `beforeinstallprompt`, so users
  never discover install. A small one-time hint (share-sheet → Add to Home
  Screen) would surface the already-working PWA (manifest is complete). Part of
  M10.
- **Two-column landscape layout** — landscape currently just reflows + scrolls
  (functional, not elegant). **Design intent (maintainer, 2026-08-09):** when the
  phone is rotated to landscape, lay the hero (ember) and the sliders **side by
  side as two columns** — ember in one column, controls in the other — instead of
  the single stacked column. Uses the wide-but-short viewport far better and
  should remove the need to scroll in landscape.
  - Open when picked up: where the **seed area + rain/vinyl toggles** live (under
    the sliders column? beneath the ember? a third element?), and whether the
    breakpoint keys off orientation or the existing `max-height` short-viewport
    query. Settle before implementing.
- **Long-press callout suppression** — `-webkit-touch-callout: none` on the ember
  (and other non-text controls) so a long-press doesn't raise the iOS
  selection/callout menu.
- **Touch drag-and-drop reorder (M8)** — favorites reorder uses HTML5 DnD, inert
  on touch; replace with Pointer Events or lean on the existing tap-move flow.

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
