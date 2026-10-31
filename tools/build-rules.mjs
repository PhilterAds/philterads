// Builds rulesets/ and cosmetic/ from the upstream filter lists.
// Run: npm run build:rules   (add --offline to reuse .cache without network)
//
// Pipeline per list: download -> split into cosmetic / network filters ->
// network filters through @eyeo/abp2dnr (eyeo's ABP->DNR converter, the same
// core Adblock Plus ships) -> post-process (drop main_frame blocking outside
// the malware list, enforce the safety-domain guarantee, literal regexes back
// to urlFilter, regex cap) -> collapse ||domain^ rules into merged
// requestDomains chunks -> priorities + contiguous ids -> write + validate.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertFilter } from '@eyeo/abp2dnr';
import { LISTS, HAND_RULESETS, LIMITS } from './lib/lists.js';
import { safetyFilter, mergeRules, assignPriorities, assignIds, blockRanges, validateRuleset } from './lib/dnr.js';
import { collectPopupHosts } from './lib/popups.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = path.join(ROOT, '.cache');
const offline = process.argv.includes('--offline');

const counter = () => {
  const c = {};
  return { add: (k, n = 1) => { c[k] = (c[k] || 0) + n; }, get: () => c };
};

// ---------------------------------------------------------------- download

async function download(list) {
  const file = path.join(CACHE, `${list.id}.txt`);
  if (offline && existsSync(file)) return readFile(file, 'utf8');
  const res = await fetch(list.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${list.id}: HTTP ${res.status} for ${list.url}`);
  const text = await res.text();
  if (text.startsWith('<') || text.length < 500) throw new Error(`${list.id}: response does not look like a filter list`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, text);
  return text;
}

function listVersion(text) {
  for (const line of text.split('\n')) {
    const m = /^[!#]\s*(Version|Updated|Last modified):\s*(.+)$/.exec(line);
    if (m) return `${m[1]}: ${m[2].trim()}`;
  }
  return 'unknown';
}

// ---------------------------------------------------------------- parsing

// ABP cosmetic separator. Longest markers first so #@# wins over ##.
const MARKER_RE = /(#@%#|#@\$#|#\$\?#|#@@#|#@#|#\?#|#\$#|#%#|##)/;
const DOMAIN_ENTRY_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

// Extended-css / snippet syntax we do not apply at runtime (would need a
// scriptlet or selector engine we deliberately don't ship). Native CSS the
// browser itself supports (:has, :is, :not, :where) is fine and kept.
const EXTENDED_SELECTOR = /:-abp-|:has-text|:xpath|:remove\(|:remove-attr|:remove-class|:style\(|:upward|:nth-ancestor|:matches-attr|:matches-path|:matches-css|:matches-property|:min-text-length|:others\(|:watch-attr|:if\(|:else\(|:shadow\(/;

function isCosmeticLine(line) {
  if (!line.includes('#')) return false;
  const m = MARKER_RE.exec(line);
  if (!m) return false;
  const prefix = line.slice(0, m.index);
  // A cosmetic prefix is '' or domain(s) separated by |; anything URL-ish
  // means the # belongs to the URL, not to a cosmetic rule.
  return prefix === '' || /^[a-z0-9.|~*-]+$/i.test(prefix);
}

// Cosmetic parse result, or null if the line is not cosmetic.
function parseCosmetic(line, stats) {
  const m = MARKER_RE.exec(line);
  if (!m) return null;
  const marker = m[1];
  const prefix = line.slice(0, m.index);
  const selector = line.slice(m.index + marker.length);
  const domains = prefix === '' ? [] : prefix.split('|');

  // Unsupported prefix forms: exclusions (~foo.com), wildcards, and
  // non-hostnames ("sgcarmart" is not a resolvable domain).
  if (domains.some((d) => d.startsWith('~') || d.includes('*'))) { stats.add('cosmetic-skipped-negated-domain'); return { skip: true }; }
  if (domains.some((d) => !DOMAIN_ENTRY_RE.test(d))) { stats.add('cosmetic-skipped-bad-domain'); return { skip: true }; }

  if (marker === '#@#') {
    if (!selector || EXTENDED_SELECTOR.test(selector)) { stats.add('cosmetic-skipped-extended'); return { skip: true }; }
    return { exception: true, domains, selector };
  }
  if (marker !== '##') { stats.add('cosmetic-skipped-snippet'); return { skip: true }; } // #?# #$# #%# #@@# ...
  if (!selector || selector.startsWith('^') || selector.startsWith('+js(') || EXTENDED_SELECTOR.test(selector)) {
    stats.add('cosmetic-skipped-extended');
    return { skip: true };
  }
  return { domains, selector };
}

// ---------------------------------------------------------------- build one list

async function buildList(list) {
  const text = await download(list);
  const stats = counter();
  stats.add('lines-read', 0);
  let lines = 0;
  const version = listVersion(text);

  const cosmetic = {
    generic: new Set(),
    genericExceptions: new Set(),
    domains: {},   // host -> [selectors]
    exceptions: {}, // host -> [selectors]
    generichide: new Set(),
    elemhide: new Set(),
  };
  const networkFilters = [];
  const rawLines = text.split('\n');

  for (let raw of rawLines) {
    raw = raw.trim();
    if (!raw) continue;
    if (raw.startsWith('!') || raw.startsWith('[')) continue; // comment / [Adblock Plus 2.0]
    if (list.plainDomains && raw.startsWith('#')) continue;
    lines++;

    if (list.plainDomains) {
      // host-style list: turn each entry into an ABP domain block
      if (DOMAIN_ENTRY_RE.test(raw) || /^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) networkFilters.push(`||${raw.toLowerCase()}^`);
      else stats.add('skipped-malformed-line');
      continue;
    }

    // $elemhide / $generichide exceptions affect cosmetics only; pull the
    // domain out here (the DNR converter emits nothing for these options).
    if (raw.startsWith('@@') && /\$(elemhide|generichide)/.test(raw)) {
      const dm = /^\|\|([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.exec(raw);
      if (dm) {
        const d = dm[1].toLowerCase();
        if (/\$elemhide/.test(raw)) { cosmetic.elemhide.add(d); stats.add('elemhide-domains'); }
        else { cosmetic.generichide.add(d); stats.add('generichide-domains'); }
      } else stats.add('skipped-generichide-no-domain');
      // may still carry network options worth converting; fall through
    }

    if (isCosmeticLine(raw)) {
      const c = parseCosmetic(raw, stats);
      if (c && !c.skip) {
        if (c.exception) {
          if (c.domains.length === 0) cosmetic.genericExceptions.add(c.selector);
          else for (const d of c.domains) {
            (cosmetic.exceptions[d.toLowerCase()] ||= []).push(c.selector);
          }
          stats.add('cosmetic-exceptions');
        } else {
          if (c.domains.length === 0) { cosmetic.generic.add(c.selector); stats.add('cosmetic-generic'); }
          else {
            for (const d of c.domains) (cosmetic.domains[d.toLowerCase()] ||= []).push(c.selector);
            stats.add('cosmetic-specific');
          }
        }
      }
      continue; // cosmetic lines never reach the DNR converter
    }

    networkFilters.push(raw);
  }
  stats.get()['lines-read'] = lines;

  // ---- popup hosts ----
  // $popup filters produce no DNR rules (the converter emits nothing for
  // them); their plain host anchors feed the runtime tab guard instead
  // (rulesets/popups.json + /popups.js + background.js). domain= -scoped
  // ones keep their opener scope; negated scopes are skipped and counted.
  const popup = collectPopupHosts(text);
  stats.add('popup-filters', popup.filters);
  stats.add('popup-hosts', popup.hosts.length);
  stats.add('popup-scoped-hosts', Object.keys(popup.scoped).length);
  stats.add('popup-negated', popup.negated);
  stats.add('popup-safety-dropped', popup.safety);

  // ---- network conversion ----
  let rules = [];
  for (const filter of networkFilters) {
    let out;
    try {
      out = await convertFilter(filter);
    } catch {
      stats.add('skipped-unconvertible'); // cosmetic in disguise, $redirect=, sitekey, ...
      continue;
    }
    if (!Array.isArray(out) || out.length === 0) { stats.add('skipped-empty-translation'); continue; } // $popup, $elemhide-only ...
    let kept = 0;
    for (const r of out) {
      const p = postRule(r, list, stats);
      if (p) { rules.push(p); kept++; }
    }
    if (kept) stats.add('network-filters-converted');
    else stats.add('network-filters-dropped-post');
  }

  rules = safetyFilter(rules, (k) => stats.add(k));
  rules = mergeRules(rules);
  // different filters can collapse to the same rule; keep one of each
  {
    const seen = new Set();
    rules = rules.filter((r) => {
      const key = JSON.stringify({ a: r.action, c: r.condition });
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  // regex budget: keep at most LIMITS.regexPerRuleset - some margin
  const regexCap = LIMITS.regexPerRuleset - 10;
  let seenRegex = 0;
  rules = rules.filter((r) => {
    if (!r.condition.regexFilter) return true;
    if (++seenRegex > regexCap) { stats.add('skipped-regex-overflow'); return false; }
    return true;
  });
  assignPriorities(rules);
  assignIds(rules);
  rules.sort((a, b) => a.id - b.id); // file order matches the id ranges in blocks.json

  const { errors, regexCount } = validateRuleset(list.id, rules);
  if (errors.length) throw new Error(`${list.id} validation failed:\n  ${errors.slice(0, 10).join('\n  ')}`);
  stats.add('rules-written', rules.length);

  return { list, rules, cosmetic, popupHosts: { hosts: popup.hosts, scoped: popup.scoped }, stats: stats.get(), version };
}

// Chrome rejects a whole static ruleset over one invalid domain entry, so
// entries must be real multi-label hostnames. Positive lists just lose the
// entry; for exclusion lists losing an entry would broaden the rule, so the
// rule goes instead.
const GOOD_DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

function sanitizeDomains(c, stats) {
  for (const key of ['initiatorDomains', 'requestDomains']) {
    if (!Array.isArray(c[key])) continue;
    const kept = c[key].filter((d) => GOOD_DOMAIN.test(d));
    if (kept.length !== c[key].length) stats.add('dropped-bad-domain-entry');
    if (kept.length === 0) { delete c[key]; return false; }
    c[key] = kept;
  }
  for (const key of ['excludedInitiatorDomains', 'excludedRequestDomains']) {
    if (!Array.isArray(c[key])) continue;
    if (c[key].some((d) => !GOOD_DOMAIN.test(d))) { stats.add('dropped-rule-bad-excluded-domain'); return false; }
  }
  return true;
}

// main_frame policy + field normalization on one converted rule.
function postRule(r, list, stats) {
  const c = (r.condition = r.condition || {});
  // deprecated fields -> modern equivalents (eyeo emits modern ones already)
  if (c.domains) { c.initiatorDomains = c.domains; delete c.domains; }
  if (c.excludedDomains) { c.excludedInitiatorDomains = c.excludedDomains; delete c.excludedDomains; }

  if (r.action.type !== 'block' && r.action.type !== 'allow' && r.action.type !== 'allowAllRequests') {
    stats.add('skipped-unsupported-action'); // redirect=, modifyHeaders(CSP), ...
    return null;
  }

  if (!sanitizeDomains(c, stats)) return null;

  if (r.action.type === 'block' && !list.blockMainFrame) {
    if (Array.isArray(c.resourceTypes)) {
      const kept = c.resourceTypes.filter((t) => t !== 'main_frame');
      if (kept.length === 0) { stats.add('skipped-mainframe-only'); return null; }
      if (kept.length !== c.resourceTypes.length) stats.add('stripped-mainframe-from-types');
      c.resourceTypes = kept;
    } else {
      c.excludedResourceTypes = ['main_frame']; // never block top-level navigation
    }
  }

  // A regex with no metacharacters is a plain substring: urlFilter is
  // equivalent and does not eat the 1000-regex budget.
  if (c.regexFilter && /^[A-Za-z0-9%._/:~-]+$/.test(c.regexFilter)) {
    c.urlFilter = c.regexFilter;
    delete c.regexFilter;
  }
  if (!c.urlFilter && !c.regexFilter && !c.requestDomains) { stats.add('skipped-conditionless'); return null; }
  return r;
}

// ---------------------------------------------------------------- write out

async function main() {
  const results = [];
  for (const list of LISTS) {
    process.stdout.write(`building ${list.id}... `);
    const r = await buildList(list);
    results.push(r);
    console.log(`${r.rules.length} rules, ${r.stats['lines-read']} filters`);
  }

  await mkdir(path.join(ROOT, 'rulesets'), { recursive: true });
  await mkdir(path.join(ROOT, 'cosmetic'), { recursive: true });

  const blocksIndex = {};
  const popupHostsByList = {};
  let enabledTotal = 0;
  const statsRows = [];

  for (const r of results) {
    await writeFile(path.join(ROOT, 'rulesets', `${r.list.id}.json`), JSON.stringify(r.rules));
    blocksIndex[r.list.id] = blockRanges(r.list.id, r.rules);
    if (r.list.defaultOn) enabledTotal += r.rules.length;
    if (r.popupHosts.hosts.length || Object.keys(r.popupHosts.scoped).length) popupHostsByList[r.list.id] = r.popupHosts;

    if (r.list.cosmetic) {
      const payload = {
        generic: [...r.cosmetic.generic],
        genericExceptions: [...r.cosmetic.genericExceptions],
        domains: r.cosmetic.domains,
        exceptions: r.cosmetic.exceptions,
        generichide: [...r.cosmetic.generichide],
        elemhide: [...r.cosmetic.elemhide],
      };
      await writeFile(path.join(ROOT, 'cosmetic', `${r.list.id}.json`), JSON.stringify(payload));
    }
    statsRows.push({ list: r.list, rules: r.rules, stats: r.stats, version: r.version, filters: r.filters });
  }

  // hand-maintained rulesets join the block index so the popup counter works
  for (const h of HAND_RULESETS) {
    const rules = JSON.parse(await readFile(path.join(ROOT, h.path), 'utf8'));
    const { errors } = validateRuleset(h.id, rules);
    if (errors.length) throw new Error(`${h.path} failed validation:\n  ${errors.join('\n  ')}`);
    blocksIndex[h.id] = blockRanges(h.id, rules);
    enabledTotal += rules.length;
  }
  await writeFile(path.join(ROOT, 'rulesets', 'blocks.json'), JSON.stringify(blocksIndex, null, 1) + '\n');

  if (enabledTotal > LIMITS.enabledStaticTotal) {
    throw new Error(`enabled static rules ${enabledTotal} > policy limit ${LIMITS.enabledStaticTotal}`);
  }

  // Host data for the runtime pop-up ad-tab guard (not a DNR ruleset).
  await writeFile(path.join(ROOT, 'rulesets', 'popups.json'), JSON.stringify(popupHostsByList));

  await writeStats(statsRows, enabledTotal);
  console.log(`\nenabled-by-default static rules: ${enabledTotal} (limit ${LIMITS.enabledStaticTotal})`);
}

async function writeStats(rows, enabledTotal) {
  const head = ['list', 'source version', 'filters read', 'DNR rules written', '$popup hosts (global/scoped)', 'skipped by DNR converter', 'dropped: main_frame policy', 'dropped: safety domains', 'dropped: regex overflow', 'cosmetic generic/specific/exceptions', 'cosmetic skipped (extended)'];
  const table = [head, head.map(() => '---')];
  for (const { list, stats, version } of rows) {
    table.push([
      list.id, version,
      stats['lines-read'] ?? 0,
      stats['rules-written'] ?? 0,
      `${stats['popup-hosts'] ?? 0}/${stats['popup-scoped-hosts'] ?? 0}`,
      (stats['skipped-unconvertible'] ?? 0) + (stats['skipped-empty-translation'] ?? 0),
      (stats['skipped-mainframe-only'] ?? 0) + (stats['stripped-mainframe-from-types'] ?? 0),
      stats['safety-domain'] ?? 0,
      stats['skipped-regex-overflow'] ?? 0,
      `${stats['cosmetic-generic'] ?? 0}/${stats['cosmetic-specific'] ?? 0}/${stats['cosmetic-exceptions'] ?? 0}`,
      (stats['cosmetic-skipped-extended'] ?? 0) + (stats['cosmetic-skipped-snippet'] ?? 0) + (stats['cosmetic-skipped-negated-domain'] ?? 0),
    ]);
  }
  const notes = [
    '# Ruleset build stats', '',
    `Built ${new Date().toISOString()}`, '',
    ...table.map((r) => `| ${r.join(' | ')} |`), '',
    `Enabled-by-default static rules (core + safety + easylist + easyprivacy + malware): **${enabledTotal}**. Chrome guarantees 30k per extension plus a shared pool; this build's policy cap is ${LIMITS.enabledStaticTotal}.`, '',
    'Notes:', '',
    '- `rulesets/core.json` (hand rules, moved from the old root `rules.json`) and `rulesets/safety.json` (login/payment/captcha allow rules) are hand-maintained; the build only indexes them into `rulesets/blocks.json`.',
    '- Outside the malware list, block rules never match `main_frame`: navigation is never blocked, so following a link always works. The malware list blocks whole malicious domains including top-level navigation (that is its job).',
    '- `safety.json` allows accounts.google.com, docs/mail/drive.google.com, gstatic, apis.google.com, challenges.cloudflare.com, recaptcha, hcaptcha, stripe, paypal and www.google.com/recaptcha at a priority above every list rule, and the build drops any list rule that would block those hosts outright.',
    `- \`||domain^\` rules are collapsed into merged \`requestDomains\` chunks of at most ${LIMITS.domainsPerRule} domains, which is what keeps the rule count inside Chrome's limits.`,
    "- The malware list uses urlhaus-filter's domain-based *online* variant: the ABP/URL-based online list is ~105k path-specific filters on popular hosts (CDNs, docs.google.com, discord...) which no static DNR ruleset can hold; the domain variant carries the same upstream data as whole-domain blocks plus raw IPs.",
    '- Element-hiding rules with extended-css / snippet syntax (`#?#`, `#$#`, `:-abp-`, `:has-text`, `+js()`, `:style()`, negated domain prefixes) are skipped and counted, not guessed at.',
    '- `rulesets/popups.json` (list id -> `{ hosts, scoped }`, not a DNR ruleset) carries the `||host^$popup` filters, which declarativeNetRequest cannot express; background.js closes young tabs that have an opener and land on one of those hosts (never same-site tabs, paused sites or safety hosts). `domain=` -scoped filters keep their scope — the host only closes popups whose opener site is on its domain list, so link shorteners like t.co stay clickable everywhere except the sites the list caught abusing them. Filters with negated domains, pattern/regex `$popup` filters and the `third-party` qualifier (implied by the never-close-same-site rule) are not carried; safety-domain hosts and their parents are excluded like everywhere else.',
    '- Regex rules are capped below 1000 per ruleset (Chrome hard limit); plain-literal regexes become urlFilters instead, which cost nothing against that budget.',
    '',
    'To rebuild: `npm install && npm run build:rules` (downloads into `.cache/`; add `--offline` to reuse it).',
  ];
  await writeFile(path.join(ROOT, 'rulesets', 'STATS.md'), notes.join('\n') + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
