// Proves the film renders the same pixels every time: two fresh browser sessions render the whole timeline and
// the captured frames are compared pixel by pixel. (The app is live and can't seek, so unlike a GSAP film there
// is no shuffled-order pass: both sessions run forward from frame 0, like the real render.)
//   node render/check-determinism.mjs [--every 4] [--to 25]     every = capture one frame in N (the app steps every 1/60 s)
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { openFilm } from "./browser.mjs";
import { FILM } from "../src/tokens.js";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const every = opt("every", 4), to = Math.min(opt("to", FILM), FILM);
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

async function pass(label) {
  const film = await openFilm(), frames = new Map(), started = Date.now();
  for (let f = 0; f < Math.round(to * 60); f++) {
    await film.frame(f / 60);
    if (f % every === 0) frames.set(f, await film.shot());
  }
  await film.close();
  console.log(`  ${label}: ${frames.size} frames captured in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  return frames;
}
const rgb = (png) => spawnSync(ffmpegPath, ["-loglevel", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { input: png, maxBuffer: 64 << 20 }).stdout;

console.log(`Determinism check: every ${every === 1 ? "" : every + "th "}frame of ${to}s, two fresh sessions`);
const A = await pass("session A"), B = await pass("session B");
let same = 0; const diff = [];
for (const [f, a] of A) {
  const b = B.get(f);
  if (sha(a) === sha(b)) { same++; continue; }
  const ra = rgb(a), rb = rgb(b); let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < ra.length; i += 3) {
    const d = Math.max(Math.abs(ra[i] - rb[i]), Math.abs(ra[i + 1] - rb[i + 1]), Math.abs(ra[i + 2] - rb[i + 2]));
    if (d) { n++; if (d > max) max = d; const p = i / 3, x = p % 1920, y = (p / 1920) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  diff.push({ t: +(f / 60).toFixed(3), pixels: n, max, box: `${x0},${y0}–${x1},${y1}` });
  if (diff.length <= 3) { mkdirSync("dist/determinism", { recursive: true }); writeFileSync(`dist/determinism/${f}-A.png`, a); writeFileSync(`dist/determinism/${f}-B.png`, b); }
}
// Timing errors (an event or animation a frame early or late) show up as large differences. What remains in a
// healthy run is rasterizer noise: a few pixels, a few levels, below what the H.264 encode keeps. Tolerance for
// that: at most 16/255 on at most 0.25% of the frame.
const NOISE = { max: 16, share: 0.0025 };
const noisy = diff.filter((d) => d.max <= NOISE.max && d.pixels <= NOISE.share * 1920 * 1080), bad = diff.filter((d) => !noisy.includes(d));
const worst = diff.reduce((w, d) => (d.pixels > (w?.pixels ?? -1) ? d : w), null);
console.log(`  pixel-identical:        ${same}/${A.size}`);
console.log(`  within raster noise:    ${noisy.length}/${A.size}${worst ? `  (worst: ${worst.pixels} px, max ${worst.max}/255 at ${worst.t}s)` : ""}`);
console.log(`  different:              ${bad.length}/${A.size}`);
for (const d of (bad.length ? bad : diff).slice(0, 12)) console.log(`    t=${d.t}s: ${d.pixels} pixels differ (max ${d.max}/255) in ${d.box}`);
console.log(bad.length ? "FAIL" : "PASS: every frame matches (exactly, or within raster noise)");
process.exit(bad.length ? 1 : 0);
