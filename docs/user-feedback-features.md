# User Feedback Features
This note lays out some early stage feedback I got on the prototype

## Make speed (bpm) adjustable, not random
^ What header says. Some people might want to choose the bpm the track is played at. The seed can instantiate a random bpm but make it adjustable relative to that.

*DONE*

## UI Color Themes
Current background is warm orange, add forest theme, sky theme, etc

*DONE.* Four themes (ember / forest / sky / dusk) selectable via a swatch
row in the extras drawer; choice persists in `localStorage`. Palettes live
as `.theme-<id>` CSS classes in `apps/web-demo/index.html` (single source
of truth — no hex in JS); microadjust by editing a hex and pushing. See
`docs/web-demo.md` §4. Cross-ref: that section.

## Copy Link
The copy button under the seed should copy the link rather than the seed integer value

*Moved to `docs/web-demo.md` Tasks §1 (site-level UX). DONE.*

## Automatic Rain Cycle
Instead of binary on/off for rain, cycle between on/off with varying durations. Press rain button once for on, press again for cycle, then back to off.

*DONE*

## Warmth Slider has more effect
^ What header says

*DONE.* Steeper rolloff (-12 → -24 dB/oct) plus widened range (350 Hz floor → 14 kHz ceiling) on the master warmth filter. Single source of truth: `warmHz` in `packages/synth-tone/src/chains/lofi.ts`.

# Enter button use
Press roll then subsequent enter presses executes a roll. Same for other buttons.

*DONE — implemented as `R` = roll (always), not Enter = last-action. See chat for rationale: "Enter re-fires last action" is a hidden mode; a single discoverable hotkey is cleaner. Binding lives in `apps/web-demo/src/main.ts`.*

# Swapping tabs cuts out music

*DONE.* Caused by browser throttling main-thread `setInterval` to ~1 Hz when the page is hidden, starving the 200 ms scheduling lookahead. Moved the pump clock into an inline Web Worker — worker timers are exempt from background throttling. Fix in `packages/synth-tone/src/adapter.ts`.

# Make extension

# Text boxes for sliders

*DONE.* Click any slider value (volume / warmth / speed) to type an exact value. Implementation in `apps/web-demo/src/main.ts` (`makeEditable`).