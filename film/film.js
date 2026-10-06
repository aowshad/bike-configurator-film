// The film driver (runs in the film page). The renderer (render/browser.mjs) calls, once per frame:
//   __step(t)     run the timeline up to film time t: update cursor, zoom, captions, end card; returns the input
//                 the renderer must dispatch as real (trusted) events: [{ type: "move"|"down"|"up"|"key", … }]
//   __advance(t)  step the app's virtual clock to t (60 steps per second), so it renders the matching frame
// Time only moves forward: the app is live, it cannot seek back.
import { ACTIONS, SCENES, END_CARD, START_LOOK, START_ORBIT } from "../src/timeline.js";
import { SIZE, STEP, DUR, EASE, clamp01, PRODUCT, TAGLINE, URL_LIVE } from "../src/tokens.js";

const $ = (id) => document.getElementById(id);
const iframe = $("app"), viewport = $("viewport"), cursorEl = $("cursor"), rippleEl = $("ripple");
const captionEl = $("caption"), captionText = $("captionText"), cardEl = $("card");
$("cardName").textContent = PRODUCT; $("cardTag").textContent = TAGLINE; $("cardUrl").textContent = URL_LIVE;

let W, D;                                   // the app's window and document
const F = () => W.__film;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PARK = { x: 1180, y: 760 };           // where the real mouse rests while the cursor is hidden (empty stage, where the cursor appears)

