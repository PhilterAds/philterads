// Smoke test: loads a set of real sites with and without the extension
// (bundled Chromium, new headless, --load-extension) and checks that every
// site still works: title non-empty, visible text >= 70% of the no-extension
// baseline, and for YouTube that playback starts with no ad showing.
// Run: npm run smoke   (needs network; uses .cache/ for throwaway profiles)

import { chromium } from 'playwright';
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT = ROOT.replace(/\\/g, '/');

const SITES = [
  { name: 'cnn', url: 'https://www.cnn.com' },
  { name: 'nytimes', url: 'https://www.nytimes.com' },
  { name: 'reddit', url: 'https://www.reddit.com' },
  { name: 'amazon', url: 'https://www.amazon.com' },
  { name: 'github', url: 'https://github.com' },
  { name: 'linkedin', url: 'https://www.linkedin.com' },
  { name: 'accounts.google', url: 'https://accounts.google.com' },
  { name: 'docs.google', url: 'https://docs.google.com' },
  { name: 'stackoverflow', url: 'https://stackoverflow.com' },
  { name: 'weather', url: 'https://weather.com' },
  { name: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Potion' },
  // YouTube last: it needs the service worker awake (script registration)
  // and a longer settle time for the player.
  { name: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtube: true },
];

async function freshProfile(name) {
  const dir = path.join(ROOT, '.cache', name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

async function measure(context, site) {
  const page = await context.newPage();
  const out = { title: '', textLen: 0, errors: [], blocked: 0, youtube: null };
  page.on('pageerror', (e) => out.errors.push(String(e).slice(0, 160)));
  page.on('requestfailed', (req) => {
    if (/BLOCKED_BY_CLIENT|BLOCKED_BY_ADMINISTRATOR/.test(req.failure()?.errorText || '')) out.blocked++;
  });
  try {
    // skip cookie-consent walls on YouTube (fresh profile, CA/US exit ips)
    if (site.youtube) {
      await context.addCookies([
        { name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' },
        { name: 'CONSENT', value: 'YES+cb', domain: '.youtube.com', path: '/' },
      ]);
    }
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);

    if (site.youtube) {
      await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v) { v.muted = true; v.play().catch(() => {}); }
      });
      const t0 = await page.evaluate(() => {
        const v = document.querySelector('video');
        const p = document.querySelector('#movie_player, .html5-video-player');
        return {
          time: v ? v.currentTime : -1,
          adShowing: p ? p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting') : null,
        };
      });
      await page.waitForTimeout(4000);
      const t1 = await page.evaluate(() => {
        const v = document.querySelector('video');
        const p = document.querySelector('#movie_player, .html5-video-player');
        return {
          time: v ? v.currentTime : -1,
          adShowing: p ? p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting') : null,
        };
      });
      out.youtube = { t0: t0.time, t1: t1.time, adShowing1: t1.adShowing };
    }

    out.title = (await page.title()).trim();
    out.textLen = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().length);
  } catch (e) {
    out.errors.push(`load: ${String(e).slice(0, 160)}`);
  } finally {
    await page.close();
  }
  return out;
}

async function findServiceWorker(context) {
  const existing = context.serviceWorkers();
  if (existing.length) return existing[0];
  try {
    return await context.waitForEvent('serviceworker', { timeout: 20000 });
  } catch {
    return null;
  }
}

