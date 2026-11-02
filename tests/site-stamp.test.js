import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { htmlFiles, stamp } from "../tools/site/stamp-assets.mjs";

test("site HTML references current asset versions (run npm run site:stamp)", () => {
  for (const f of htmlFiles()) {
    const html = readFileSync(f, "utf8");
    assert.equal(stamp(html), html, `${f} has a stale or missing ?v= stamp`);
    assert.doesNotMatch(html, /["']\/assets\/(js|css)\/[\w.-]+\.(js|css)["']/, `${f} has an unstamped asset`);
  }
});
