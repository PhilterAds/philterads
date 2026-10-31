// Pop-up ad-tab blocking: the $popup host extraction (build side), the
// close decision (runtime side, /popups.js) and the shipped data file.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePopupFilter, collectPopupHosts } from '../tools/lib/popups.js';
import { LISTS, SAFETY_DOMAINS } from '../tools/lib/lists.js';
import '../popups.js';

const { shouldClosePopup } = globalThis.PopupGuard;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---- build side: $popup extraction ----

test('parsePopupFilter keeps only plain host anchors', () => {
  assert.deepStrictEqual(parsePopupFilter('||ads.example.com^$popup'), { add: 'ads.example.com' });
  assert.deepStrictEqual(parsePopupFilter('||ADS.Example.COM^$popup'), { add: 'ads.example.com' });
  assert.deepStrictEqual(parsePopupFilter('||ads.example.com^$popup,third-party'), { add: 'ads.example.com' });
  assert.deepStrictEqual(parsePopupFilter('||ads.example.com^$popup,domain=site.com'), { add: 'ads.example.com', domains: ['site.com'] });
  assert.deepStrictEqual(parsePopupFilter('||ads.example.com^$popup,domain=A.com|b.com'), { add: 'ads.example.com', domains: ['a.com', 'b.com'] });
  assert.deepStrictEqual(parsePopupFilter('@@||ads.example.com^$popup'), { remove: 'ads.example.com' });
  assert.deepStrictEqual(parsePopupFilter('@@||ads.example.com^$popup,domain=site.com'), { remove: 'ads.example.com', domains: ['site.com'] });
  assert.deepStrictEqual(parsePopupFilter('||ads.example.com^$popup,domain=~site.com'), { skip: true }); // negated scope
  // everything else carries matching semantics a host list cannot honour
  assert.strictEqual(parsePopupFilter('/popunder/$popup'), null); // pattern, not a host
  assert.strictEqual(parsePopupFilter('||ads.example.com/pop^$popup'), null); // path
  assert.strictEqual(parsePopupFilter('||ad*.example.com^$popup'), null); // wildcard
  assert.strictEqual(parsePopupFilter('||ads.example.com$popup'), null); // missing separator anchor
  assert.strictEqual(parsePopupFilter('||example^$popup'), null); // single label
  assert.strictEqual(parsePopupFilter('||ads.example.com^'), null); // not a popup filter at all
  assert.strictEqual(parsePopupFilter('||ads.example.com^$popup,subdocument'), null);
  assert.strictEqual(parsePopupFilter('||ads.example.com^$popup,important'), null);
  assert.strictEqual(parsePopupFilter('||ads.example.com^$popup,document'), null);
  assert.strictEqual(parsePopupFilter('||ads.example.com^$popup,~third-party'), null);
});

test('collectPopupHosts: global hosts, scoped domains, sorted and unique', () => {
  const text = [
    '! comment',
    '[Adblock Plus 2.0]',
    '||ads.example.com^$popup',
    '||ads.example.com^$popup,third-party', // duplicate
    '||zzz.example.net^$popup',
    '||pop.example.org^$popup,domain=a.com|b.com',
    '||pop.example.org^$popup,domain=b.com|c.com', // domains merge across filters
    '/popunder/$popup', // ignored shape
  ].join('\n');
  assert.deepStrictEqual(collectPopupHosts(text), {
    hosts: ['ads.example.com', 'zzz.example.net'],
    scoped: { 'pop.example.org': ['a.com', 'b.com', 'c.com'] },
    filters: 5,
    negated: 0,
    safety: 0,
  });
});

test('collectPopupHosts: a host blocked globally ignores its scoped copies', () => {
  const { hosts, scoped } = collectPopupHosts([
    '||both.example.com^$popup',
    '||both.example.com^$popup,domain=x.com',
  ].join('\n'));
  assert.deepStrictEqual(hosts, ['both.example.com']);
  assert.deepStrictEqual(scoped, {});
});

