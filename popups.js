// Pop-up / pop-under ad-tab decision, shared by background.js (which loads
// this via importScripts — the service worker is a classic script) and by
// tests/popups.test.js (which imports it as an ES module, hence the
// globalThis export below). The host data comes from rulesets/popups.json
// (built by tools/lib/popups.js); nothing here touches Chrome, so the
// decision stays testable in plain node.

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

// Registrable-domain stand-in without shipping a public-suffix list: the
// last two labels. Multi-part TLDs (co.uk, com.au) collapse into one
// "site", which can only ever keep a tab we might have closed — the safe
// direction for a "never close the user's own tabs" rule.
function registrableOf(host) {
  return host.split('.').slice(-2).join('.');
}

// A listed host matches itself and its subdomains, exactly like ||host^:
// walk the target's labels upward, looking each one up. Global hosts match
// any opener; scoped hosts (from domain= filters) only when the opener site
// equals or sits under one of their listed opener domains.
function listedOn(data, host, opener) {
  for (let h = host; ; h = h.slice(h.indexOf('.') + 1)) {
    if (data.hosts?.has(h)) return true;
    const openers = data.scoped?.[h];
    if (openers && openers.some((d) => opener === d || opener.endsWith('.' + d))) return true;
    if (!h.includes('.')) return false;
  }
}

// Close decision for one tab event. `lists` is the resolved on/off map
// (background.js resolves the list defaults exactly like apply() does),
// `popupHosts` maps list id -> { hosts: Set, scoped: { host: [domains] } }
// from rulesets/popups.json, `paused` is the paused-hosts array from
// storage. Keeps everything the guard must never touch: non-http(s)
// targets (chrome://, about:, extension pages), tabs without a verifiable
// opener, same-site tabs, tabs whose opener site is paused, and hosts
// riding a disabled list.
function shouldClosePopup({ targetUrl, openerUrl, enabled, lists = {}, paused = [], popupHosts = {} }) {
  if (!enabled) return false;
  let target;
  try { target = new URL(targetUrl); } catch { return false; }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  const opener = hostOf(openerUrl);
  if (!opener) return false; // no opener URL to hold responsible: keep
  const host = target.hostname.toLowerCase();
  if (registrableOf(host) === registrableOf(opener)) return false; // same site as its opener
  if (paused.some((p) => opener === p || opener.endsWith('.' + p))) return false; // opener site paused
  for (const [id, data] of Object.entries(popupHosts)) {
    if (lists[id] && listedOn(data, host, opener)) return true;
  }
  return false;
}

// Classic-script (importScripts) and ESM (tests) consumers both read this.
globalThis.PopupGuard = { shouldClosePopup };
