// SEO guard for the static site: every sitemap URL must exist on disk, and
// every indexable page needs a unique title (<= 60), a description (<= 155),
// one H1, a self-referencing canonical, and JSON-LD that parses.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = fileURLToPath(new URL('../site/', import.meta.url));
const ORIGIN = 'https://philterads.com';
const sitemap = readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const fileFor = (url) => path.join(SITE, new URL(url).pathname, 'index.html');
const attr = (html, re) => (html.match(re) || [])[1];
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

test('robots.txt allows crawling and points at the sitemap', () => {
  const robots = readFileSync(path.join(SITE, 'robots.txt'), 'utf8');
  assert.match(robots, /^Allow: \/$/m);
  assert.ok(!/^Disallow: \/$/m.test(robots));
  assert.match(robots, new RegExp(`^Sitemap: ${ORIGIN}/sitemap.xml$`, 'm'));
});

test('every sitemap URL is a slash URL backed by a file', () => {
  assert.ok(locs.length >= 4);
  for (const loc of locs) {
    assert.ok(loc.startsWith(ORIGIN + '/') && loc.endsWith('/'), loc);
    assert.ok(existsSync(fileFor(loc)), `missing file for ${loc}`);
  }
  for (const href of sitemap.matchAll(/hreflang="[^"]+" href="([^"]+)"/g)) {
    assert.ok(locs.includes(href[1]), `hreflang target not in sitemap: ${href[1]}`);
  }
});

test('indexable pages have unique, sized head tags and one H1', () => {
  const titles = new Set();
  for (const loc of locs) {
    const html = readFileSync(fileFor(loc), 'utf8');
    assert.ok(!/<meta name="robots" content="[^"]*noindex/.test(html), `${loc} is noindex`);
    const title = decode(attr(html, /<title>([^<]+)<\/title>/) || '');
    const desc = decode(attr(html, /<meta name="description" content="([^"]+)"/) || '');
    assert.ok(title && [...title].length <= 60, `${loc} title length ${[...title].length}`);
    assert.ok(desc && [...desc].length <= 155, `${loc} description length ${[...desc].length}`);
    assert.ok(!titles.has(title), `duplicate title ${title}`);
    titles.add(title);
    assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1, `${loc} H1 count`);
    assert.strictEqual(attr(html, /<link rel="canonical" href="([^"]+)"/), loc, `${loc} canonical`);
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const data = JSON.parse(m[1]);
      assert.strictEqual(data['@context'], 'https://schema.org', `${loc} JSON-LD context`);
    }
  }
});

test('noindex pages stay out of the sitemap', () => {
  for (const p of ['thanks', '404']) {
    const f = existsSync(path.join(SITE, p, 'index.html')) ? path.join(SITE, p, 'index.html') : path.join(SITE, `${p}.html`);
    if (!existsSync(f)) continue;
    assert.match(readFileSync(f, 'utf8'), /<meta name="robots" content="noindex/);
    assert.ok(!locs.some((l) => l.includes(`/${p}`)), `${p} in sitemap`);
  }
});
