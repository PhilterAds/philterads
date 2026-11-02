// Stamps every /assets/js/*.js and /assets/css/*.css reference in the site's HTML with ?v=<content hash>.
// Run before each site deploy (npm run site:stamp). A changed file gets a new URL, so no browser
// keeps an old script or stylesheet from its cache. tests/site-stamp.test.js fails if a stamp is stale.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "site");
const REF = /(["'])(\/assets\/(?:js|css)\/[\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]*)?\1/g;

export function htmlFiles(dir = site) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? htmlFiles(p) : n.endsWith(".html") ? [p] : [];
  });
}

export function hashOf(asset) {
  // line endings normalised so Windows (CRLF) and Linux (LF) checkouts agree on the stamp
  const text = readFileSync(join(site, asset), "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text).digest("hex").slice(0, 10);
}

export function stamp(html) {
  return html.replace(REF, (_, q, asset) => `${q}${asset}?v=${hashOf(asset)}${q}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let changed = 0;
  for (const f of htmlFiles()) {
    const before = readFileSync(f, "utf8");
    const after = stamp(before);
    if (after !== before) { writeFileSync(f, after); changed++; }
  }
  console.log(`stamped ${changed} file(s)`);
}
