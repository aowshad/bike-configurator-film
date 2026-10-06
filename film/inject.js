// Injected into every frame before any page script runs (Playwright addInitScript). It only acts inside the
// configurator (the /app/ iframe) and never changes the app's files; it replaces the browser's clocks so the
// film can step the real app frame by frame:
//
//   • Virtual clock: performance.now, Date.now, requestAnimationFrame, setTimeout/setInterval and
//     requestIdleCallback run on a manual clock once the film calls __film.freeze(). Until then they follow
//     real time, so the app loads normally (network, decoding, shader compiles).
//   • CSS transitions and animations are paused and set to the virtual time on every step (Web Animations API).
//   • Smooth scrolling (scrollIntoView behavior "smooth") is re-implemented on the virtual clock: Chrome's own
//     smooth scroll runs on real time.
//   • The GPU timer extension is hidden, so the app's adaptive resolution never reacts to real GPU timings
//     (render cost would otherwise change pixels between runs). The pixel ratio stays at 1.
//   • The clipboard write resolves at once (headless has no clipboard), so "Link copied" appears on the same frame.
//   • Hooks for the film (window.__film): part positions on screen, orbit, the UI fade.
(() => {
  const inApp = /\/app\//.test(location.pathname);
  if (!inApp) return;
  try { localStorage.setItem("dh-theme", "dark"); localStorage.setItem("dh-quality", "high"); sessionStorage.clear(); } catch (e) {}

  /* ── virtual clock ─────────────────────────────────────────────────────── */
  const realNow = performance.now.bind(performance);
  const realSetTimeout = window.setTimeout.bind(window), realRaf = window.requestAnimationFrame.bind(window);
  const dateBase = Date.now() - realNow();
  let frozen = false, vnow = 0, prevV = 0;
  const now = () => (frozen ? vnow : realNow());
  performance.now = now;
  Date.now = () => Math.floor(dateBase + now());

  const timers = new Map(); let seq = 1, pumpAt = Infinity;
  function addTimer(fn, ms, args, repeat) {
    if (typeof fn !== "function") return 0;
    const id = seq++, d = Math.max(0, +ms || 0);
    timers.set(id, { fn, at: now() + d, args, every: repeat ? Math.max(1, d) : 0 });
    if (!frozen) pump();
    return id;
  }
  function nextDue(limit) {
    let best = null, bid = 0;
    for (const [id, t] of timers) if (t.at <= limit && (!best || t.at < best.at || (t.at === best.at && id < bid))) { best = t; bid = id; }
    return best && [bid, best];
  }
  function runTimers(limit) {
    for (let guard = 0; guard < 10000; guard++) {
      const n = nextDue(limit); if (!n) return;
      const [id, t] = n;
      if (frozen) vnow = Math.max(vnow, t.at);
      if (t.every) t.at += t.every; else timers.delete(id);
      try { t.fn(...t.args); } catch (e) { console.error(e); }
    }
  }
  function pump() {                      // real-time mode: fire timers when they are due
    let next = Infinity; for (const t of timers.values()) next = Math.min(next, t.at);
    if (!isFinite(next) || next >= pumpAt) return;
    pumpAt = next;
    realSetTimeout(() => { pumpAt = Infinity; if (frozen) return; runTimers(realNow()); if (timers.size) pump(); }, Math.max(0, next - realNow()));
  }
  window.setTimeout = (fn, ms, ...a) => addTimer(fn, ms, a, false);
  window.setInterval = (fn, ms, ...a) => addTimer(fn, ms, a, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestIdleCallback = (cb) => addTimer(() => cb({ didTimeout: false, timeRemaining: () => 12 }), 1, [], false);
  window.cancelIdleCallback = (id) => { timers.delete(id); };

  const rafs = new Map(); let rafPending = false;
  function flushRaf(time) { const list = [...rafs.values()]; rafs.clear(); for (const cb of list) { try { cb(time); } catch (e) { console.error(e); } } }
  window.requestAnimationFrame = (cb) => {
    const id = seq++; rafs.set(id, cb);
    if (!frozen && !rafPending) { rafPending = true; realRaf(() => { rafPending = false; if (!frozen) flushRaf(realNow()); }); }
    return id;
  };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };

  /* ── CSS animations on the virtual clock ───────────────────────────────── */
  const animStart = new WeakMap();
  function syncAnimations() {
    for (const a of document.getAnimations()) {
      if (!animStart.has(a)) { animStart.set(a, prevV); try { a.pause(); } catch (e) {} }
      const el = vnow - animStart.get(a), end = a.effect?.getComputedTiming().endTime ?? 0;
      if (isFinite(end) && el >= end) { try { a.finish(); } catch (e) {} continue; }
      try { a.currentTime = Math.max(0, el); } catch (e) {}
    }
    prevV = vnow;
  }

  /* ── smooth scrolling on the virtual clock ─────────────────────────────── */
  const scrolls = new Map();             // element → { from, to, t0, dur }
  const easeIO = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  function smoothScroll(el, to, dur = 450) {
    const from = { left: el.scrollLeft, top: el.scrollTop };
    if (Math.abs(from.left - to.left) < 0.5 && Math.abs(from.top - to.top) < 0.5) return;
    const prev = scrolls.get(el);
    scrolls.set(el, { from, to, t0: now(), dur, snap: prev ? prev.snap : el.style.scrollSnapType });
    el.style.scrollSnapType = "none";    // a mandatory snap would pull every intermediate position back
  }
  function tickScrolls() {
    for (const [el, s] of scrolls) {
      const k = Math.min(1, (vnow - s.t0) / s.dur), e = easeIO(k);
      // whole pixels: fractional scroll offsets are rasterized differently from run to run
      el.scrollLeft = Math.round(s.from.left + (s.to.left - s.from.left) * e);
      el.scrollTop = Math.round(s.from.top + (s.to.top - s.from.top) * e);
      if (k >= 1) { el.style.scrollSnapType = s.snap; scrolls.delete(el); }
    }
  }
  const scrollers = (el) => {
    const out = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY) && (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)) out.push(p);
    }
    return out;
  };
  const siv = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (opts) {
    if (!(opts && typeof opts === "object" && opts.behavior === "smooth")) return siv.call(this, opts);
    // measure with an instant scroll, then put EVERY ancestor back (an instant scrollIntoView also moves overflow:hidden
    // boxes and the page itself, which Chrome's smooth scroll leaves alone) and animate only the scrolling lists
    const all = [], list = scrollers(this);
    for (let p = this.parentElement; p; p = p.parentElement) all.push([p, p.scrollLeft, p.scrollTop]);
    const se = document.scrollingElement; if (se && !all.some(([p]) => p === se)) all.push([se, se.scrollLeft, se.scrollTop]);
    // inside the film page, an instant scrollIntoView also scrolls the parent page around the iframe: restore that too
    try {
      for (let w = window; w.frameElement; w = w.parent) {
        for (let p = w.frameElement.parentElement; p; p = p.parentElement) all.push([p, p.scrollLeft, p.scrollTop]);
        const ps = w.parent.document.scrollingElement; if (ps) all.push([ps, ps.scrollLeft, ps.scrollTop]);
      }
    } catch (e) {}
    siv.call(this, { ...opts, behavior: "auto" });                           // where it would end (snap included)
    const to = list.map((s) => ({ left: s.scrollLeft, top: s.scrollTop }));
    for (const [p, l, t] of all) { p.scrollLeft = l; p.scrollTop = t; }
    list.forEach((s, i) => smoothScroll(s, to[i]));
  };

  /* ── browser callbacks on the virtual clock ────────────────────────────── */
  // Chrome delivers scroll events and Resize/IntersectionObserver callbacks on its own (real-time) frames. Once the
  // film locks them (__film.lock(), after loading), they are delivered at a fixed point of every step instead:
  // scroll and resize by comparing positions and sizes, visibility not at all (every zoom keeps the stage and the looks
  // row on screen, so it cannot change while filming).
  let locked = false;
  const scrollTargets = new Map();       // element → last "left,top"
  const sk = (el) => (el === window ? `${scrollX},${scrollY}` : `${el.scrollLeft},${el.scrollTop}`);
  const ael = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type !== "scroll" || typeof fn !== "function") return ael.call(this, type, fn, opts);
    scrollTargets.set(this, null);
    return ael.call(this, type, function (e) { if (locked && e.isTrusted) return; return fn.call(this, e); }, opts);
  };
  function deliverScrolls() {
    for (const [el, last] of scrollTargets) { const k = sk(el); if (k !== last) { scrollTargets.set(el, k); el.dispatchEvent(new Event("scroll")); } }
  }
  const NativeRO = window.ResizeObserver, ros = new Set();
  window.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.targets = new Map(); this.native = new NativeRO((entries) => { if (!locked) cb(entries, this); }); ros.add(this); }
    observe(t, o) { this.targets.set(t, null); this.native.observe(t, o); }
    unobserve(t) { this.targets.delete(t); this.native.unobserve(t); }
    disconnect() { this.targets.clear(); this.native.disconnect(); }
  };
  const rk = (t) => { const r = t.getBoundingClientRect(); return [r, `${r.width}x${r.height}`]; };
  function deliverResizes() {
    for (const ro of ros) {
      const entries = [];
      for (const [t, last] of ro.targets) {
        const [r, k] = rk(t); if (k === last) continue;
        ro.targets.set(t, k);
        entries.push({ target: t, contentRect: r, borderBoxSize: [{ inlineSize: r.width, blockSize: r.height }], contentBoxSize: [{ inlineSize: r.width, blockSize: r.height }] });
      }
      if (entries.length) try { ro.cb(entries, ro); } catch (e) { console.error(e); }
    }
  }
  const NativeIO = window.IntersectionObserver;
  window.IntersectionObserver = class extends NativeIO {
    constructor(cb, o) { super((entries, obs) => { if (!locked) cb(entries, obs); }, o); }
  };
  function lock() {
    for (const el of scrollTargets.keys()) scrollTargets.set(el, sk(el));
    for (const ro of ros) for (const t of ro.targets.keys()) ro.targets.set(t, rk(t)[1]);
    locked = true;
  }

  /* ── outside effects ───────────────────────────────────────────────────── */
  const hideTimer = (C) => {
    if (!C) return;
    const ge = C.prototype.getExtension, gs = C.prototype.getSupportedExtensions;
    C.prototype.getExtension = function (n) { return /disjoint_timer_query/i.test(n) ? null : ge.call(this, n); };
    C.prototype.getSupportedExtensions = function () { return (gs.call(this) || []).filter((n) => !/disjoint_timer_query/i.test(n)); };
  };
  hideTimer(window.WebGL2RenderingContext); hideTimer(window.WebGLRenderingContext);
  try { if (window.Clipboard) Clipboard.prototype.writeText = function () { return Promise.resolve(); }; } catch (e) {}

  /* ── film hooks ─────────────────────────────────────────────────────────── */
  const B = () => window.__bike;
  window.__film = {
    get frozen() { return frozen; },
    now,
    freeze() { if (!frozen) { vnow = prevV = realNow(); frozen = true; } return vnow; },
    lock,
    /** Advance the virtual clock by dt ms: timers in order, then scroll animations, then rAF, then CSS animations. */
    step(dt) {
      const end = vnow + dt;
      runTimers(end);
      vnow = end;
      tickScrolls();
      if (locked) deliverScrolls();
      flushRaf(vnow);
      if (locked) deliverResizes();
      syncAnimations();
      return vnow;
    },
    /** Everything the film needs before frame 0: model, detail LOD, shaders, look thumbnails, fonts. */
    status() {
      const d = document, looks = [...d.querySelectorAll(".look")];
      return {
        loader: !!d.querySelector("#loader.done"), lod: d.documentElement.dataset.lod || "",
        thumbs: looks.length > 0 && looks.every((l) => l.classList.contains("ready") && [...l.querySelectorAll(".lthumb img.on")].every((i) => i.complete)),
        fonts: d.fonts.status === "loaded",
        bike: !!B(),
      };
    },
    smoothScroll,
    /** Scroll `list` so `child` sits at its start (respecting the list's scroll padding). */
    scrollToChild(listSel, childSel, dur) {
      const list = document.querySelector(listSel), child = document.querySelector(childSel);
      if (!list || !child) return false;
      const cs = getComputedStyle(list), lr = list.getBoundingClientRect(), cr = child.getBoundingClientRect();
      const padL = parseFloat(cs.scrollPaddingLeft) || 0, padT = parseFloat(cs.scrollPaddingTop) || 0;
      const horizontal = list.scrollWidth > list.clientWidth && cs.overflowX !== "visible";
      const to = horizontal
        ? { left: Math.min(list.scrollWidth - list.clientWidth, list.scrollLeft + cr.left - lr.left - padL), top: list.scrollTop }
        : { left: list.scrollLeft, top: Math.min(list.scrollHeight - list.clientHeight, list.scrollTop + cr.top - lr.top - padT) };
      smoothScroll(list, to, dur);
      return true;
    },
    /** If `el` is outside its scrolling list, scroll it into view smoothly (what a wheel scroll would do). */
    reveal(sel, dur = 450) {
      const el = document.querySelector(sel); if (!el) return false;
      for (const s of scrollers(el)) {
        const sr = s.getBoundingClientRect(), r = el.getBoundingClientRect(), m = 24;
        let top = s.scrollTop;
        if (r.bottom > sr.bottom - m) top += r.bottom - (sr.bottom - m);
        if (r.top < sr.top + m) top -= (sr.top + m) - r.top;
        top = Math.max(0, Math.min(s.scrollHeight - s.clientHeight, top));
        if (Math.abs(top - s.scrollTop) > 1 && !scrolls.has(s)) smoothScroll(s, { left: s.scrollLeft, top }, dur);
      }
      return true;
    },
    /** A point on a part that the app's own click raycast resolves to that part, in app (client) coordinates. */
    partPoint(prefix) {
      const b = B(); if (!b) return null;
      const { THREE, camera, renderer } = b, low = b.low;
      camera.updateMatrixWorld();
      const rect = renderer.domElement.getBoundingClientRect();
      const pick = low.pickables.filter((o) => { for (let x = o; x && x !== low.root; x = x.parent) if (!x.visible) return false; return true; });
      const ray = new THREE.Raycaster(), v = new THREE.Vector3(), ndc = new THREE.Vector2(), hits = [];
      for (const o of pick) {
        if (!String(o.userData.slot || "").startsWith(prefix)) continue;
        const a = o.geometry.attributes.position, step = Math.max(1, (a.count / 300) | 0);
        o.updateMatrixWorld();
        for (let i = 0; i < a.count; i += step) {
          v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld).project(camera);
          ndc.set(v.x, v.y); ray.setFromCamera(ndc, camera);
          const h = ray.intersectObjects(pick, false)[0];
          if (h && String(h.object.userData.slot || "").startsWith(prefix)) hits.push([v.x, v.y]);
        }
      }
      if (!hits.length) return null;
      const cx = hits.reduce((s, h) => s + h[0], 0) / hits.length, cy = hits.reduce((s, h) => s + h[1], 0) / hits.length;
      hits.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
      const [x, y] = hits[0];
      return { x: rect.left + (x + 1) / 2 * rect.width, y: rect.top + (1 - y) / 2 * rect.height };
    },
    /** Place the camera at the overview, turned by `deg` around the bike (the intro orbit starts here). */
    startPose(deg) {
      const b = B(); b.flyTo("overview", true);
      const { camera, controls } = b, off = camera.position.clone().sub(controls.target);
      off.applyAxisAngle(new b.THREE.Vector3(0, 1, 0), deg * Math.PI / 180);
      camera.position.copy(controls.target).add(off); controls.update(); controls.dispatchEvent({ type: "change" });
    },
    orbit(on, speed = 0.7) {
      const { controls } = B(); controls.autoRotate = on; controls.autoRotateSpeed = speed;
      controls.dispatchEvent({ type: "change" });            // the app renders on demand: wake it up
    },
    /** Opacity of the app's UI chrome (top bar, panel, hint) for the intro fade. */
    ui(alpha) { document.documentElement.style.setProperty("--film-ui", String(alpha)); },
  };
  // every real press, for the renderer's click check (what the app actually received)
  window.__film.presses = [];
  // what the app has received so far; the renderer waits for its own input to land here before stepping the clock
  const input = window.__film.input = { moves: 0, downs: 0, ups: 0, keys: 0, x: NaN, y: NaN };
  addEventListener("pointermove", (e) => { input.moves++; input.x = e.clientX; input.y = e.clientY; }, true);
  addEventListener("pointerup", () => { input.ups++; }, true);
  addEventListener("keydown", () => { input.keys++; }, true);
  addEventListener("pointerdown", (e) => {
    input.downs++; input.x = e.clientX; input.y = e.clientY;
    const el = e.target, id = el.closest?.("[data-sec],[data-spot],[data-k],[data-mode],[data-preset],[data-view],button,canvas");
    window.__film.presses.push({ t: vnow, x: e.clientX, y: e.clientY, el: id ? id.outerHTML.slice(0, 80) : el.tagName });
  }, true);
  // The look thumbnails render lazily while their row is on screen. Rendered in real time during loading they pick up
  // whatever shadow map the scene has at that moment (it depends on load timing), so the row stays out of layout until
  // the clock is frozen, and all thumbnails render on the virtual clock instead (film.js).
  const css = ".topbar,.panel,#hint{opacity:var(--film-ui,1)} html:not(.film-live) #presets{display:none}";
  const addCss = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
  if (document.head) addCss(); else document.addEventListener("DOMContentLoaded", addCss);
})();