test('collectPopupHosts: exceptions win wherever they sit', () => {
  // a global @@ removes the host from everywhere; a scoped @@ removes only
  // its opener domains from the scoped entry
  const r1 = collectPopupHosts([
    '||ads.example.com^$popup',
    '||pop.example.net^$popup,domain=a.com|b.com',
    '@@||ads.example.com^$popup',
    '@@||pop.example.net^$popup,domain=a.com',
  ].join('\n'));
  assert.deepStrictEqual(r1.hosts, []);
  assert.deepStrictEqual(r1.scoped, { 'pop.example.net': ['b.com'] });

  const r2 = collectPopupHosts([
    '||pop.example.net^$popup,domain=a.com',
    '@@||pop.example.net^$popup', // no domain=: kills the scoped entry too
  ].join('\n'));
  assert.deepStrictEqual(r2.scoped, {});
});

test('collectPopupHosts skips negated-domain scopes and counts them', () => {
  const r = collectPopupHosts([
    '||ads.example.com^$popup,domain=~x.com',
    '@@||other.example.com^$popup,domain=~y.com',
    '||kept.example.com^$popup',
  ].join('\n'));
  assert.deepStrictEqual(r.hosts, ['kept.example.com']);
  assert.deepStrictEqual(r.scoped, {});
  assert.strictEqual(r.negated, 2);
  assert.strictEqual(r.filters, 1);
});

test('collectPopupHosts drops safety hosts and their parents, global and scoped', () => {
  const { hosts, scoped, safety } = collectPopupHosts([
    '||accounts.google.com^$popup', // safety host itself
    '||gstatic.com^$popup', // parent of www.gstatic.com
    '||recaptcha.net^$popup', // parent of www.recaptcha.net
    '||js.stripe.com^$popup',
    '||ads.example.com^$popup',
    '||pop.example.org^$popup,domain=a.com',
    '||stripe.com^$popup,domain=b.com', // scoped parent of checkout.stripe.com
  ].join('\n'));
  assert.deepStrictEqual(hosts, ['ads.example.com']);
  assert.deepStrictEqual(scoped, { 'pop.example.org': ['a.com'] });
  assert.strictEqual(safety, 5);
});

// ---- runtime side: the close decision ----

const base = {
  targetUrl: 'https://pop.adshost.example/land?offer=1',
  openerUrl: 'https://www.example.org/read',
  enabled: true,
  lists: { easylist: true },
  paused: [],
  popupHosts: { easylist: { hosts: new Set(['adshost.example']), scoped: { 't.co': ['hltv.org'] } } },
};

test('shouldClosePopup closes an ad host opened from another site', () => {
  assert.strictEqual(shouldClosePopup(base), true);
});

test('subdomains of a listed host are closed too', () => {
  assert.strictEqual(shouldClosePopup({ ...base, targetUrl: 'https://x.pop.adshost.example/' }), true);
});

test('domain-scoped hosts close only from their listed opener sites', () => {
  const t = (over) => shouldClosePopup({ ...base, targetUrl: 'https://t.co/x', ...over });
  assert.strictEqual(t({ openerUrl: 'https://x.com/someone/status' }), false); // outside the scope: keep
  assert.strictEqual(t({ openerUrl: 'https://hltv.org/forums' }), true); // scoped opener site
  assert.strictEqual(t({ openerUrl: 'https://www.hltv.org/forums' }), true); // subdomain of a scoped opener
  assert.strictEqual(t({ targetUrl: 'https://link.t.co/x', openerUrl: 'https://hltv.org/' }), true); // subdomain target
  assert.strictEqual(t({ targetUrl: 'https://link.t.co/x', openerUrl: 'https://x.com/' }), false);
});

test('unlisted targets, missing opener and non-http targets are kept', () => {
  assert.strictEqual(shouldClosePopup({ ...base, targetUrl: 'https://clean.example.net/' }), false);
  assert.strictEqual(shouldClosePopup({ ...base, openerUrl: '' }), false); // no opener to hold responsible
  assert.strictEqual(shouldClosePopup({ ...base, targetUrl: 'chrome://extensions/' }), false);
  assert.strictEqual(shouldClosePopup({ ...base, targetUrl: 'about:blank' }), false);
});

