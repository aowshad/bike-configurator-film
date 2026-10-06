// The storyboard as data. Every action drives the REAL configurator (app/): the cursor travels to a real
// element and the renderer dispatches real (trusted) pointer and key events there. Times are in seconds,
// written on the 120 BPM grid with b(beats), so clicks land on the beat of the music.
//
// Targets are resolved every frame while the cursor travels, so it follows controls that move (sections
// opening, lists scrolling) and lands exactly where the element is when it clicks:
//   { sel }        center of the first element matching a CSS selector inside the app
//   { part }       a visible point on a bike part, projected with the app's live camera (film/inject.js)
//   { x, y }       a fixed point in app coordinates (1920×1080)
import { b, DUR, HIT } from "./tokens.js";

export const SCENES = [
  { id: "intro", t0: b(0), t1: b(5), caption: "Build your bike in 3D" },
  { id: "looks", t0: b(5), t1: b(12), caption: "Start from a look" },
  { id: "paint", t0: b(12), t1: b(20), caption: "Paint every part" },
  { id: "click", t0: b(20), t1: b(27), caption: "Click any part to edit it" },
  { id: "parts", t0: b(27), t1: b(34), caption: "Swap real parts" },
  { id: "text", t0: b(34), t1: b(41), caption: "Make it yours" },
  { id: "share", t0: b(41), t1: b(45.75), caption: "Share your build" },
];
export const END_CARD = { t0: b(46), dur: b(2) };       // as the pull back lands; fully in by 24.0 s, the music's last beat

// The build the film starts from (set before frame 0, not filmed), so the first look click visibly changes the bike.
export const START_LOOK = 1;                             // "Stealth"; the film then clicks Factory → Oil & Gold
export const START_ORBIT = -26;                          // degrees: the intro orbit ends close to the overview

const A = [];
const add = (a) => (A.push(a), a);

/** Travel to `to`, arriving a moment before `t`, and click on `t`. Travel never starts before the previous click. */
let lastClick = -1;
function tap(t, to, { dur = DUR.move, fly = false, sfx = "click" } = {}) {
  const start = Math.max(t - dur - 0.06, lastClick + 0.1);
  add({ t: start, type: "move", to, dur: t - 0.06 - start });
  add({ t, type: "click", fly, sfx });
  lastClick = t;
}
const move = (t, to, dur = DUR.move) => add({ t, type: "move", to, dur });
/** Viewport zoom ("screen recording" style). `to` = { x, y, s } in app coordinates, or { s: 1 } for full frame. */
const zoom = (t, to, dur = DUR.zoom) => add({ t, type: "zoom", to, dur });
/** Scroll a list in the app (what a trackpad swipe does), bringing `child` to the start of `list`. */
const swipe = (t, list, child, dur = DUR.scroll * 1.4) => add({ t, type: "scroll", list, child, dur });
const typeText = (t, text, gap = DUR.key) => [...text].forEach((ch, i) => add({ t: t + i * gap, type: "key", key: ch, i }));

/* ── 1 · Build your bike in 3D (0.0–2.5) ─────────────────────────────────── */
zoom(0, { x: 700, y: 580, s: 1.22 }, 0);                 // start in on the bike (the stage only)…
zoom(b(0.25), { s: 1 }, b(4.5));                         // …and ease out while the UI fades in
add({ t: 0, type: "orbit", on: true, speed: 1.9 });
add({ t: b(4.5), type: "orbit", on: false });
add({ t: b(1), type: "ui", from: 0, to: 1, dur: b(2.6) });

/* ── 2 · Start from a look (2.5–6.0) ─────────────────────────────────────── */
zoom(b(5), { x: 1920, y: 330, s: 1.5 });
add({ t: b(4.25), type: "cursor", show: true, at: { x: 1180, y: 760 } });
tap(b(6), { sel: '[data-preset="0"]' }, { dur: DUR.far, fly: true });            // Stealth → Factory
move(b(6.6), { sel: '[data-preset="2"]' }, DUR.hop);
swipe(b(7.1), "#presets", '[data-preset="3"]');                                  // swipe the row: Oil & Gold comes in
tap(b(9), { sel: '[data-preset="4"]' }, { fly: true });                          // Factory → Oil & Gold
zoom(b(10), { s: 1 });

