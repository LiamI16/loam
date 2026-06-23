# Web demo — hosting + iteration

> The free-to-listen public surface of Loam. Pure-static build of
> `apps/web-demo`, hosted on GitHub Pages, deployed by GitHub Actions
> on every push to `main`. Companion to `docs/adapter.md` (which
> documents the audio chain itself, not the hosting).

---

## Live URL

**`https://liami16.github.io/loam/`**

Cold-load is ~80 KB gzipped (`apps/web-demo/dist/index.html` plus the
hashed JS bundle). Audio doesn't start until the user taps the ember
(Web Audio's user-gesture-to-start requirement).

---

## Deploy architecture

Three pieces, each documented inline at the source:

| Piece | File | What it does |
|---|---|---|
| Build config | `apps/web-demo/vite.config.ts` | Dispatches on `command`: production sets `base: '/loam/'` (the subpath under `liami16.github.io/loam/`); dev keeps `/` so `pnpm dev` stays usable at the bare port |
| CI workflow | `.github/workflows/ci.yml` | Lint + test + build on every push and PR. Independent of deploy |
| Deploy workflow | `.github/workflows/deploy.yml` | Build the web demo, upload `apps/web-demo/dist/` as a Pages artifact, deploy via `actions/deploy-pages` |

Permissions on the deploy workflow are scoped to the minimum needed
for OIDC-authenticated Pages publishing (`contents: read`,
`pages: write`, `id-token: write`). Concurrency is set to
`cancel-in-progress: true` — rapid pushes don't queue.

---

## Iteration loop

Edit-to-live is ~60 seconds:

1. Edit anything in the repo (engine code, demo HTML/CSS, docs).
2. `git push` to `main`.
3. Workflow builds + deploys automatically.
4. ~30 s for the workflow run + ~30 s for CDN propagation.

Cache-busting is automatic: Vite emits content-hashed asset names
(`index-Bb2mwdur.js` etc.), and the HTML references those names —
browsers can't serve a stale JS bundle against new HTML.

**Rollback:** `git revert <bad-commit> && git push`. Or, in the
Actions tab, re-run an earlier successful deploy.

**Failure mode:** if the deploy fails (lint / build break), the
previous deploy stays live. The Actions tab surfaces the failure;
the site doesn't go down.

---

## Local dev

```bash
pnpm --filter @loam/web-demo dev
```

Opens at `http://localhost:5173/`. Hot-reloads on `apps/web-demo`
edits AND on `packages/core` / `packages/synth-tone` edits, via the
Vite alias that resolves workspace packages straight to their `src/`
(see `vite.config.ts` for the rationale).

To dry-run the production build locally:

```bash
pnpm --filter @loam/web-demo build
pnpm --filter @loam/web-demo preview
```

`preview` serves `dist/` at `http://localhost:4173/loam/` —
intentionally on the subpath so it matches the production layout.

---

## Troubleshooting

**First-ever deploy failed with "Get Pages site failed":** the repo's
Pages feature was off. `actions/configure-pages@v5` is configured
with `enablement: true` so subsequent runs handle this, but if you
ever recreate the repo or revoke the setting, the first run will hit
this again and fix itself.

**Site loads but shows blank / 404 on assets:** the `base` path in
`vite.config.ts` is wrong (probably `/` when it should be `/loam/`).
Check the production-build line in the config dispatch.

**"Mixed content" or "Audio API blocked" warnings:** Pages always
serves HTTPS, and Web Audio is gated by user gesture — neither
should occur once the ember has been tapped. If they do, check
that the demo's audio init still waits for the click.

**Deploy succeeds but the site doesn't update:** Pages CDN takes
~30–60 s to propagate. Hard-refresh (Cmd-Shift-R / Ctrl-Shift-R).
If still stale, check the Actions deploy step's `page_url` output
— sometimes the artifact uploaded but the deploy step targeted the
wrong environment.

**Node.js 20 deprecation warnings:** GitHub is force-running the
`@v4`/`@v5` actions on Node 24. They work. New action versions
targeting Node 24 will replace these tags eventually; not urgent.

---

## Tasks

Liam's checklist for the site itself. Engine-side work belongs in
`stage-list.md`; user-feedback feature requests belong in
`docs/user-feedback-features.md`. This section is for *site*-level
things — hosting, UX, deploy, copy.

### 1. Copy button copies the shareable link, not the seed integer

The seed-copy affordance currently puts the bare integer on the
clipboard. Users want to paste a *playable link* into chat / email —
the integer alone forces the recipient to also know the demo URL +
how to apply the seed.

**Implementation:** the copy handler should produce
`https://liami16.github.io/loam/?seed=<value>` (or whatever query-
param the demo already uses on load — verify the loader respects
this; might need to add it). One-line change inside the existing
copy handler in `apps/web-demo/src/main.ts`. Falls under the
"user-feedback-features.md → Copy Link" item — moved here because
it's site-level UX, not an engine feature.

**Files:** `apps/web-demo/src/main.ts`, possibly an init-from-URL
read at engine construction.

---

### 2. Per-seed feedback / review box

Users hear a seed, want to leave a note ("this one is great", "this
one is too busy", "love the swing"). Two pragmatic paths — both
work without a backend:

**Option A — GitHub Issues link button.** A button on the demo opens
a pre-filled GitHub issue via URL parameter:
`https://github.com/LiamI16/loam/issues/new?title=Feedback%20on%20seed%20<value>&labels=seed-feedback&body=<auto-template>`.
Body auto-fills with the seed, BPM, swing ratio, template ID
(pulled from `engine.melody.swingRatio` etc.). Zero backend; uses
GitHub's free issue store as the database. Tradeoff: requires the
reviewer to have a GitHub account.

**Option B — Embedded form.** Google Form / Tally / Typeform with
a seed-prefill via URL parameter. No login required by the reviewer.
Tradeoff: third-party dependency, less integrated.

**Recommendation:** Option A first — it's free, native to the repo,
and the feedback shows up in the same place as bug reports.
Switch to Option B if low-friction-for-non-devs becomes a goal.

**Files:** new button in `apps/web-demo/index.html` + handler in
`main.ts` that constructs the issue URL with current seed/parameters.

**Status:** Built as a 44×44 hamburger trigger (top-right) opening a
slide-in side drawer with backdrop. First card = "Leave feedback" →
pre-filled GitHub issue (seed + free-text prompt, label `feedback`).
Donate card (§3) drops in as a sibling `<a class="menu-item">`.

**Drawer polish backlog** (nice-to-haves, not blockers):

- Ember accent rail along the drawer's left edge (1px gradient strip)
  tying it into the hero ember glow.
- Keyboard shortcut hint (`M` to open) shown in the drawer footer,
  plus the actual binding wired in `main.ts`.
- Section dividers (Feedback / Support / About) once more than two
  cards exist — currently overkill for one item.
- Reduced-motion variant: respect `prefers-reduced-motion: reduce`
  by swapping the slide transform for an instant fade.

---

### 3. Donation button — DONE

Per the README's "MIT, permissively licensed" framing — donations
are explicitly secondary, modeled as a trickle. The button is the
acknowledgement-of-effort surface for users who want to.

**Status:** Shipped via Ko-fi (`ko-fi.com/liamimagawa`).
`.github/FUNDING.yml` lists `ko_fi: liamimagawa` (renders the repo
"Sponsor" button); the demo surfaces a "Support loam" heart item in the
extras drawer, below "Leave feedback". GitHub Sponsors can be added to
`FUNDING.yml` later as a sibling once approved — both can coexist.

**Platforms (mutually compatible — can list multiple):**

- **GitHub Sponsors** — native; requires applying for Sponsors
  eligibility (a couple-day approval flow). Lowest friction once
  approved; GitHub displays a "Sponsor" button at the top of the
  repo automatically.
- **Ko-fi** — instant signup, no approval needed. One-time tips +
  optional monthly. ~5% platform cut.
- **Buy Me a Coffee** — same shape as Ko-fi.

**One-click integration via `FUNDING.yml`:** create
`.github/FUNDING.yml` listing whichever platforms are set up:

```yaml
github: [LiamI16]      # only if Sponsors approved
ko_fi: <handle>
buy_me_a_coffee: <handle>
```

GitHub then renders a "Sponsor" button at the top of the repo page
for free. The demo can additionally surface a heart / coffee icon
that links to the same destinations.

**Action items to unblock this:**
1. Decide which platform(s) — Ko-fi is the fastest path; Sponsors is
   the most "indie OSS native."
2. Create the account(s) and configure.
3. Add `.github/FUNDING.yml`.
4. Add a discreet icon in the demo footer linking out.

**Files:** `.github/FUNDING.yml`, `apps/web-demo/index.html` (footer
icon), `apps/web-demo/src/main.ts` (or just a plain `<a>` — no JS
needed).

---

## Adversarial review backlog (2026-06-23)

Pass over the live demo looking for missing nice-to-haves and aesthetic
ceiling. Ordered by effort × payoff — top items are cheap and high-impact.
Some overlap with `docs/user-feedback-features.md`; cross-referenced where
so.

### High payoff / low cost

#### 4. UI color themes (forest / sky / dusk)

The CSS is already fully tokenized via `:root` vars, so swapping the
palette is cheap and the single biggest visual ROI on the board. Add a
small swatch row in the drawer (or a cycle button) that rewrites the
token set. Persist choice in `localStorage`. Cross-ref:
`user-feedback-features.md → UI Color Themes`.

**Files:** `apps/web-demo/index.html` (theme token sets + swatch markup),
`apps/web-demo/src/main.ts` (apply + persist).

#### 5. Seed/key/BPM readout

The engine derives a per-seed BPM (`engine.getOptions().bpm`) but it's
only used to drive the ember pulse, never *shown*. Surface a tiny readout
(`74 bpm · F lydian` or similar) near the seed so each seed feels
distinct rather than interchangeable — reinforces the seed-identity
thesis. Pull key/mode from the engine if exposed; BPM is already to hand.

**Files:** `apps/web-demo/index.html` (readout element),
`apps/web-demo/src/main.ts` (populate on build/reseed).

#### 6. Browser history for rolls — DONE

Three-layer split in `main.ts`: `applySeed` (engine + UI swap, no URL),
`reseed(seed, history='push'|'replace')` (URL write + applySeed), and a
`popstate` handler that re-applies the URL's seed without writing history.
Roll / R / seed-enter push one entry each (one entry per roll); Back/
Forward swap seeds live via the existing fade path. Slider/toggle changes
never touch history. Initial permalink promotion stays `replaceState`.

**Files:** `apps/web-demo/src/main.ts` (applySeed + reseed + popstate).

#### 7. Numeric entry for sliders — DONE

Click-to-type on the value label (volume + speed): the value carries a
persistent dotted-underline affordance, click swaps it for an inline
input (Enter commits, Esc cancels, blur commits), clamped + snapped to
the slider's step. Speed snaps to 0.1× so the readout always matches
playback. Warmth left as its qualitative label. Cross-ref:
`user-feedback-features.md → Text boxes for sliders`.

**Files:** `apps/web-demo/index.html`, `apps/web-demo/src/main.ts`.

### Medium

#### 8. Favorites / pinned seeds

You find a great seed, there's nowhere to keep it. A `localStorage` pin
list in the drawer is backend-free — pin the current seed, list pins as
clickable permalinks. Complements #6.

**Files:** `apps/web-demo/index.html` (drawer list), `main.ts`.

#### 9. Mobile share — `navigator.share()` + QR

"Copy link" is desktop-thinking. On mobile, native `navigator.share()`
makes seed-passing actually frictionless; a QR code in the drawer lets
someone scan a seed off your screen. Feature-detect share, fall back to
the existing copy. Also: the current copy handler's `clipboard blocked`
path leaves the user stuck — add a select-the-text fallback.

**Files:** `apps/web-demo/index.html`, `apps/web-demo/src/main.ts`.

#### 11. Audio-reactive ember

The ember breathes on the clock (`--beat`), not the music. Hook the
scale/opacity to an analyser node's RMS so loud moments flare — turns the
hero from decoration into an instrument. Needs an `AnalyserNode` tap off
the master chain in the adapter.

**Files:** `packages/synth-tone` (expose analyser), `main.ts` (rAF loop).

#### 12. Rain → three-state cycle + visible rain

Two items, same feature. (a) Rain is binary; make it on → cycle (varying
durations) → off per `user-feedback-features.md → Automatic Rain Cycle`.
(b) Rain has zero visual presence — add faint diagonal streaks / a
background wash when on, so a major audio feature has a face.

**Files:** `apps/web-demo/index.html` (rain visual layer),
`apps/web-demo/src/main.ts`, possibly engine/adapter for the cycle.

### Lower / polish

#### 13. Texture pass — grain + vignette — DONE

Two `body` pseudo-element overlays, below content and click-through: a
radial vignette for depth, plus a film-grain layer (inline SVG
`feTurbulence`, `opacity: 0.04`, `mix-blend-mode: overlay`) matching the
vinyl/lo-fi framing.

#### 14. Drifting ember particles

Slow rising sparks from the hero on play (cheap canvas or CSS). On-theme
for "ember," gives the idle screen life during long focus sessions.

#### 15. Typography contrast

Everything is one monospace at near-identical tiny sizes with wide
tracking — tasteful but monotone. The seed (the star) deserves a larger,
more confident treatment vs. the control labels.

#### 16. First-load attract pulse — DONE

The idle ember runs a slow 3.4s swell (`attract` class) to pull the eye
to the play affordance, retired in JS on first toggle so it never
competes with the beat-synced breathe. Respects `prefers-reduced-motion`.

#### 17. Drawer polish (from §2 backlog) — DONE

Ember accent rail (1px gradient strip) down the drawer's left edge;
`M`-to-open keyboard hint in a drawer footer + the binding in the global
keydown handler; reduced-motion drawer variant that fades instead of
sliding. Section-dividers item from §2 left out (still one card).

### Correctness / robustness (not aesthetic, but flagged)

#### 18. Tab-switch audio dropout — DONE

`user-feedback-features.md → Swapping tabs cuts out music` — Web Audio
suspends on backgrounded tabs. Context now resumes on `visibilitychange`.

#### 19. Engine-build error state

`buildAudio` can throw and the hint stays at "warming up…" forever. Add a
catch that surfaces a recoverable error message.

#### 20. Re-enable pinch-zoom

`maximum-scale=1` in the viewport meta disables pinch-zoom — an
accessibility smell. Drop it unless there's a concrete reason.