/* ── load: real app, fully ready, then the clock freezes ────────────────── */
window.__filmReady = (async () => {
  // the iframe starts on about:blank (which also fires load): wait for the app's own document
  for (let i = 0; !(iframe.contentWindow?.__film && /\/app\//.test(iframe.contentWindow.location.pathname) && iframe.contentDocument.readyState === "complete"); i++) {
    if (i > 3600) throw new Error("app page did not load");
    await sleep(50);
  }
  W = iframe.contentWindow; D = iframe.contentDocument;
  await document.fonts.load('600 28px "Inter Film"'); await document.fonts.load('650 112px "Inter Film"'); await document.fonts.ready;
  for (let i = 0; ; i++) {                  // model + detail LOD + shaders compiled + fonts
    const s = F().status();
    if (s.loader && s.lod === "detail" && s.fonts && s.bike) break;
    if (i > 1800) throw new Error("app not ready: " + JSON.stringify(s));
    await sleep(100);
  }
  await D.fonts.ready;
  F().ui(0);
  F().freeze();
  // now show the looks row: its thumbnails render on the virtual clock, from the same scene state every run
  // (encoding and image decode are real async work, so the clock steps slowly until every card has its image)
  D.documentElement.classList.add("film-live");
  await sleep(150);
  for (let i = 0; !F().status().thumbs; i++) {
    if (i > 3000) throw new Error("look thumbnails did not render");
    F().step(STEP); await sleep(i % 4 ? 0 : 16);
  }
  F().lock();                               // scroll/resize/visibility callbacks now follow the virtual clock too
  // pre-roll on the virtual clock (not filmed): start from another look so the first look click shows a change,
  // then let every transition, toast and camera move settle
  D.querySelector(`[data-preset="${START_LOOK}"]`).click();
  for (let i = 0; i < 60 * 7; i++) { F().step(STEP); if (i % 10 === 0) await sleep(0); }
  F().startPose(START_ORBIT);
  for (let i = 0; i < 6; i++) { F().step(STEP); await sleep(0); }
  v0 = F().now();
  return { fontsOk: document.fonts.check('600 28px "Inter Film"') };
})();
let v0 = 0;

window.__advance = (t) => {
  const target = v0 + t * 1000;
  while (F().now() < target - 0.5) F().step(STEP);
  return F().now() - v0;
};

/* ── tracks ─────────────────────────────────────────────────────────────── */
let next = 0;                               // index of the next action to run
const cursor = { pos: { ...PARK }, shown: false, fade: null, move: null, press: -9, rippleAt: null };
let zoom = { s: 1, tx: 0, ty: 0 }, zoomSeg = null;
let uiSeg = null, lastTarget = null;
window.__clickLog = [];   // clicks that would not hit their target (render/browser.mjs fails on any)

function rectOf(sel) {
  const el = D.querySelector(sel); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function resolve(to) {
  if (to.sel) return rectOf(to.sel);
  if (to.part) return F().partPoint(to.part);
  return { x: to.x, y: to.y };
}
function zoomFor(to) {
  if (to.s === 1 || to.s == null) return { s: 1, tx: 0, ty: 0 };
  const s = to.s;
  const tx = Math.min(0, Math.max(SIZE.w - SIZE.w * s, SIZE.w / 2 - to.x * s));
  const ty = Math.min(0, Math.max(SIZE.h - SIZE.h * s, SIZE.h / 2 - to.y * s));
  return { s, tx, ty };
}
const lerp = (a, b, k) => a + (b - a) * k;
const toScreen = (p) => ({ x: p.x * zoom.s + zoom.tx, y: p.y * zoom.s + zoom.ty });

function cursorAt(t) {
  const m = cursor.move; if (!m) return cursor.pos;
  const k = clamp01((t - m.t0) / m.dur), e = EASE.io(k);
  if (m.to.sel && k < 1) F().reveal(m.to.sel, 400);         // still outside its list? scroll it in (never fights a running scroll)
  const to = resolve(m.to) || m.last; m.last = to;
  // a gentle arc, never a straight line
  const dx = to.x - m.from.x, dy = to.y - m.from.y, bend = 0.08;
  const cx = (m.from.x + to.x) / 2 - dy * bend, cy = (m.from.y + to.y) / 2 + dx * bend, u = 1 - e;
  const p = { x: u * u * m.from.x + 2 * u * e * cx + e * e * to.x, y: u * u * m.from.y + 2 * u * e * cy + e * e * to.y };
  if (k >= 1) { cursor.move = null; cursor.pos = to; return to; }
  return p;
}

/* ── one frame ──────────────────────────────────────────────────────────── */
window.__step = (t) => {
  const cmds = [];
  // 1. actions that start at or before t
  while (next < ACTIONS.length && ACTIONS[next].t <= t + 1e-6) {
    const a = ACTIONS[next++];
    if (a.type === "move") {
      cursor.pos = cursorAt(a.t);
      cursor.move = { t0: a.t, dur: Math.max(a.dur, 1e-3), from: { ...cursor.pos }, to: a.to, last: resolve(a.to) };
      lastTarget = a.to;
    } else if (a.type === "click") {
      // verify: the element under the real mouse must be the one this click was aimed at
      const at = cursorAt(a.t), aim = lastTarget;
      const sc = toScreen(at);
      if (sc.x < 0 || sc.y < 0 || sc.x >= SIZE.w || sc.y >= SIZE.h) window.__clickLog.push({ t: a.t, aim: JSON.stringify(aim), hit: "off-screen", at });
      else if (aim?.sel) {
        const hit = D.elementFromPoint(at.x, at.y);
        if (!hit || !hit.closest(aim.sel)) window.__clickLog.push({ t: a.t, aim: aim.sel, hit: hit ? hit.outerHTML.slice(0, 90) : null, at });
      }
      cmds.push({ type: "down" }, { type: "up" });
      cursor.press = a.t; cursor.rippleAt = null;
    } else if (a.type === "key") {
      cmds.push({ type: "key", key: a.key });
    } else if (a.type === "zoom") {
      const from = zoomAt(a.t), to = zoomFor(a.to);
      zoomSeg = { t0: a.t, dur: a.dur, from, to };
    } else if (a.type === "scroll") {
      F().scrollToChild(a.list, a.child, a.dur * 1000);
    } else if (a.type === "orbit") {
      F().orbit(a.on, a.speed);
    } else if (a.type === "ui") {
      uiSeg = a;
    } else if (a.type === "cursor") {
      if (a.at) cursor.pos = { ...a.at };
      cursor.fade = { t0: a.t, show: a.show };
    }
  }
  // 2. evaluate tracks at t
  const prevZoom = zoom;
  zoom = zoomAt(t);
  const zoomed = zoom.s !== prevZoom.s || zoom.tx !== prevZoom.tx || zoom.ty !== prevZoom.ty;
  viewport.style.transform = `translate(${zoom.tx.toFixed(3)}px,${zoom.ty.toFixed(3)}px) scale(${zoom.s.toFixed(5)})`;
  if (uiSeg) F().ui(lerp(uiSeg.from, uiSeg.to, EASE.ui(clamp01((t - uiSeg.t) / uiSeg.dur))));

  const p = cursorAt(t), sp = toScreen(p);
  const f = cursor.fade, fk = f ? EASE.ui(clamp01((t - f.t0) / 0.3)) : 0, alpha = f ? (f.show ? fk : 1 - fk) : 0;
  const pk = (t - cursor.press) / DUR.press, press = pk >= 0 && pk <= 1 ? 1 - 0.12 * Math.sin(Math.PI * pk) : 1;
  cursorEl.style.opacity = alpha.toFixed(3);
  cursorEl.style.transform = `translate(${sp.x.toFixed(2)}px,${sp.y.toFixed(2)}px) scale(${press.toFixed(4)})`;
  if (pk >= 0 && !cursor.rippleAt) cursor.rippleAt = sp;
  const rk = (t - cursor.press) / 0.42;
  if (rk >= 0 && rk <= 1 && cursor.rippleAt) {
    rippleEl.style.opacity = (0.55 * (1 - EASE.ui(rk)) * alpha).toFixed(3);
    rippleEl.style.transform = `translate(${cursor.rippleAt.x.toFixed(2)}px,${cursor.rippleAt.y.toFixed(2)}px) scale(${(0.35 + 0.75 * EASE.ui(rk)).toFixed(4)})`;
  } else rippleEl.style.opacity = "0";

  captionAt(t);
  const ck = clamp01((t - END_CARD.t0) / END_CARD.dur), ce = EASE.ui(ck);
  cardEl.style.opacity = ce.toFixed(3);
  cardEl.querySelector(".cardIn").style.transform = `translateY(${(14 * (1 - ce)).toFixed(2)}px)`;

  // 3. the real mouse follows the drawn cursor (parked while it is hidden)
  const appPos = cursor.fade?.show ? p : PARK, m = toScreen(appPos);
  cmds.unshift({ type: "move", x: +m.x.toFixed(2), y: +m.y.toFixed(2) });
  return { cmds, app: { x: appPos.x, y: appPos.y }, zoomed };
};

function zoomAt(t) {
  const z = zoomSeg; if (!z) return zoom;
  const k = z.dur > 0 ? EASE.zoom(clamp01((t - z.t0) / z.dur)) : 1;
  return { s: lerp(z.from.s, z.to.s, k), tx: lerp(z.from.tx, z.to.tx, k), ty: lerp(z.from.ty, z.to.ty, k) };
}

function captionAt(t) {
  const sc = [...SCENES].reverse().find((s) => t >= s.t0);
  if (!sc || t > sc.t1 + 0.4) { captionEl.style.opacity = "0"; return; }
  const tin = sc.t0 + (sc.id === "intro" ? 0.45 : 0.1), tout = sc.t1 - 0.3;
  const kin = EASE.ui(clamp01((t - tin) / DUR.caption)), kout = clamp01((t - tout) / 0.3);
  const a = kin * (1 - kout);
  if (captionText.textContent !== sc.caption) captionText.textContent = sc.caption;
  captionEl.style.opacity = a.toFixed(3);
  captionEl.style.transform = `translateY(${(10 * (1 - kin)).toFixed(2)}px)`;
}
