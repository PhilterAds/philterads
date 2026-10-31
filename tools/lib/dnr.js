// DNR rule post-processing shared by the build and the tests:
// safety filtering, domain collapsing/merging, priorities, validation and a
// small offline matcher used to prove no rule blocks the safety domains.

import { SAFETY_DOMAINS, LIMITS } from './lists.js';

const VALID_ACTIONS = new Set(['block', 'allow', 'redirect', 'upgradeScheme', 'modifyHeaders', 'allowAllRequests']);
const VALID_RESOURCE_TYPES = new Set([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping',
  'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other',
]);
const VALID_CONDITION_KEYS = new Set([
  'urlFilter', 'regexFilter', 'isUrlFilterCaseSensitive', 'initiatorDomains', 'excludedInitiatorDomains',
  'requestDomains', 'excludedRequestDomains', 'resourceTypes', 'excludedResourceTypes', 'domainType',
  'tabIds', 'excludedTabIds', 'responseHeaders', 'excludedResponseHeaders', 'domains', 'excludedDomains',
  'regexSubstitution',
]);

const HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

// Literal domains a rule could block requests TO (undefined = can't tell,
// e.g. a generic pattern rule).
export function blockableDomains(rule) {
  const c = rule.condition || {};
  const out = new Set();
  if (Array.isArray(c.requestDomains)) for (const d of c.requestDomains) out.add(d);
  if (c.urlFilter) {
    const m = /^\|\|([a-z0-9.-]+(?:[a-z0-9*.-]*))/.exec(c.urlFilter);
    if (m) {
      const token = m[1].split(/[\^/?*]/)[0];
      if (token.includes('.') && HOST_RE.test(token)) out.add(token);
      else return undefined; // wildcard-ish domain part: too fuzzy
    }
  }
  if (out.size === 0 && (c.urlFilter || c.regexFilter)) return undefined; // generic pattern
  return out;
}

// Keep only rules that can never block a safety domain. Generic pattern rules
// are checked for literal safety-domain substrings; anything still ambiguous
// for a specific host is dropped (the safety.json allow rules are the runtime
// backstop either way).
export function safetyFilter(rules, dropCounter) {
  return rules.filter((r) => {
    if (r.action.type !== 'block') return true;
    const c = r.condition || {};
    const pattern = String(c.urlFilter || c.regexFilter || '');
    if (pattern && SAFETY_DOMAINS.some((s) => pattern.toLowerCase().includes(s))) {
      dropCounter('safety-domain'); return false;
    }
    // wildcarded host parts ("||ads*.gstatic.com^"): check each literal chunk
    if (c.urlFilter?.startsWith('||')) {
      const hostPart = c.urlFilter.slice(2).split(/[\^/?]/)[0];
      if (hostPart.includes('*')) {
        for (let chunk of hostPart.split('*')) {
          chunk = chunk.replace(/^\.+|\.+$/g, '');
          if (chunk.includes('.') && SAFETY_DOMAINS.some((s) => s === chunk || s.endsWith('.' + chunk))) {
            dropCounter('safety-domain'); return false;
          }
        }
      }
    }
    const domains = blockableDomains(r);
    if (domains === undefined) return true; // generic: substring check above is all we can do statically
    for (const d of domains) {
      if (SAFETY_DOMAINS.some((s) => s === d || s.endsWith('.' + d))) { dropCounter('safety-domain'); return false; }
    }
    return true;
  });
}

// `||domain^` (exact domain block) can become a requestDomains entry instead.
export function domainify(rule) {
  const c = rule.condition;
  if (!c || !c.urlFilter || c.requestDomains) return null;
  const m = /^\|\|([a-z0-9-]+(?:\.[a-z0-9-]+)+)\^$/.exec(c.urlFilter);
  if (!m) return null;
  const labels = m[1].split('.');
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return null; // not a plausible registrable domain
  return m[1];
}

