// Tile stills into a contact sheet (640×360 cells) with a label and the time burned in.
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const FONT = "/System/Library/Fonts/Supplemental/Arial.ttf";   // labels on review sheets only, never in the film
export function sheetOf(files, dest, cols, names) {
  const rows = Math.ceil(files.length / cols), W = 640, H = 360;
  const esc = (s) => s.replace(/[':\\]/g, "").replace(/&/g, "and");
  const cells = files.map(([, t], i) => `[${i}]scale=${W}:${H},drawbox=x=0:y=0:w=iw:h=34:color=black@0.6:t=fill,` +
    `drawtext=fontfile=${FONT}:text='${esc((names?.[i] ? names[i] + "   " : "") + t.toFixed(2) + "s")}':x=12:y=8:fontsize=18:fontcolor=white[c${i}]`);
  const pad = Array.from({ length: rows * cols - files.length }, (_, i) => `color=c=0x0b0b0d:s=${W}x${H}:d=1[p${i}]`);
  const all = [...files.map((_, i) => `[c${i}]`), ...pad.map((_, i) => `[p${i}]`)].join("");
  const layout = Array.from({ length: rows * cols }, (_, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`).join("|");
  const graph = [...cells, ...pad, `${all}xstack=inputs=${rows * cols}:layout=${layout}`].join(";");
  const r = spawnSync(ffmpegPath, ["-y", "-loglevel", "error", ...files.flatMap(([f]) => ["-i", f]), "-filter_complex", graph, "-frames:v", "1", dest]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}