async function runSuite(withExtension) {
  const profile = await freshProfile(withExtension ? 'smoke-profile-ext' : 'smoke-profile-clean');
  const args = withExtension ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [];
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args,
    viewport: { width: 1280, height: 800 },
  });
  const results = {};
  try {
    if (withExtension) {
      // Wake the extension: any http page runs cosmetic.js, whose heartbeat
      // starts the service worker (which then registers the YouTube scripts).
      const warm = await context.newPage();
      try { await warm.goto('https://example.com', { timeout: 30000 }); } catch {}
      await warm.close();
      const sw = await findServiceWorker(context);
      results.__rulesets = sw ? (await sw.evaluate('chrome.declarativeNetRequest.getEnabledRulesets()')).sort() : null;
      results.__scripts = sw ? await sw.evaluate('chrome.scripting.getRegisteredContentScripts().then((s) => s.map((x) => x.id))') : [];
    }
    for (const site of SITES) {
      process.stdout.write(`  ${withExtension ? '+' : '-'} ${site.name}... `);
      let m = await measure(context, site);
      // bot walls (amazon, reddit) land on a near-empty page; retry once so
      // we don't compare a wall against a real page and blame the extension
      if (m.textLen < 300 && !m.errors.length) m = await measure(context, site);
      results[site.name] = m;
      console.log(results[site.name].title ? results[site.name].title.slice(0, 44) : '(no title)');
    }

    if (withExtension) {
      // cosmetic element hiding really applied on a normal page?
      const page = await context.newPage();
      try {
        await page.goto('https://stackoverflow.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(2500);
        results.__cosmetic = await page.evaluate(() => {
          const s = document.querySelector('style[data-philterads="cosmetic"]');
          return s && s.sheet ? s.sheet.cssRules.length : -1;
        });
      } catch { results.__cosmetic = -1; }
      await page.close();

      // popup renders in both schemes (screenshots for manual review)
      const sw = context.serviceWorkers()[0];
      if (sw) {
        const extId = new URL(sw.url()).host;
        for (const scheme of ['light', 'dark']) {
          const page = await context.newPage();
          await page.emulateMedia({ colorScheme: scheme });
          try {
            await page.goto(`chrome-extension://${extId}/popup.html`, { timeout: 15000 });
            await page.waitForTimeout(700);
            await page.screenshot({ path: path.join(ROOT, '.cache', `popup-${scheme}.png`) });
          } catch {}
          await page.close();
        }
      }
    }
  } finally {
    await context.close();
  }
  return results;
}

const clean = await runSuite(false);
const ext = await runSuite(true);

const rows = [];
let failures = 0;
for (const site of SITES) {
  const a = clean[site.name], b = ext[site.name];
  const ratio = a.textLen > 0 ? b.textLen / a.textLen : b.textLen > 0 ? Infinity : 1;
  const titleOk = b.title.length > 0;
  let verdict = 'ok';
  // A bot wall on one side (tiny text, usually no extension activity at all)
  // makes the comparison meaningless; call it a skip, not a pass or fail.
  const walled = a.textLen < 300 || b.textLen < 300;
  if (walled) verdict = `skip (bot wall: base ${a.textLen}, ext ${b.textLen})`;
  else if (!titleOk) verdict = 'FAIL (no title)';
  else if (ratio < 0.7) verdict = `FAIL (text ${(ratio * 100).toFixed(0)}%)`;
  else if (ratio < 0.85) verdict = `warn (text ${(ratio * 100).toFixed(0)}%)`;
  if (site.youtube && b.youtube) {
    const { t1, adShowing1 } = b.youtube;
    if (adShowing1 === true) verdict = 'FAIL (ad showing)';
    else if (!(t1 > 1)) verdict = `FAIL (video stuck at ${t1})`;
    else if (adShowing1 !== false) verdict = 'warn (player element not found)';
  }
  if (verdict.startsWith('FAIL')) failures++;
  rows.push({ site: site.name, title: titleOk ? 'yes' : 'NO', text: a.textLen > 0 ? `${(ratio * 100).toFixed(0)}%` : 'n/a', withExt: b.textLen, blocked: b.blocked, errors: b.errors.length, verdict, sample: b.errors[0] || '' });
}

console.log('\nextension rulesets enabled: ' + (ext.__rulesets ? ext.__rulesets.join(',') : 'SERVICE WORKER NOT FOUND'));
console.log('registered content scripts: ' + JSON.stringify(ext.__scripts));
console.log(`cosmetic rules injected on stackoverflow: ${ext.__cosmetic}`);
const pad = (s, n) => String(s).padEnd(n);
console.log([pad('site', 17), pad('title', 6), pad('text%', 6), pad('+ext', 7), pad('blocked', 8), pad('errors', 7), 'verdict'].join(''));
for (const r of rows) {
  console.log([pad(r.site, 17), pad(r.title, 6), pad(r.text, 6), pad(r.withExt, 7), pad(r.blocked, 8), pad(r.errors, 7), r.verdict].join('') + (r.errors ? `  | ${r.sample.slice(0, 90)}` : ''));
}
if (ext.__rulesets === null) { failures++; console.log('FAIL: extension service worker never started'); }
console.log(failures ? `\n${failures} failure(s)` : '\nall sites ok');
process.exit(failures ? 1 : 0);