function stableShape(rule) {
  // Everything that defines the rule's matching shape except the blocked
  // domain itself, the id and the priority (both ours to assign).
  const c = rule.condition;
  const shape = {
    action: rule.action,
    condition: { ...c },
  };
  delete shape.condition.urlFilter;
  delete shape.condition.requestDomains;
  return JSON.stringify(shape);
}

// Collapse same-shape rules into fewer rules with requestDomains arrays
// (Chrome matches subdomains of every entry, exactly like ||domain^).
export function mergeRules(rules) {
  const buckets = new Map(); // shapeKey -> {template, domains:Set}
  const passthrough = [];
  for (const r of rules) {
    const domain = domainify(r);
    if (!domain) { passthrough.push(r); continue; }
    const key = stableShape(r);
    if (!buckets.has(key)) {
      const template = { ...r, condition: { ...r.condition } };
      delete template.condition.urlFilter; // the domain moves into requestDomains
      delete template.condition.requestDomains;
      buckets.set(key, { template, domains: new Set() });
    }
    buckets.get(key).domains.add(domain);
  }
  const merged = [];
  for (const { template, domains } of buckets.values()) {
    if (domains.size === 1) {
      const [d] = domains;
      passthrough.push({ ...template, condition: { ...template.condition, urlFilter: `||${d}^` } });
      continue;
    }
    const list = [...domains].sort();
    for (let i = 0; i < list.length; i += LIMITS.domainsPerRule) {
      merged.push({ ...template, condition: { ...template.condition, requestDomains: list.slice(i, i + LIMITS.domainsPerRule) } });
    }
  }
  return [...passthrough, ...merged];
}

// Priority scheme: any allow beats any redirect beats any block. Rules with
// the same action never conflict with each other, so one tier per action is
// enough and avoids Chrome's unspecified same-priority tie-breaking.
export const PRIORITY = { block: 1, redirect: 2, allow: 3, allowAllRequests: 3 };

export function assignPriorities(rules) {
  for (const r of rules) r.priority = PRIORITY[r.action.type] ?? 1;
  return rules;
}

// Block ids first, then allow ids, so ids form contiguous ranges per action
// (rulesets/blocks.json relies on this for the popup's blocked counter).
export function assignIds(rules) {
  const blocks = rules.filter((r) => r.action.type === 'block' || r.action.type === 'redirect');
  const others = rules.filter((r) => r.action.type !== 'block' && r.action.type !== 'redirect');
  let id = 1;
  for (const r of blocks) r.id = id++;
  for (const r of others) r.id = id++;
  return rules;
}

// Build { <rulesetId>: { ranges: [[from, to], ...], total: N } } where ranges
// cover exactly the ids of block/redirect rules ("things that stop an ad").
export function blockRanges(rulesetId, rules) {
  const ids = rules.filter((r) => r.action.type === 'block' || r.action.type === 'redirect').map((r) => r.id).sort((a, b) => a - b);
  const ranges = [];
  for (const id of ids) {
    const last = ranges[ranges.length - 1];
    if (last && id === last[1] + 1) last[1] = id;
    else ranges.push([id, id]);
  }
  return { ranges, total: rules.length };
}

