// Confirm the delivered files: codec, profile, size, frame rate (constant), duration, audio format, loudness.
//   node render/probe.mjs [file …]   (default: both MP4s in dist/)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import ffprobe from "@ffprobe-installer/ffprobe";
import { measure } from "./audio.mjs";

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["dist/bike-configurator-film.mp4", "dist/bike-configurator-film_silent.mp4"];
for (const f of files.filter(existsSync)) {
  const r = spawnSync(ffprobe.path, ["-v", "error", "-count_frames", "-show_entries",
    "format=duration,size,bit_rate:stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,sample_rate,channels,bit_rate,color_space",
    "-of", "json", f], { encoding: "utf8" });
  const j = JSON.parse(r.stdout), v = j.streams.find((s) => s.codec_type === "video"), a = j.streams.find((s) => s.codec_type === "audio");
  const fps = (x) => { const [n, d] = x.split("/"); return +(n / d).toFixed(3); };
  console.log(`${f}  (${(j.format.size / 1048576).toFixed(1)} MB, ${(+j.format.duration).toFixed(3)} s)`);
  console.log(`  video: ${v.codec_name} ${v.profile}, ${v.pix_fmt}, ${v.width}×${v.height}, ${fps(v.r_frame_rate)} fps (avg ${fps(v.avg_frame_rate)}), ${v.nb_read_frames} frames, ${v.color_space || "?"}, ${Math.round(v.bit_rate / 1000)} kb/s`);
  if (a) {
    const m = measure(f);
    console.log(`  audio: ${a.codec_name} ${a.profile}, ${a.sample_rate} Hz, ${a.channels} ch, ${Math.round(a.bit_rate / 1000)} kb/s · ${m.lufs.toFixed(1)} LUFS integrated, true peak ${m.tp.toFixed(1)} dBTP`);
  } else console.log("  audio: none");
}
