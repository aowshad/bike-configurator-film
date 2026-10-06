// Grab stills at given film times (the film runs forward from 0; only these frames are captured) and tile them
// into a contact sheet with the time burned in.
//   node render/stills.mjs 1.2 4.6 9.8 …   [--out dist/stills] [--cols 4]
import { mkdirSync, writeFileSync } from "node:fs";
import { openFilm } from "./browser.mjs";
import { sheetOf } from "./sheet.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const out = opt("out", "dist/stills"), cols = +opt("cols", 4), labels = opt("labels", "");
const times = argv.map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
mkdirSync(out, { recursive: true });

const film = await openFilm();
const wanted = new Map(times.map((t) => [Math.round(t * 60), t]));
const last = Math.max(...wanted.keys()), files = [];
for (let f = 0; f <= last; f++) {
  await film.frame(f / 60);
  if (wanted.has(f)) {
    const t = wanted.get(f), file = `${out}/t${t.toFixed(2).padStart(5, "0")}.png`;
    writeFileSync(file, await film.shot()); files.push([file, t]);
  }
}
const missed = await film.misses();
await film.close();
for (const m of missed) console.warn(`MISSED CLICK at ${m.t.toFixed(2)}s: aimed at ${m.aim}, hit ${m.hit}`);
if (film.errors.length) console.warn("page errors:\n  " + film.errors.join("\n  "));
sheetOf(files, `${out}/sheet.png`, cols, labels ? labels.split("|") : null);
console.log(`${files.length} stills → ${out}/ (sheet.png)`);

