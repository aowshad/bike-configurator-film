# Bike configurator film

A 25-second explainer of the [3D bike configurator](https://github.com/aowshad/bike-configurator-3d), filmed frame by frame
from the **real app** (not a mock-up). It is 1920×1080 at 60 fps, with procedurally generated music and sound.

- **Watch it:** https://aowshad.github.io/bike-configurator-film/
- **Download:** [Releases → v1.0](https://github.com/aowshad/bike-configurator-film/releases/tag/v1.0): `bike-configurator-film.mp4` (with sound),
  `bike-configurator-film_silent.mp4`, `poster.png` and `contact-sheet.png` (one still per scene)
- **The configurator itself:** https://aowshad.github.io/bike-configurator-3d/

| Time | Caption | What happens in the app |
|---|---|---|
| 0.0–2.5 | Build your bike in 3D | The bike orbits; the UI fades in |
| 2.5–6.0 | Start from a look | Factory, then a swipe along the looks row and Oil & Gold |
| 6.0–10.0 | Paint every part | Frame: Safety Orange → Cobalt, Matte → Metallic; rear triangle in Arctic White |
| 10.0–13.5 | Click any part to edit it | Full view, a click on the fork on the bike, lowers → White, anodized → Gold |
| 13.5–17.0 | Swap real parts | Tires: Knobby DH → Semi-slick (camera on the wheel), grip pattern → Diamond |
| 17.0–20.5 | Make it yours | Down tube: Custom text, "RIDE FAST" typed letter by letter |
| 20.5–25.0 | Share your build | The price, Share build → "Link copied", back to the full bike, end card |

## Commands

```bash
git clone --recurse-submodules https://github.com/aowshad/bike-configurator-film
npm install
npm run audio            # music + SFX → dist/mix.wav (−14 LUFS, true peak ≤ −1 dBTP)
npm run render:draft     # 30 fps check → dist/draft.mp4
npm run review           # 3 stills per scene from a video → dist/review/sheet.png
npm run render           # final → dist/bike-configurator-film.mp4 + _silent.mp4
npm run probe            # ffprobe + loudness of the delivered files
npm run check:determinism  # renders the film twice and compares the frames
npm run publish          # Pages (gh-pages branch); add -- --release to upload to Release v1.0
```

| Script | |
|---|---|
| `npm run stills 3.2 9.8 …` | Live stills at given times (the film runs forward to them) plus a contact sheet → `dist/stills/` |
| `npm run render -- --to 8` | Render only the first 8 seconds (`--fps`, `--out`, `--silent` also work) |
| `npm run dev` | Static server: `http://localhost:5190/film/` (the film page) and `/app/` (the configurator) |

Requirements: Node 20+, Google Chrome (set `CHROME=/path/to/chrome` if it isn't in `/Applications`), macOS with a GPU
(Chrome renders the app's WebGL through ANGLE on Metal), and the `gh` CLI for publishing. The first run caches the app's
CDN files (three.js, Google Fonts) in `.cache/net`.

## Re-render after the app changes

The app is a git submodule in `app/`, pinned to a commit, so the film is reproducible:

```bash
git -C app fetch && git -C app checkout <commit>     # or: git submodule update --remote app
npm run render:draft && npm run review               # check every scene: the clicks still land? (render fails on a missed click)
npm run audio && npm run render && npm run probe
git add app && git commit -m "film: re-render with app <commit>"
```

Change the story in `src/timeline.js` (actions on the 120 BPM grid) and the rhythm, motion and copy in `src/tokens.js`.

## How it's made

- **The real app** loads in a full-size iframe (`film/index.html`). An overlay draws the cursor, captions and end card, and
  "screen recording" zooms scale the iframe.
- **Virtual clock** (`film/inject.js`, injected before the app's scripts): `performance.now`, `Date.now`,
  `requestAnimationFrame`, `setTimeout`/`setInterval` and `requestIdleCallback` run on a manual clock once the app has
  loaded. The renderer advances it exactly 1/60 s per frame. Camera flights, material fades, toasts, CSS transitions
  (through the Web Animations API), smooth scrolling, and scroll and resize callbacks all follow it, so they are frame-exact.
- **Real input:** the cursor travels to real elements, and the renderer sends trusted mouse and key events through Chrome
  DevTools. It waits until the app has received each one before the clock moves on. Clicking the fork on the canvas
  goes through the app's own raycast. A click that would miss its target fails the render.
- **Nothing in `app/` is changed.** Film-only hooks live in `film/inject.js`: part positions on screen, the intro orbit,
  the UI fade, and hiding the GPU timer so resolution never adapts to real GPU timings.
- **Determinism:** `npm run check:determinism` renders the film in two fresh browser sessions and compares every
  captured frame. Frames are pixel-identical or within rasterizer noise (≤ 16/255 on ≤ 0.25% of the frame). Timing
  errors would show up as large differences.
- **Sound** (`render/audio.mjs`) is generated in code with no samples: a 120 BPM track in A minor/C
  (| Am9 | Fmaj7 | Cadd9 | G6 | ×3) ending on a C chord on the last beat (24.0 s), plus clicks, whooshes, key ticks and a
  chime placed from the timeline's events. It is mixed to −14 LUFS integrated with true peak ≤ −1 dBTP (measured with
  ffmpeg's EBU R128 meter).
- **Encoding:** H.264 High, yuv420p, BT.709, constant 60 fps, CRF 16, AAC 48 kHz 192 kb/s, `+faststart`.

## Credits

- Configurator: [bike-configurator-3d](https://github.com/aowshad/bike-configurator-3d) by Aowshad (ParseLab), built with
  [three.js](https://threejs.org) (MIT).
- Bike model: NS Bikes "Fuzz", a third-party free model; its decals are real brand logos (NS Bikes, Maxxis, RockShox,
  SRAM, Öhlins, Race Face). Fine for a demo; confirm the license before any commercial use.
- Typeface: [Inter](https://rsms.me/inter/) by Rasmus Andersson (SIL Open Font License 1.1), `assets/fonts/`.
- Music and sound: generated by `render/audio.mjs` for this film; no third-party audio.
- Approach adapted from [optionia-app-promo](https://github.com/aowshad/optionia-app-promo).