/* ── 3 · Paint every part (6.0–10.0) ─────────────────────────────────────── */
zoom(b(12), { x: 1920, y: 650, s: 1.3 });
tap(b(13), { sel: '[data-sec="frame"]' }, { dur: DUR.far, fly: true });
tap(b(14), { sel: '[data-k="frame"][data-i="6"]' });                              // Safety Orange
tap(b(15), { sel: '[data-k="frame"][data-i="4"]' }, { dur: DUR.hop });            // Cobalt
tap(b(16), { sel: '[data-k="finish"][data-i="2"]' });                             // Matte…
tap(b(17), { sel: '[data-k="finish"][data-i="3"]' }, { dur: DUR.hop });           // …Metallic
tap(b(18), { sel: '[data-sec="rear"]' }, { fly: true });                          // rear triangle…
tap(b(19), { sel: '[data-k="rear"][data-i="3"]' });                               // …Arctic White: a two-tone
zoom(b(19.5), { s: 1 });

/* ── 4 · Click any part to edit it (10.0–13.5) ───────────────────────────── */
tap(b(21), { sel: '[data-view="overview"]' }, { dur: DUR.far, fly: true });       // back to the full bike
tap(b(23), { part: "fork" }, { dur: DUR.far, fly: true });                         // click the fork on the bike
tap(b(24.5), { sel: '[data-k="fork"][data-i="1"]' }, { dur: DUR.far });           // lowers → White
tap(b(25.5), { sel: '[data-sec="accent"]' }, { fly: true });                      // anodized parts…
tap(b(26.5), { sel: '[data-k="accent"][data-i="2"]' });                           // …Gold

/* ── 5 · Swap real parts (13.5–17.0) ─────────────────────────────────────── */
tap(b(28), { sel: '[data-sec="tires"]' }, { fly: true });                         // camera on the wheel
tap(b(29.5), { sel: '[data-k="tread"][data-i="1"]' });                            // Knobby DH → Semi-slick
tap(b(31), { sel: '[data-sec="cockpit"]' }, { fly: true });
tap(b(32.5), { sel: '[data-k="gripPat"][data-i="1"]' });                          // grip pattern → Diamond

/* ── 6 · Make it yours (17.0–20.5) ───────────────────────────────────────── */
zoom(b(34), { x: 1920, y: 640, s: 1.3 });
tap(b(35), { sel: '[data-sec="stickers"]' }, { fly: true });
tap(b(37), { sel: '[data-spot="down"]' }, { fly: true });                         // camera on the down tube
tap(b(38), { sel: '[data-mode="down"][data-v="1"]' });                            // Custom text (selects the field)
zoom(b(38.25), { s: 1 }, b(2));
typeText(b(38.5), "RIDE FAST");

/* ── 7 · Share your build (20.5–24.0) ────────────────────────────────────── */
zoom(b(41), { x: 1920, y: 0, s: 1.6 });
tap(b(42.5), { sel: "#mainBtn" }, { dur: DUR.far, sfx: "share" });               // "Share build" → Link copied
zoom(b(43), { s: 1 }, b(1.5));                                                   // out by 22.25 s
tap(b(44.5), { sel: '[data-view="overview"]' }, { dur: 0.5, fly: true });          // pull back to the full bike (lands 23.2 s)
add({ t: b(45.5), type: "cursor", show: false });
add({ t: b(46), type: "orbit", on: true, speed: 0.6 });                          // the bike turns gently under the end card

export const ACTIONS = A.sort((p, q) => p.t - q.t || 0);

/** Sound events for render/audio.mjs, straight from the actions (no browser needed). */
export function events() {
  const ev = [];
  for (const a of ACTIONS) {
    if (a.type === "click") {
      ev.push({ time: a.t, type: "click" });
      if (a.fly) ev.push({ time: a.t + 0.03, type: "whoosh", dur: 0.95 });       // the app's camera flight is 950 ms
      if (a.sfx === "share") ev.push({ time: a.t + 0.06, type: "chime" });
    }
    if (a.type === "zoom" && a.dur > 0 && a.dur < 1.5) ev.push({ time: a.t, type: "zoom", dur: a.dur });
    if (a.type === "scroll") ev.push({ time: a.t, type: "swipe", dur: a.dur });
    if (a.type === "key") ev.push({ time: a.t, type: "key", i: a.i });
  }
  ev.push({ time: END_CARD.t0, type: "card" });
  return ev.sort((p, q) => p.time - q.time);
}
export { HIT };
