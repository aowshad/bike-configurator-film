# CLAUDE.md: bike configurator film

A 25 s, 1920×1080, 60 fps explainer of the real 3D bike configurator, rendered frame by frame from the live app.
Read README.md for the commands and how it works.

## Layout

```
app/                  git submodule: bike-configurator-3d, pinned. NEVER edit files in here.
film/index.html       film page: the app in a 1920×1080 iframe + overlay (cursor, ripple, caption, end card)
film/film.js          driver: runs the timeline per frame (__step), steps the app's clock (__advance)
film/inject.js        injected into the app before its scripts: virtual clock, CSS animations, smooth scroll,
                      scroll/resize callbacks on the clock, input counters, film hooks (window.__film)
film/film.css         overlay styles (the app's dark tokens, Inter)
src/tokens.js         BPM 120, beat grid b(), durations, easing, colors, copy. Single source of truth.
src/timeline.js       the storyboard: scenes, captions, actions (tap, move, zoom, swipe, type, orbit) and events()
render/               browser.mjs (Chrome + input handshake), render, audio, review, stills, probe,
                      check-determinism, publish, server, sheet
site/index.html       the GitHub Pages player (published to the gh-pages branch by render/publish.mjs)
assets/fonts/         Inter variable (OFL)
```

## Rules (from the owner)

- **The UI on screen is the real app.** Never fake an option that doesn't exist; drive real elements with real events.
  If the app needs a hook to be scriptable, add it to `film/inject.js` (by data attributes and aria labels), never to `app/`.
- **No monospace fonts anywhere.** Captions and cards use Inter. Captions are short, in sentence case, with no emoji.
- **Motion is calm and smooth, with no bounce.** Use only the curves in `EASE` (the app's `--ease`/`--ease-io` plus
  one zoom curve).
- One caption at a time, as a lower-third pill. Zooms keep part of the stage AND the looks row on screen (the app's
  visibility observers are locked for the film, see below).
- Audio is procedural (no samples): −14 LUFS integrated, true peak ≤ −1 dBTP, SFX under the music. Ship a silent copy.
- Before a final render: `npm run render:draft`, `npm run review`, look at every scene's stills, fix timing and framing.
- Deliverables: H.264 High, yuv420p, 1920×1080, constant 60 fps, CRF ~16, AAC 48 kHz 192k, `+faststart`.

## Determinism: what already bit us (keep these working)

1. **Time only moves forward.** The app is live; `__step(t)` must be called with increasing t. There is no seeking.
2. **Input arrives asynchronously.** After sending mouse or key events, `browser.mjs` waits until the app's
   `__film.input` counters show them, before stepping the clock. Without this, clicks land a frame late, on a moving list.
3. **Zoom and input:** when the zoom changed this frame, present it (two rAFs in the film page) before moving the
   mouse. Chrome maps coordinates through the last presented frame.
4. **`:hover` after scrolling:** Chrome updates hover from its own timer. The renderer nudges the mouse (1/500 px)
   before and after every step and waits for it.
5. **`scrollIntoView` inside an iframe also scrolls the parent page.** The smooth-scroll patch measures with an
   instant scroll, then restores every ancestor in the app AND in the film page. (A 32 px page shift once sent the
   down tube click to the Frame spot.)
6. **Look thumbnails** pick up the scene's shadow map. They are rendered after the freeze (the row is display:none
   until then), so they come out the same every run.
7. **Scroll events and Resize/IntersectionObserver callbacks** fire on Chrome's real frames. After `__film.lock()`
   they are delivered at a fixed point of each step (visibility is held: it can't change while filming).
8. **Scroll offsets are whole pixels**, and the GPU timer extension is hidden, so the pixel ratio never adapts.
9. **The iframe starts on about:blank** (which fires load too). Wait for the app's own document.
10. Remaining differences between two runs are rasterizer noise (a few pixels at 1–6/255). `check:determinism`
    fails on anything larger.

## Verify every change

1. `npm run render:draft` must finish without "MISSED CLICK" or page errors.
2. `npm run review` and look at the sheet: every scene shows the action named in its caption.
3. `npm run check:determinism` passes.
4. After the final render: `npm run probe` (60 fps constant, 1500 frames, −14 LUFS, true peak ≤ −1 dBTP).

## Git

- Commit to `main`. Don't commit `dist/`, `.cache/` or `node_modules/`. The film's binaries go to the Release and the
  gh-pages branch (`npm run publish -- --release`).
- Bump the `app/` submodule only with a re-render and a review.
