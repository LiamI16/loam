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

---

### 3. Donation button

Per the README's "MIT, permissively licensed" framing — donations
are explicitly secondary, modeled as a trickle. The button is the
acknowledgement-of-effort surface for users who want to.

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
