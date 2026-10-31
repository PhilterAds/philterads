// Stats core: pure logic shared by background.js (classic script via
// importScripts) and the tests (ES module import), exactly like popups.js.
// Nothing here touches Chrome, so bucketing / pruning / de-dup / the zapped
// selector store / update-reminder visibility stay testable in plain node.
// The background wires these helpers around chrome.alarms +
// declarativeNetRequest.getMatchedRules; the popup only reads what they wrote.

// rulesetId -> chip / stats-row category. easylist + core fold into "ads".
// safety and dynamic (pause) rules are
// absent on purpose: blocks.json's block/redirect id ranges filter them out
// before this map is even consulted, so allow rules never count.
const RULESET_CATEGORY = {
  easylist: 'ads',
  core: 'ads',
  easyprivacy: 'trackers',
  malware: 'malware',
  cookies: 'cookies',
  annoyances: 'annoyances',
};

const COUNT_KEYS = ['ads', 'trackers', 'malware', 'cookies', 'annoyances', 'popups', 'youtubeSkipped', 'zapped'];

// stats rows on the Stats tab (fixed order, exact labels)
const ROW_DEFS = [
  ['ads', 'Ads'],
  ['trackers', 'Trackers'],
  ['malware', 'Malware'],
  ['popups', 'Pop-ups closed'],
  ['youtubeSkipped', 'YouTube ads skipped'],
  ['zapped', 'Zapped by you'],
];

function emptyCounts() {
  return Object.fromEntries(COUNT_KEYS.map((k) => [k, 0]));
}

// Local calendar day of a timestamp: 'YYYY-MM-DD' (the user's "today").
function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Second-level labels that mean a public suffix pair ("co.uk"), so we never
// treat one as a site's own domain. Mirrors cosmetic.js's hostChain (content
// scripts cannot share this file's world); keep the two in sync.
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

// One getMatchedRules entry -> category, or null when it must not count
// (allow rules: outside every block/redirect range; unknown rulesetId covers
// dynamic pause rules, whose rulesetId is not one of ours).
function classifyMatch(info, blocks) {
  const entry = blocks?.[info.rule?.rulesetId];
  if (!entry) return null;
  const id = info.rule.ruleId;
  if (!entry.ranges.some(([a, b]) => id >= a && id <= b)) return null;
  return RULESET_CATEGORY[info.rule.rulesetId] ?? null;
}

// De-dup key across polls: the same network event seen twice (boundary of
// minTimeStamp, or a retried poll) collapses to one count.
function dedupeKey(info) {
  return `${info.timeStamp}|${info.rule.rulesetId}|${info.rule.ruleId}|${info.tabId}`;
}

// Fold one poll's matches into { dayKey -> counts } and { tabId -> counts }.
// tabId < 0 (not tied to a tab) counts toward the day only.
function bucketMatches(infos, blocks) {
  const days = {};
  const tabs = {};
  for (const info of infos) {
    const cat = classifyMatch(info, blocks);
    if (!cat) continue;
    const day = (days[dayKey(info.timeStamp)] ??= emptyCounts());
    day[cat] += 1;
    if (info.tabId >= 0) {
      const tab = (tabs[info.tabId] ??= emptyCounts());
      tab[cat] += 1;
    }
  }
  return { days, tabs };
}

// Day keys older than `keep` days (measured against todayKey) — the caller
// removes them so storage.local holds a bounded window.
function dayKeysToRemove(keys, todayKey, keep = 400) {
  const t = Date.parse(`${todayKey}T00:00:00`);
  return keys.filter((k) => {
    const d = Date.parse(`${k}T00:00:00`);
    return Number.isFinite(d) && (t - d) / 86_400_000 > keep;
  });
}

// Nobody's lifetime YouTube number may drop on update: the old `skipped`
// counter predates per-day collection, so the row shows whichever is larger.
function lifetimeYouTube(skipped, all) {
  return Math.max(skipped || 0, all?.youtubeSkipped || 0);
}

// ---- zapped-selector store: chrome.storage.local `zapped` = { host: [{sel, at}] }

function zappedAdd(store, host, sel, at) {
  const list = store[host] || [];
  if (list.some((z) => z.sel === sel)) return store; // dedupe by selector
  return { ...store, [host]: [...list, { sel, at }] };
}

function zappedRemove(store, host, sel) {
  const list = store[host];
  if (!list) return store;
  const next = list.filter((z) => z.sel !== sel);
  if (next.length === list.length) return store;
  const out = { ...store };
  if (next.length) out[host] = next;
  else delete out[host]; // empty hosts drop out so "N sites" stays honest
  return out;
}

function zappedRemoveHosts(store, hosts) {
  let out = store;
  let changed = false;
  for (const h of hosts) {
    if (out[h]) { out = zappedRemoveHost(out, h); changed = true; }
  }
  return changed ? out : store;
}

function zappedRemoveHost(store, host) {
  if (!store[host]) return store;
  const out = { ...store };
  delete out[host];
  return out;
}

function zappedCount(store, chain) {
  let n = 0;
  for (const h of chain) n += store[h]?.length || 0;
  return n;
}

function zappedTotal(store) {
  let total = 0;
  let hosts = 0;
  for (const list of Object.values(store)) {
    if (list.length) { total += list.length; hosts += 1; }
  }
  return { total, hosts };
}

// ---- update reminder (footer love-line replacement)

// Visible only when a check actually found commits waiting (a check that
// errored has no behind) and the user has not dismissed this exact remote.
function reminderVisible(update) {
  return !!(update && update.behind > 0 && update.remote && update.dismissed !== update.remote);
}

// Classic-script (importScripts) and ESM (tests) consumers both read this.
globalThis.PhilterStats = {
  RULESET_CATEGORY,
  COUNT_KEYS,
  ROW_DEFS,
  emptyCounts,
  dayKey,
  hostChain,
  classifyMatch,
  dedupeKey,
  bucketMatches,
  dayKeysToRemove,
  lifetimeYouTube,
  zappedAdd,
  zappedRemove,
  zappedRemoveHosts,
  zappedCount,
  zappedTotal,
  reminderVisible,
};
