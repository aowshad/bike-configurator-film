// Tiny static server for the repo root: the film page (film/), the app submodule (app/), src/ and assets/.
//   npm run dev   → http://localhost:5190/film/  (the film page loads; the renderer drives it)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".json": "application/json", ".glb": "model/gltf-binary", ".wav": "audio/wav", ".m4a": "audio/mp4", ".mp4": "video/mp4",
};

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = normalize(join(ROOT, p));
      if (!file.startsWith(ROOT)) throw new Error("forbidden");
      await stat(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ server, port: server.address().port })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startServer(+(process.env.PORT || 5190));
  console.log(`Film page → http://localhost:${port}/film/   (the app alone: http://localhost:${port}/app/)`);
}
