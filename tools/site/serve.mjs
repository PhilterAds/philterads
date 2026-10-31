// Zero-dependency static server for site/ — `npm run site:preview` → http://127.0.0.1:5310
// Honours directory indexes (/ja/ -> /ja/index.html) and serves 404.html with a 404 status.
// Mirrors the security headers from site/_headers so previews behave like Cloudflare Pages.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../site");
const port = 5310;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};
const security = {
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

createServer(async (req, res) => {
  try {
    let file = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (file.endsWith("/")) file += "index.html";
    if (file.includes("\0")) throw new Error("bad path");
    let target = path.resolve(root, "." + file);
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("forbidden");
      return;
    }
    let status = 200;
    let body;
    try {
      body = await readFile(target);
    } catch {
      target = path.join(root, "404.html");
      body = await readFile(target);
      status = 404;
    }
    res.writeHead(status, {
      "Content-Type": types[path.extname(target).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": file.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      ...security,
    });
    res.end(body);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("server error");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`PhilterAds site preview: http://127.0.0.1:${port}/`);
});
