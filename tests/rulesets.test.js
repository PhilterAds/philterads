// Validates every generated + hand-maintained ruleset: schema shape, unique
// ids, Chrome limits, the main_frame policy, and the safety-domain guarantee
// (no rule may effectively block Google sign-in / Docs / banks / captchas).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTS, HAND_RULESETS, SAFETY_DOMAINS, LIMITS } from '../tools/lib/lists.js';
import { validateRuleset, ruleMatchesUrl, blockableDomains } from '../tools/lib/dnr.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rulesetDir = path.join(ROOT, 'rulesets');

function loadRuleset(id) {
  return JSON.parse(readFileSync(path.join(rulesetDir, `${id}.json`), 'utf8'));
}

const allRules = [];
for (const rs of readdirSync(rulesetDir)) {
  // popups.json is host data for the background's pop-up tab guard, not a ruleset
  if (!rs.endsWith('.json') || rs === 'blocks.json' || rs === 'popups.json') continue;
  allRules.push({ id: rs.replace('.json', ''), rules: loadRuleset(rs.replace('.json', '')) });
}

test('every ruleset passes schema validation with unique ids and sane limits', () => {
  for (const { id, rules } of allRules) {
    const { errors, regexCount } = validateRuleset(id, rules);
    assert.deepStrictEqual(errors, [], `${id}: ${errors.join('; ')}`);
    assert.ok(regexCount <= LIMITS.regexPerRuleset, `${id}: too many regex rules`);
    const ids = rules.map((r) => r.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${id}: duplicate ids`);
    assert.ok(rules.length > 0, `${id}: empty ruleset`);
  }
});

test('block ids are contiguous at the start of each ruleset (blocks.json contract)', () => {
  for (const { id, rules } of allRules) {
    const isBlock = (r) => r.action.type === 'block' || r.action.type === 'redirect';
    const firstAllow = rules.findIndex((r) => !isBlock(r));
    const blocksEnd = firstAllow === -1 ? rules.length : firstAllow;
    // blocks must be exactly rules[0..blocksEnd)
    for (let i = 0; i < rules.length; i++) {
      if (i < blocksEnd) assert.ok(isBlock(rules[i]), `${id}: block id ordering broken at ${i}`);
      else assert.ok(!isBlock(rules[i]), `${id}: non-block before blocks at ${i}`);
    }
  }
});

test('blocks.json matches the actual rulesets', () => {
  const index = JSON.parse(readFileSync(path.join(rulesetDir, 'blocks.json'), 'utf8'));
  for (const { id, rules } of allRules) {
    assert.ok(index[id], `blocks.json missing ${id}`);
    const expected = rules.filter((r) => r.action.type === 'block' || r.action.type === 'redirect').map((r) => r.id);
    const actual = index[id].ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
    assert.deepStrictEqual(actual.sort((x, y) => x - y), expected.sort((x, y) => x - y), `blocks.json ranges wrong for ${id}`);
    assert.strictEqual(index[id].total, rules.length, `blocks.json total wrong for ${id}`);
  }
});

test('outside the malware list no block rule can match main_frame', () => {
  for (const { id, rules } of allRules) {
    if (id === 'malware' || id === 'safety' || id === 'core') continue; // core is hand-vetted; safety has no blocks
    for (const r of rules) {
      if (r.action.type !== 'block') continue;
      const c = r.condition;
      if (Array.isArray(c.resourceTypes)) {
        assert.ok(!c.resourceTypes.includes('main_frame'), `${id} id ${r.id}: blocks main_frame via resourceTypes`);
      } else {
        assert.ok((c.excludedResourceTypes || []).includes('main_frame'), `${id} id ${r.id}: misses main_frame exclusion`);
      }
    }
  }
});

test('enabled-by-default rule total stays within the static-rule budget', () => {
  let total = 0;
  for (const { id, rules } of allRules) {
    const list = LISTS.find((l) => l.id === id);
    if (list?.defaultOn || HAND_RULESETS.some((h) => h.id === id)) total += rules.length;
  }
  assert.ok(total <= LIMITS.enabledStaticTotal, `enabled static rules ${total} > ${LIMITS.enabledStaticTotal}`);
  assert.ok(total <= 30000, `enabled static rules ${total} exceed Chrome's 30k per-extension guarantee`);
});

// ---- safety-domain guarantee ----

const safety = loadRuleset('safety');
function safetyAllowBeats(url, blockPriority, resourceType) {
  return safety.some(
    (r) => (r.action.type === 'allow' || r.action.type === 'allowAllRequests') &&
      r.priority > blockPriority &&
      ruleMatchesUrl({ ...r, condition: { ...r.condition } }, url, resourceType),
  );
}

// canary URLs per (rule, safety domain): bare page plus paths derived from
// the rule's own pattern, so generic pattern rules get a fighting chance to
// match before we assert they lose to the safety allows.
function canaryUrls(rule, domain) {
  const urls = [`https://${domain}/`, `https://${domain}/x.js`, `https://${domain}/p?z=1`];
  const c = rule.condition;
  if (c.urlFilter && !c.urlFilter.startsWith('||')) {
    const p = c.urlFilter.replace(/^\|+/, '').replace(/\|+$/, '').replace(/\*/g, 'x').replace(/\^/g, '/');
    urls.push(`https://${domain}/q${p.startsWith('&') || p.startsWith('?') ? `?w=${p}` : p}`);
  } else if (c.urlFilter && c.urlFilter.startsWith('||')) {
    const rest = c.urlFilter.slice(2).replace(/\*/g, 'x');
    const hostPart = rest.split(/[\^/]/)[0];
    if (hostPart && !hostPart.includes('.')) return urls; // not host-scoped after wildcard cleanup
  }
  if (c.regexFilter) {
    const lit = c.regexFilter.match(/[A-Za-z0-9%._/-]{4,}/g) || [];
    for (const l of lit.slice(0, 3)) urls.push(`https://${domain}/${l}`);
  }
  return urls;
}

test('no rule effectively blocks a safety domain (sign-in, docs, banks, captchas)', () => {
  const offenders = [];
  for (const { id, rules } of allRules) {
    for (const r of rules) {
      if (r.action.type !== 'block' && r.action.type !== 'redirect') continue;
      const domains = blockableDomains(r);
      for (const s of SAFETY_DOMAINS) {
        // skip rules that cannot reach this host at all
        if (domains && ![...domains].some((d) => s === d || s.endsWith('.' + d))) continue;
        for (const url of canaryUrls(r, s)) {
          if (!ruleMatchesUrl(r, url)) continue;
          if (!safetyAllowBeats(url, r.priority)) offenders.push(`${id} id ${r.id} would block ${url} (${JSON.stringify(r.condition).slice(0, 120)})`);
        }
      }
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.slice(0, 5).join('\n'));
});

test('www.google.com/recaptcha is covered by an explicit allow', () => {
  const url = 'https://www.google.com/recaptcha/api.js';
  assert.ok(safety.some((r) => ruleMatchesUrl(r, url) && r.priority >= 4), 'recaptcha allow rule missing');
});

test('the gpt.js stub redirect and the ad_status.js allow survived in core', () => {
  const core = loadRuleset('core');
  assert.ok(core.some((r) => r.action.type === 'redirect' && r.action.redirect?.extensionPath === '/stubs/gpt.js'), 'gpt.js redirect missing');
  assert.ok(core.some((r) => r.action.type === 'allow' && /ad_status\.js/.test(r.condition.urlFilter)), 'ad_status.js allow missing');
  assert.ok(core.some((r) => r.action.type === 'block' && r.condition.urlFilter === '||doubleclick.net^'), 'doubleclick block missing');
});
