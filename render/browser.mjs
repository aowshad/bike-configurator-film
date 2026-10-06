// Shared headless Chrome setup for render, stills, audio and the determinism check.
// Chrome's GPU (ANGLE on Metal) renders the app's WebGL; 1920×1080 at DPR 1, dark theme.
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { startServer } from "./server.mjs";

const INJECT = readFileSync(new URL("../film/inject.js", import.meta.url), "utf8");
export const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// The app loads three.js from jsDelivr and its fonts from Google Fonts. Responses are cached on disk (.cache/net,
// gitignored) after the first run, so renders don't depend on CDN latency and load the same bytes every time.
const CACHE = new URL("../.cache/net/", import.meta.url).pathname;
async function cached(route) {
  const url = route.request().url(), key = createHash("sha1").update(url).digest("hex"), body = CACHE + key, meta = body + ".json";
  if (existsSync(meta)) { const m = JSON.parse(readFileSync(meta, "utf8")); return route.fulfill({ status: 200, headers: m.headers, body: readFileSync(body) }); }
  const res = await route.fetch();
  const headers = { "content-type": res.headers()["content-type"] || "application/octet-stream", "access-control-allow-origin": "*" };
  const data = await res.body();
  if (res.ok()) { mkdirSync(CACHE, { recursive: true }); writeFileSync(body, data); writeFileSync(meta, JSON.stringify({ url, headers })); }
  return route.fulfill({ status: res.status(), headers, body: data });
}

export async function openFilm(tries = 3) {
  for (let i = 1; ; i++) {
    try { return await launch(); }
    catch (e) { if (i >= tries) throw e; console.warn(`  launch ${i} failed (${e.message.split("\n")[0]}), retrying`); }
  }
}

async function launch() {
  const { server, port } = await startServer(0);
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--disable-gpu-rasterization", "--force-color-profile=srgb",
      "--hide-scrollbars", "--font-render-hinting=none", "--disable-lcd-text", "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "no-preference" });
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, cached);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript({ content: INJECT });
  let info;
  try {
    await page.goto(`http://127.0.0.1:${port}/film/index.html`, { waitUntil: "load", timeout: 120000 });
    info = await page.evaluate(() => window.__filmReady);
  } catch (e) { await browser.close(); server.close(); throw e; }
  if (!info.fontsOk) throw new Error("Film fonts not loaded: refusing to render with fallbacks.");

  // One frame at film time t: run the timeline, dispatch its input as real events, step the app's clock.
  // Input reaches the app's main thread asynchronously, so before the clock moves on, wait until the app has
  // received it (pointer position, presses, keys): every event lands on the frame it was meant for.
  // Every frame also sends a mouse move (a 1/500 px nudge when the cursor rests), and waits for it: Chrome otherwise
  // updates :hover after a scroll or layout change from its own real-time timer, a frame early or late.
  const sent = { moves: 0, downs: 0, ups: 0, keys: 0 };
  let lastMove = null, nudge = 0;
  async function frame(t) {
    const { cmds, app, zoomed } = await page.evaluate((t) => window.__step(t), t);
    // the browser maps mouse coordinates through the last presented frame: present the new zoom first
    if (zoomed) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    let moveSent = false;
    for (const c of cmds) {
      if (c.type === "move") {
        let x = c.x, y = c.y;
        if (lastMove && lastMove.x === x && lastMove.y === y) { nudge ^= 1; x += nudge ? 0.002 : 0; }
        else nudge = 0;
        lastMove = { x: c.x, y: c.y };
        if (x >= 0 && y >= 0 && x < 1920 && y < 1080) { await page.mouse.move(x, y); sent.moves++; moveSent = true; }
      }
      else if (c.type === "down") { await page.mouse.down(); sent.downs++; }
      else if (c.type === "up") { await page.mouse.up(); sent.ups++; }
      else if (c.type === "key") { await page.keyboard.type(c.key); sent.keys++; }
    }
    if (moveSent || cmds.length > 1) {
      await page.waitForFunction((w) => {
        const i = document.getElementById("app").contentWindow.__film.input;
        return i.moves >= w.moves && i.downs >= w.downs && i.ups >= w.ups && i.keys >= w.keys;
      }, sent, { polling: 1, timeout: 2000 }).catch(async () => {
        const got = await page.evaluate(() => document.getElementById("app").contentWindow.__film.input);
        throw new Error(`input not received at t=${t.toFixed(3)}: sent ${JSON.stringify(sent)}, app has ${JSON.stringify(got)}`);
      });
    }
    await page.evaluate((t) => window.__advance(t), t);
    // content may have scrolled or moved under the resting mouse during that step: settle :hover now, before the
    // capture (Chrome would otherwise do it from a real-time timer after the scroll)
    if (lastMove && lastMove.x >= 0 && lastMove.y >= 0 && lastMove.x < 1920 && lastMove.y < 1080) {
      nudge ^= 1; await page.mouse.move(lastMove.x + (nudge ? 0.002 : 0), lastMove.y); sent.moves++;
      await page.waitForFunction((n) => document.getElementById("app").contentWindow.__film.input.moves >= n, sent.moves, { polling: 1, timeout: 2000 });
    }
  }
  const misses = () => page.evaluate(() => window.__clickLog);
  const shot = () => page.screenshot({ type: "png", caret: "hide" });
  const close = async () => { await browser.close(); server.close(); };
  return { page, info, frame, shot, close, errors, misses };
}
