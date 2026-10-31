// $popup filter extraction for rulesets/popups.json (the runtime half lives
// in /popups.js + background.js). EasyList-style $popup filters name the
// pages ads open in new tabs (pop-unders, "click anywhere" scam tabs);
// declarativeNetRequest cannot express $popup, so the plain `||host^` ones
// become a host list the background matches against freshly opened tabs.
// domain= -scoped filters keep their scope: their host only closes popups
// whose OPENER site is on the filter's domain list — flattening them would
// close e.g. every t.co link from any site that opens one. The safety
// guarantee applies here too: no host that is (or is a parent of) a
// SAFETY_DOMAINS entry may enter the list, global or scoped.

import { SAFETY_DOMAINS } from './lists.js';

// Exactly `||host^`, with only third-party / domain= beside $popup: the one
// shape a popup host list can honour. Paths, wildcards, regex and bare host
// prefixes carry matching semantics of their own, so they are ignored.
const HOST_ANCHOR_RE = /^\|\|([a-z0-9-]+(?:\.[a-z0-9-]+)+)\^$/i;
const ALLOWED_OPTIONS = new Set(['popup', 'third-party']);

const endangersSafety = (h) => SAFETY_DOMAINS.some((s) => s === h || s.endsWith('.' + h));

// One filter line -> { add|remove: host, domains?: [...] } for filters we
// can honour, { skip: true } for negated-domain scopes, null for the rest.
export function parsePopupFilter(line) {
  const except = line.startsWith('@@');
  const body = except ? line.slice(2) : line;
  const dollar = body.lastIndexOf('$');
  if (dollar === -1) return null;
  const options = body.slice(dollar + 1).toLowerCase().split(',');
  if (!options.includes('popup') || options.includes('~popup') || options.includes('document')) return null;
  const domain = options.find((o) => o.startsWith('domain='));
  if (!options.every((o) => ALLOWED_OPTIONS.has(o) || o === domain)) return null;
  const m = HOST_ANCHOR_RE.exec(body.slice(0, dollar));
  if (!m) return null;
  const out = { [except ? 'remove' : 'add']: m[1].toLowerCase() };
  if (domain) {
    const domains = domain.slice(7).split('|');
    if (domains.some((d) => d.startsWith('~'))) return { skip: true }; // mixed scope: not honourable
    out.domains = domains;
  }
  return out;
}

// Whole-list scan. Global blocks land in `hosts`, domain= -scoped blocks in
// `scoped` (host -> opener domains it applies FROM). Exceptions win wherever
// they appear, like ABP: one without domain= removes the host entirely, one
// with domain= removes only those opener domains from the scoped entry (it
// never lifts a global block — conservative, matching uBlock's reading).
// A host that is blocked globally ignores its scoped copies. Hosts and
// domains come out sorted, de-duplicated, lowercase.
export function collectPopupHosts(text) {
  const blocks = new Set();
  const scoped = new Map(); // host -> Set(opener domains)
  const exceptions = new Set(); // @@ without domain=: remove everywhere
  const scopedExceptions = new Map(); // host -> Set(opener domains to remove)
  let filters = 0;
  let negated = 0;
  for (let raw of text.split('\n')) {
    raw = raw.trim();
    if (!raw || raw.startsWith('!') || raw.startsWith('[')) continue;
    const p = parsePopupFilter(raw);
    if (!p) continue;
    if (p.skip) { negated++; continue; }
    filters++;
    const into = (map, host, domains) => {
      const set = map.get(host) ?? new Set();
      for (const d of domains) set.add(d);
      map.set(host, set);
    };
    if (p.add) {
      if (p.domains) into(scoped, p.add, p.domains);
      else blocks.add(p.add);
    } else if (p.domains) into(scopedExceptions, p.remove, p.domains);
    else exceptions.add(p.remove);
  }
  for (const h of exceptions) { blocks.delete(h); scoped.delete(h); }
  for (const [h, doms] of scopedExceptions) {
    const set = scoped.get(h);
    if (!set) continue;
    for (const d of doms) set.delete(d);
    if (!set.size) scoped.delete(h);
  }
  for (const h of scoped.keys()) if (blocks.has(h)) scoped.delete(h); // global wins
  let safety = 0;
  for (const h of blocks) if (endangersSafety(h)) { blocks.delete(h); safety++; }
  for (const h of scoped.keys()) if (endangersSafety(h)) { scoped.delete(h); safety++; }
  const out = { hosts: [...blocks].sort(), scoped: {} };
  for (const h of [...scoped.keys()].sort()) out.scoped[h] = [...scoped.get(h)].sort();
  return { ...out, filters, negated, safety };
}
