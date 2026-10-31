// Element hiding (cosmetic filtering) on ordinary sites. Runs at
// document_start in every frame. Loads the per-list cosmetic data built into
// the extension, picks generic selectors plus the ones written for this host
// (including parent domains), subtracts exceptions, and injects them as CSS.
//
// YouTube is skipped on purpose: yt-content.js owns YouTube cosmetic hiding,
// and piling EasyList selectors on the player is how playback breaks.
//
// Lists and defaults must match manifest.json / background.js.

const LISTS = [
  // cos: whether the list ships a cosmetic/<id>.json (build-time flag)
  { id: 'easylist', on: true, cos: true },
  { id: 'easyprivacy', on: true, cos: true },
  { id: 'malware', on: true, cos: false }, // network-only list
  { id: 'cookies', on: false, cos: true },
  { id: 'annoyances', on: false, cos: true },
];

// Second-level labels that mean a public suffix pair ("co.uk"), so we never
// treat one as a site's own domain.
const PUBLIC_SECOND = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'mil', 'or', 'ne']);

function hostChain(host) {
  const labels = host.split('.');
  const chain = [host];
  for (let i = 1; labels.length - i >= 3; i++) chain.push(labels.slice(i).join('.'));
  if (labels.length >= 3) {
    const two = labels.slice(-2).join('.');
    if (!PUBLIC_SECOND.has(two.split('.')[0])) chain.push(two);
  }
  return chain;
}

(async () => {
  try {
    const host = location.hostname;
    if (!host) return;
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) return;

    const { enabled = true, lists = {}, paused = [] } = await chrome.storage.local.get({
      enabled: true, lists: {}, paused: [],
    });
    if (!enabled) return;
    if (paused.some((p) => host === p || host.endsWith('.' + p))) return;

    // Wake the service worker (once per page, top frame only). If it was not
    // running at browser start it may have missed onStartup; the ping lets it
    // self-heal and re-register scripts/rulesets.
    if (window === window.top) { try { chrome.runtime.sendMessage({ type: 'alive' }); } catch {} }

    const active = LISTS.filter((l) => l.cos && (lists[l.id] ?? l.on));
    const datas = await Promise.all(
      active.map((l) =>
        fetch(chrome.runtime.getURL(`cosmetic/${l.id}.json`))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    );

    const chain = hostChain(host);
    const generic = new Set();
    const genericExceptions = new Set();
    const specific = new Set();
    const exceptions = new Set();
    let elemhide = false;
    let generichide = false;

    for (const data of datas) {
      if (!data) continue;
      for (const d of data.elemhide || []) if (chain.includes(d)) elemhide = true;
      for (const d of data.generichide || []) if (chain.includes(d)) generichide = true;
      for (const sel of data.generic || []) generic.add(sel);
      for (const sel of data.genericExceptions || []) genericExceptions.add(sel);
      for (const d of chain) {
        for (const sel of data.domains?.[d] || []) specific.add(sel);
        for (const sel of data.exceptions?.[d] || []) exceptions.add(sel);
      }
    }
    if (elemhide) return; // the site asked for no element hiding at all
    if (generichide) generic.clear(); // ...or none of the generic ones

    const selectors = [...new Set([...generic].filter((s) => !genericExceptions.has(s)).concat([...specific]))]
      .filter((s) => !exceptions.has(s));
    if (!selectors.length) return;

    inject(selectors);
  } catch {
    /* cosmetic failure must never take a page down */
  }
})();

// Injects in chunks: one bad selector would kill a whole <style> rule, so we
// add chunk by chunk and, when a chunk is rejected, fall back to testing each
// selector individually (querySelector throws on invalid selectors).
const CHUNK = 500;

function inject(selectors) {
  const style = document.createElement('style');
  style.setAttribute('data-philterads', 'cosmetic');
  (document.head || document.documentElement).appendChild(style);
  const sheet = style.sheet;
  const add = (ruleText) => {
    try {
      sheet.insertRule(ruleText, sheet.cssRules.length);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < selectors.length; i += CHUNK) {
    const part = selectors.slice(i, i + CHUNK);
    if (add(`${part.join(',')}{display:none!important}`)) continue;
    for (const sel of part) {
      try {
        document.querySelector(sel); // throws on invalid selectors
      } catch {
        continue;
      }
      add(`${sel}{display:none!important}`);
    }
  }
}
