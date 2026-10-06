// Publish the rendered film.
//   node render/publish.mjs            GitHub Pages: site/ + the MP4 + poster → the gh-pages branch (force-pushed, no history)
//   node render/publish.mjs --release  also upload the deliverables to the GitHub Release v1.0 (created if missing)
// Needs `npm run render` first, and the gh CLI logged in.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

const REPO = "aowshad/bike-configurator-film", TAG = "v1.0";
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
};
const need = ["dist/bike-configurator-film.mp4", "dist/bike-configurator-film_silent.mp4", "dist/poster.png", "dist/contact-sheet.png"];
for (const f of need) if (!existsSync(f)) throw new Error(`missing ${f}: run npm run render and npm run review first`);

// 1. Pages: a tiny site on the gh-pages branch
const site = "dist/site";
rmSync(site, { recursive: true, force: true }); mkdirSync(site, { recursive: true });
cpSync("site/index.html", `${site}/index.html`);
cpSync("assets/fonts/Inter-Variable.woff2", `${site}/Inter-Variable.woff2`);
cpSync("dist/bike-configurator-film.mp4", `${site}/bike-configurator-film.mp4`);
run(ffmpegPath, ["-y", "-loglevel", "error", "-i", "dist/poster.png", "-q:v", "3", `${site}/poster.jpg`]);
writeFileSync(`${site}/.nojekyll`, "");
const url = run("gh", ["repo", "view", REPO, "--json", "url", "-q", ".url"]);
run("git", ["init", "-q", "-b", "gh-pages"], { cwd: site });
run("git", ["add", "-A"], { cwd: site });
run("git", ["commit", "-q", "-m", "Publish the film"], { cwd: site });
run("git", ["push", "-q", "-f", `${url}.git`, "gh-pages"], { cwd: site });
const pages = spawnSync("gh", ["api", `repos/${REPO}/pages`], { encoding: "utf8" });
if (pages.status !== 0) run("gh", ["api", "-X", "POST", `repos/${REPO}/pages`, "-f", "source[branch]=gh-pages", "-f", "source[path]=/"]);
console.log(`Pages → https://aowshad.github.io/bike-configurator-film/`);

// 2. Release
if (process.argv.includes("--release")) {
  const exists = spawnSync("gh", ["release", "view", TAG, "-R", REPO]).status === 0;
  if (!exists) run("gh", ["release", "create", TAG, "-R", REPO, "--title", "Bike configurator film v1.0", "--notes-file", "dist/release-notes.md"]);
  run("gh", ["release", "upload", TAG, "-R", REPO, "--clobber", ...need]);
  console.log(`Release → https://github.com/${REPO}/releases/tag/${TAG}`);
}
