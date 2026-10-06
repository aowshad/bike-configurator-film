// Review a rendered video: three stills per scene (after it opens, its middle, just before it ends) plus the end
// card, tiled into one contact sheet with scene names and times.
//   node render/review.mjs [dist/draft.mp4] [--out dist/review]
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { SCENES, END_CARD } from "../src/timeline.js";
import { FILM } from "../src/tokens.js";
import { sheetOf } from "./sheet.mjs";

const argv = process.argv.slice(2);
const oi = argv.indexOf("--out"), out = oi >= 0 ? argv.splice(oi, 2)[1] : "dist/review";
const video = argv[0] || "dist/draft.mp4";
mkdirSync(out, { recursive: true });
const shots = [];
for (const s of SCENES) for (const [k, t] of [["in", s.t0 + 0.7], ["mid", (s.t0 + s.t1) / 2], ["out", s.t1 - 0.25]]) shots.push([s.caption, +t.toFixed(2)]);
shots.push(["End card", +(END_CARD.t0 + END_CARD.dur + 0.3).toFixed(2)], ["Last frame", +(FILM - 0.04).toFixed(2)]);
const files = shots.map(([name, t], i) => {
  const f = `${out}/${String(i).padStart(2, "0")}-t${t.toFixed(2)}.png`;
  const r = spawnSync(ffmpegPath, ["-y", "-loglevel", "error", "-ss", String(t), "-i", video, "-frames:v", "1", f]);
  if (r.status) throw new Error(r.stderr.toString());
  return [f, t];
});
sheetOf(files, `${out}/sheet.png`, 3, shots.map(([n]) => n));
console.log(`${files.length} stills from ${video} → ${out}/sheet.png`);
