// Frame-by-frame capture of the real app → ffmpeg.
//   npm run render          60 fps 1920×1080, CRF 16, AAC 48 kHz 192k → dist/bike-configurator-film.mp4 (+ _silent.mp4)
//   npm run render:draft    30 fps (the app still steps at 60; every 2nd frame is kept), CRF 22 → dist/draft.mp4
//   options: --fps N --to S --out path --silent
// The app is live, so frames are rendered in order from 0 (no seeking). Run `npm run audio` first for sound.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { openFilm } from "./browser.mjs";
import { FILM } from "../src/tokens.js";
import { events } from "../src/timeline.js";

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const draft = flag("draft"), fps = +opt("fps", draft ? 30 : 60);
if (60 % fps) throw new Error("--fps must divide 60 (the app steps at 60 fps)");
const out = resolve(opt("out", draft ? "dist/draft.mp4" : "dist/bike-configurator-film.mp4"));
const mix = resolve("dist/mix.wav"), withAudio = !flag("silent") && existsSync(mix);
const to = Math.min(+opt("to", FILM), FILM);

mkdirSync("dist", { recursive: true });
writeFileSync("dist/events.json", JSON.stringify(events(), null, 2));
const film = await openFilm();
const frames = Math.round(to * fps), every = 60 / fps;
console.log(`Rendering ${frames} frames @ ${fps} fps 1920×1080 → ${out}${withAudio ? " (+audio)" : ""}`);

const video = ["-c:v", "libx264", "-preset", draft ? "medium" : "slow", "-crf", draft ? "22" : "16", "-profile:v", "high",
  "-pix_fmt", "yuv420p", "-vf", "scale=out_color_matrix=bt709:out_range=tv", "-colorspace", "bt709", "-color_primaries", "bt709",
  "-color_trc", "bt709", "-color_range", "tv", "-r", String(fps), "-fps_mode", "cfr", "-movflags", "+faststart"];
const audio = withAudio ? ["-i", mix, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(to)] : [];
const ff = spawn(ffmpegPath, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", ...audio, ...video, out],
  { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((ok, fail) => ff.on("close", (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))));

const started = Date.now();
for (let f = 0; f < frames; f++) {
  // the app always advances in 1/60 s steps; at 30 fps the in-between step runs without a capture
  for (let s = every - 1; s >= 1; s--) await film.frame((f * every - s) / 60);
  await film.frame(f / fps);
  const buf = await film.shot();
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % fps === 0 || f === frames - 1) {
    const el = (Date.now() - started) / 1000;
    process.stdout.write(`\r  frame ${f + 1}/${frames}  ${(el / (f + 1) * 1000).toFixed(0)} ms/frame  eta ${((frames - f - 1) * el / (f + 1)).toFixed(0)}s   `);
  }
}
ff.stdin.end();
await done;
const missed = await film.misses();
await film.close();
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s → ${out}`);
if (film.errors.length) console.warn("page errors:\n  " + film.errors.join("\n  "));
if (missed.length) { for (const m of missed) console.error(`MISSED CLICK at ${m.t.toFixed(2)}s: aimed at ${m.aim}, hit ${m.hit}`); process.exit(1); }

// the final render also ships a silent copy (same video stream)
if (!draft && withAudio && !opt("out")) {
  const silent = out.replace(/\.mp4$/, "_silent.mp4");
  await new Promise((ok, fail) => spawn(ffmpegPath, ["-y", "-loglevel", "error", "-i", out, "-an", "-c:v", "copy", "-movflags", "+faststart", silent], { stdio: "inherit" })
    .on("close", (c) => (c === 0 ? ok() : fail(new Error("silent copy failed")))));
  console.log(`Silent → ${silent}`);
}