export function validateRuleset(rulesetId, rules) {
  const errors = [];
  const seen = new Set();
  let regexCount = 0;
  rules.forEach((r, i) => {
    const at = `${rulesetId}[${i}] (id ${r.id})`;
    if (!r || typeof r !== 'object') { errors.push(`${at}: not an object`); return; }
    if (!Number.isInteger(r.id) || r.id < 1) errors.push(`${at}: bad id`);
    if (seen.has(r.id)) errors.push(`${at}: duplicate id`);
    seen.add(r.id);
    if (!Number.isInteger(r.priority) || r.priority < 1) errors.push(`${at}: bad priority`);
    if (!r.action || !VALID_ACTIONS.has(r.action.type)) errors.push(`${at}: bad action ${r.action && r.action.type}`);
    const c = r.condition || {};
    for (const k of Object.keys(c)) if (!VALID_CONDITION_KEYS.has(k)) errors.push(`${at}: unknown condition key ${k}`);
    if (!c.urlFilter && !c.regexFilter && !c.requestDomains && !c.responseHeaders) {
      // also fine: rules restricted by initiatorDomains only are still valid
      if (!c.initiatorDomains) errors.push(`${at}: condition matches everything`);
    }
    if (c.urlFilter && c.regexFilter) errors.push(`${at}: both urlFilter and regexFilter`);
    if (c.urlFilter && Array.isArray(c.requestDomains)) errors.push(`${at}: urlFilter together with requestDomains (merge bug)`);
    if (typeof c.urlFilter === 'string' && c.urlFilter.length === 0) errors.push(`${at}: empty urlFilter`);
    if (c.domainType && !['firstParty', 'thirdParty'].includes(c.domainType)) errors.push(`${at}: bad domainType`);
    for (const key of ['resourceTypes', 'excludedResourceTypes']) {
      const arr = c[key];
      if (arr === undefined) continue;
      if (!Array.isArray(arr) || arr.length === 0) errors.push(`${at}: ${key} empty`);
      else for (const t of arr) if (!VALID_RESOURCE_TYPES.has(t)) errors.push(`${at}: bad ${key} entry ${t}`);
    }
    for (const key of ['initiatorDomains', 'excludedInitiatorDomains', 'requestDomains', 'excludedRequestDomains']) {
      const arr = c[key];
      if (arr === undefined) continue;
      if (!Array.isArray(arr) || arr.length === 0) { errors.push(`${at}: ${key} empty`); continue; }
      for (const d of arr) {
        if (typeof d !== 'string' || !HOST_RE.test(d)) errors.push(`${at}: bad domain "${d}" in ${key}`);
      }
    }
    if (r.action?.type === 'allowAllRequests') {
      const types = c.resourceTypes || [];
      if (!types.includes('main_frame')) errors.push(`${at}: allowAllRequests without main_frame`);
    }
    if (c.regexFilter) regexCount++;
  });
  if (regexCount > LIMITS.regexPerRuleset) errors.push(`${rulesetId}: ${regexCount} regex rules > ${LIMITS.regexPerRuleset}`);
  return { errors, regexCount };
}

// --- Offline DNR condition matcher (test-side proof for the safety domains) ---

function urlFilterToMatcher(urlFilter, caseSensitive) {
  // DNR urlFilter: '*' any run, '^' separator, '||' domain-start anchor,
  // '|' start/end anchors; everything else literal. Good enough for tests.
  let re = '';
  let i = 0;
  if (urlFilter.startsWith('||')) { re += '(?:[a-z][a-z0-9+.-]*:\\/\\/)?(?:[a-z0-9-]+\\.)*'; i = 2; }
  else if (urlFilter.startsWith('|')) { re += '^'; i = 1; }
  let body = urlFilter.slice(i);
  let endAnchored = false;
  if (body.endsWith('|')) { endAnchored = true; body = body.slice(0, -1); }
  body = body.replace(/[.+?${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\^/g, '(?:[^a-z0-9._%-]|$)');
  re = re + body + (endAnchored ? '$' : '');
  try { return new RegExp(re, caseSensitive ? '' : 'i'); } catch { return null; }
}

export function ruleMatchesUrl(rule, url, resourceType = 'script') {
  const c = rule.condition || {};
  if (c.resourceTypes && !c.resourceTypes.includes(resourceType)) return false;
  if (c.excludedResourceTypes?.includes(resourceType)) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (Array.isArray(c.requestDomains)) {
    const host = u.hostname;
    if (!c.requestDomains.some((d) => host === d || host.endsWith('.' + d))) return false;
  }
  if (Array.isArray(c.excludedRequestDomains)) {
    const host = u.hostname;
    if (c.excludedRequestDomains.some((d) => host === d || host.endsWith('.' + d))) return false;
  }
  if (c.urlFilter) {
    const re = urlFilterToMatcher(c.urlFilter, c.isUrlFilterCaseSensitive);
    if (!re || !re.test(url)) return false;
  }
  if (c.regexFilter) {
    try { if (!new RegExp(c.regexFilter, 'i').test(url)) return false; } catch { return false; }
  }
  return true;
}