test('same-site tabs are never closed', () => {
  const popupHosts = { easylist: { hosts: new Set(['ads.example.org']), scoped: {} } };
  assert.strictEqual(shouldClosePopup({ ...base, openerUrl: 'https://forums.example.org/', targetUrl: 'https://ads.example.org/x', popupHosts }), false);
  assert.strictEqual(shouldClosePopup({ ...base, openerUrl: 'https://example.org/', targetUrl: 'https://ads.example.org/x', popupHosts }), false);
});

test('paused opener sites are kept (same matching as the pause toggle)', () => {
  assert.strictEqual(shouldClosePopup({ ...base, paused: ['example.org'] }), false); // parent host
  assert.strictEqual(shouldClosePopup({ ...base, paused: ['www.example.org'] }), false); // exact host
  assert.strictEqual(shouldClosePopup({ ...base, paused: ['other.net'] }), true); // unrelated pause
});

test('master switch and per-list toggles are honoured', () => {
  assert.strictEqual(shouldClosePopup({ ...base, enabled: false }), false);
  assert.strictEqual(shouldClosePopup({ ...base, lists: { easylist: false } }), false);
  // host riding a list that is not enabled: kept
  const popupHosts = { malware: { hosts: new Set(['adshost.example']), scoped: {} } };
  assert.strictEqual(shouldClosePopup({ ...base, lists: { easylist: true, malware: false }, popupHosts }), false);
  assert.strictEqual(shouldClosePopup({ ...base, lists: { easylist: true, malware: true }, popupHosts }), true);
});

test('safety hosts stay open end to end (extraction keeps them out of the set)', () => {
  const { hosts, scoped } = collectPopupHosts(['||accounts.google.com^$popup', '||ads.example.com^$popup'].join('\n'));
  const popupHosts = { easylist: { hosts: new Set(hosts), scoped } };
  assert.strictEqual(
    shouldClosePopup({ ...base, targetUrl: 'https://accounts.google.com/ServiceLogin', popupHosts }),
    false,
  );
});

// ---- shipped data ----

test('rulesets/popups.json is well-formed and safety-clean', () => {
  const file = path.join(ROOT, 'rulesets', 'popups.json');
  assert.ok(existsSync(file), 'rulesets/popups.json missing (run npm run build:rules)');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const known = new Set(LISTS.map((l) => l.id));
  const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
  let total = 0;
  for (const [id, entry] of Object.entries(data)) {
    assert.ok(known.has(id), `unknown list id ${id}`);
    assert.ok(Array.isArray(entry.hosts), `${id}: missing hosts array`);
    assert.ok(typeof entry.scoped === 'object' && entry.scoped !== null, `${id}: missing scoped map`);
    assert.deepStrictEqual(entry.hosts, [...new Set(entry.hosts)].sort(), `${id}: hosts not sorted+unique`);
    for (const h of entry.hosts) {
      assert.ok(HOST.test(h), `${id}: bad host "${h}"`);
      assert.ok(!SAFETY_DOMAINS.some((s) => s === h || s.endsWith('.' + h)), `${id}: "${h}" endangers safety host`);
    }
    for (const [h, openers] of Object.entries(entry.scoped)) {
      assert.ok(HOST.test(h), `${id}: bad scoped host "${h}"`);
      assert.ok(!SAFETY_DOMAINS.some((s) => s === h || s.endsWith('.' + h)), `${id}: scoped "${h}" endangers safety host`);
      assert.ok(openers.length > 0, `${id}: scoped "${h}" has no opener domains`);
      assert.deepStrictEqual(openers, [...new Set(openers)].sort(), `${id}: scoped "${h}" openers not sorted+unique`);
      for (const d of openers) assert.ok(HOST.test(d), `${id}: bad opener domain "${d}"`);
    }
    total += entry.hosts.length + Object.keys(entry.scoped).length;
  }
  assert.ok(total > 0, 'popups.json carries no hosts at all');
  assert.ok((data.easylist?.hosts ?? []).length > 0, 'easylist popup hosts missing');
});
