// Applies settings to DNR rulesets, content scripts and the badge.
// Everything lives in chrome.storage.local: `enabled` (master switch),
// `lists` (per-list overrides), `paused` (hosts), `skipped` (YouTube counter),
// `popups` (pop-up ad tabs closed), `stats:YYYY-MM-DD` (per-day counters),
// `stats:all` (lifetime totals), `statsSince`, `zapped` (zap selectors).
// The popup only writes storage; the storage.onChanged listener re-applies.

importScripts('popups.js'); // pop-up ad-tab close decision, shared with the tests
importScripts('stats.js'); // stats/zapped pure logic, shared with the tests

const YT = ['*://*.youtube.com/*', '*://youtube.com/*'];
const SCRIPTS = [
  { id: 'yt-main', js: ['yt-main.js'], matches: YT, runAt: 'document_start', world: 'MAIN', allFrames: true },
  { id: 'yt-content', js: ['yt-content.js'], matches: YT, runAt: 'document_start', allFrames: false },
];

// Order and defaults must match manifest.json's rule_resources and cosmetic.js.
const LISTS = [
  { id: 'easylist', on: true },
  { id: 'easyprivacy', on: true },
  { id: 'malware', on: true },
  { id: 'cookies', on: false },
  { id: 'annoyances', on: false },
];

// "Pause on this site" = two dynamic rules per host: allowAllRequests for the
// host's frame tree, and a plain allow for requests to the host itself (covers
// address-bar navigation). Priority beats every static rule, safety included.
const PAUSE_PRIORITY = 10;
const PAUSE_ID_BASE = 1_000_000; // dynamic ids below this belong to nothing else

const settings = () =>
  chrome.storage.local.get({ enabled: true, lists: {}, paused: [], skipped: 0 });

let lastApply = 0; // last time apply() ran (throttles the 'alive' heartbeat)

function pauseRuleIds(host) {
  // stable per host: fnv1a hash, two consecutive ids
  let h = 0x811c9dc5;
  for (const c of host) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  const base = PAUSE_ID_BASE + (h % 500_000) * 2;
  return [base, base + 1];
}

async function applyPauseRules(paused) {
  const old = (await chrome.declarativeNetRequest.getDynamicRules())
    .map((r) => r.id)
    .filter((id) => id >= PAUSE_ID_BASE);
  const seen = new Set();
  const add = paused.flatMap((host) => {
    const [frameId, hostId] = pauseRuleIds(host);
    if (seen.has(frameId)) return []; // hash collision between hosts: first wins
    seen.add(frameId);
    return [
      {
        id: frameId, priority: PAUSE_PRIORITY, action: { type: 'allowAllRequests' },
        // matched against the frame's own URL, so it covers typed/bookmarked visits
        condition: { requestDomains: [host], resourceTypes: ['main_frame', 'sub_frame'] },
      },
      {
        id: hostId, priority: PAUSE_PRIORITY, action: { type: 'allow' },
        condition: { requestDomains: [host] },
      },
    ];
  });
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old,
    addRules: add,
  });
}

async function apply() {
  const { enabled, lists, paused } = await settings();

  // Rulesets: core + safety ride on the master switch, lists on their toggles.
  const want = [];
  if (enabled) {
    want.push('core', 'safety');
    for (const l of LISTS) if ((lists[l.id] ?? l.on)) want.push(l.id);
  }
  const have = await chrome.declarativeNetRequest.getEnabledRulesets();
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: want,
    disableRulesetIds: have.filter((id) => !want.includes(id)),
  });

  // YouTube scripts (skip entirely while youtube.com itself is paused).
  const ytPaused = paused.some((p) => p === 'youtube.com' || p.endsWith('.youtube.com'));
  const existing = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing });
  if (enabled && !ytPaused) await chrome.scripting.registerContentScripts(SCRIPTS);

  await applyPauseRules(paused);

  // Badge: Chrome's own per-tab count of blocked requests while on.
  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: enabled });
  await chrome.action.setBadgeText({ text: enabled ? '' : 'off' });
  await chrome.action.setBadgeBackgroundColor({ color: '#D4267C' });
  lastApply = Date.now();
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  // new users start on the current release: the popup's "what's new" line is for upgraders
  if (reason === 'install') chrome.storage.local.set({ newsSeen: '1.6' });
  // Also fires with reason 'update' right after chrome.runtime.reload() from
  // the popup's updater, so apply() re-runs against the freshly pulled files.
  ensureUpdateAlarm();
  ensureStatsAlarm();
  apply();
});
chrome.runtime.onStartup.addListener(() => {
  ensureUpdateAlarm();
  ensureStatsAlarm();
  checkForUpdates(); // fire-and-forget; the popup reads the stored result
  apply();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForUpdates();
  else if (alarm.name === STATS_ALARM) pollStats();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.lists || changes.paused)) apply();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'ad-skipped') {
    chrome.storage.local.get({ skipped: 0 }).then(({ skipped }) => chrome.storage.local.set({ skipped: skipped + 1 }));
    bumpStats({ youtubeSkipped: 1 });
  } else if (msg.type === 'zap-start') {
    // the popup asks; the background injects (executeScript lives here)
    chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ['zap.js'] })
      .then(() => reply({ ok: true }))
      .catch((e) => reply({ ok: false, error: String(e?.message || e) }));
    return true; // reply is async
  } else if (msg.type === 'zapped') {
    storeZapped(msg.host, msg.selector);
  } else if (msg.type === 'unzap') {
    unstoreZapped(msg.host, msg.selector);
  } else if (msg.type === 'stats-poll') {
    // one extra poll on popup open, so chips and rows are fresh (the alarm
    // polls once a minute; getMatchedRules forgets after five)
    pollStats().catch(() => {}).finally(() => reply(true));
    return true;
  } else if (msg.type === 'alive') {
    // content-script heartbeat: if this worker started late and missed
    // onStartup (possible after Chrome idles the worker out), re-apply.
    if (Date.now() - lastApply > 30_000) apply();
    reply(true);
  } else if (msg.type === 'set-enabled') {
    // kept for back-compat with old popups; the new popup writes storage
    chrome.storage.local.set({ enabled: msg.enabled }).then(() => reply(true));
    return true;
  }
});

// ------------------------------------------------- pop-up / pop-under tabs
// $popup filters ("||scamhost^$popup") describe pages ads open in new tabs;
// declarativeNetRequest cannot express them, so the build keeps their hosts
// in rulesets/popups.json and this guard closes matching tabs. Chrome's own
// popup blocker only stops gesture-less window.open — click-triggered ad
// tabs (pop-unders) need this. popups.js holds the decision; no extra
// permissions, <all_urls> already exposes the tab URLs.

let popupHosts = null; // rulesets/popups.json as { list id -> { hosts: Set, scoped } }
const popupBorn = new Map(); // tab id -> open time, bounds the young-tab window

const POPUP_YOUNG_MS = 3_000; // about:blank -> ad-host redirects land at once

async function loadPopupHosts() {
  try {
    popupHosts = {};
    for (const [id, { hosts, scoped }] of Object.entries(await (await fetch(chrome.runtime.getURL('rulesets/popups.json'))).json())) {
      popupHosts[id] = { hosts: new Set(hosts), scoped: scoped || {} };
    }
  } catch { popupHosts = {}; } // no list / bad JSON: the guard matches nothing
}
loadPopupHosts(); // once per worker life; a restart re-reads the file

async function closeIfAdPopup(tab) {
  if (popupHosts === null) return; // hosts not loaded yet
  const born = popupBorn.get(tab.id);
  if (born === undefined || Date.now() - born > POPUP_YOUNG_MS) return; // only opener-young tabs
  if (tab.openerTabId === undefined) return; // typed / bookmark: never a popup
  let opener;
  try { opener = await chrome.tabs.get(tab.openerTabId); } catch { return; } // opener already gone
  const { enabled, lists, paused } = await settings();
  const on = Object.fromEntries(LISTS.map((l) => [l.id, lists[l.id] ?? l.on])); // apply()'s toggle rule
  const targetUrl = tab.pendingUrl || tab.url || '';
  if (!PopupGuard.shouldClosePopup({ targetUrl, openerUrl: opener.url || '', enabled, lists: on, paused, popupHosts })) return;
  popupBorn.delete(tab.id);
  try { await chrome.tabs.remove(tab.id); } catch { return; } // the user beat us to it
  chrome.storage.local.get({ popups: 0 }).then(({ popups }) => chrome.storage.local.set({ popups: popups + 1 }));
  bumpStats({ popups: 1 }); // today's Pop-ups closed row
  bumpTabTally(tab.openerTabId, { popups: 1 }); // the opener page's chip
}

chrome.tabs.onCreated.addListener((tab) => {
  const now = Date.now();
  for (const [id, t] of popupBorn) if (now - t > 60_000) popupBorn.delete(id); // keep the map bounded
  popupBorn.set(tab.id, now);
  closeIfAdPopup(tab);
});
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.url) closeIfAdPopup(tab); // the about:blank -> ad-host redirect
});

// ---------------------------------------------------------- stats collector
// A once-a-minute alarm polls declarativeNetRequest.getMatchedRules (Chrome
// forgets matches after 5 minutes and rate-limits calls without a user
// gesture to ~20 per 10 minutes, so one poll per minute plus one on popup
// open is the whole budget) and folds what it sees into per-day counters
// (`stats:YYYY-MM-DD`, local date) + lifetime totals (`stats:all`) in
// storage.local, and per-tab tallies in storage.session for the popup's
// chips. De-duped by timeStamp+ruleId+tabId so overlapping polls (the
// minTimeStamp boundary) never double-count.

const STATS_ALARM = 'stats-poll';
const STATS_PERIOD_MIN = 1;
const MIN_POLL_GAP_MS = 30_000; // alarm + popup-open share one budget
const KEEP_DAYS = 400;

const S = PhilterStats;
let blocksIndex = null; // rulesets/blocks.json: block/redirect id ranges
let seenMatches = new Map(); // dedupe key -> timeStamp, pruned by age
let lastPruneDay = ''; // prune the day window once per worker-day

async function loadBlocksIndex() {
  try {
    blocksIndex = await (await fetch(chrome.runtime.getURL('rulesets/blocks.json'))).json();
  } catch { blocksIndex = {}; } // no index: nothing can be classified, stay null-safe
}
loadBlocksIndex(); // once per worker life

function ensureStatsAlarm() {
  chrome.alarms.create(STATS_ALARM, { periodInMinutes: STATS_PERIOD_MIN });
}

// Fold `fields` into a day's and the lifetime counters (never below zero).
// All counter writes share one queue: the alarm poll, popup-open polls and
// message handlers read-modify-write the same keys and must not interleave.
let statsChain = Promise.resolve();
function serializeStats(fn) {
  statsChain = statsChain.then(fn, fn);
  return statsChain;
}

function bumpStats(fields, day = S.dayKey(Date.now())) {
  return serializeStats(async () => {
    const key = `stats:${day}`;
    const got = await chrome.storage.local.get({ [key]: null, 'stats:all': null, statsSince: 0 });
    const patch = {};
    if (!got.statsSince) patch.statsSince = Date.now(); // "since Oct 12" on the Stats tab
    const dayCounts = { ...S.emptyCounts(), ...got[key] };
    const allCounts = { ...S.emptyCounts(), ...got['stats:all'] };
    for (const [k, v] of Object.entries(fields)) {
      dayCounts[k] = Math.max(0, (dayCounts[k] || 0) + v);
      allCounts[k] = Math.max(0, (allCounts[k] || 0) + v);
    }
    patch[key] = dayCounts;
    patch['stats:all'] = allCounts;
    await chrome.storage.local.set(patch);
  });
}

function mutateTabTally(fn) {
  return serializeStats(async () => {
    const { tabTally = {} } = await chrome.storage.session.get('tabTally');
    const next = fn(tabTally);
    if (next) await chrome.storage.session.set({ tabTally: next });
  });
}

function bumpTabTally(tabId, fields) {
  if (!(tabId >= 0)) return Promise.resolve();
  return mutateTabTally((tabTally) => {
    const key = String(tabId);
    const rec = { ...S.emptyCounts(), ...tabTally[key] };
    for (const [k, v] of Object.entries(fields)) rec[k] = Math.max(0, (rec[k] || 0) + v);
    tabTally[key] = rec;
    return tabTally;
  });
}

async function pollStats() {
  const now = Date.now();
  const { statsLastPollAt = 0 } = await chrome.storage.session.get('statsLastPollAt');
  if (now - statsLastPollAt < MIN_POLL_GAP_MS) return; // shared budget: too soon
  let res;
  try {
    res = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: statsLastPollAt + 1 });
  } catch {
    return; // rate limited or feedback unavailable: the next alarm retries
  }
  await chrome.storage.session.set({ statsLastPollAt: now });
  const infos = (res?.rulesMatchedInfo || []).filter((m) => {
    const k = S.dedupeKey(m);
    if (seenMatches.has(k)) return false;
    seenMatches.set(k, m.timeStamp);
    return true;
  });
  // keep the de-dup window bounded (matches live 5 minutes in Chrome anyway)
  if (seenMatches.size > 5000) {
    const cutoff = now - 10 * 60_000;
    for (const [k, ts] of seenMatches) if (ts < cutoff) seenMatches.delete(k);
  }
  if (!infos.length) return;

  const { days, tabs } = S.bucketMatches(infos, blocksIndex);
  const at = Date.now();
  for (const [day, counts] of Object.entries(days)) await bumpStats(counts, day);
  await mutateTabTally((tabTally) => {
    let changed = false;
    for (const [tabId, counts] of Object.entries(tabs)) {
      const rec = { ...S.emptyCounts(), ...tabTally[tabId] };
      for (const [k, v] of Object.entries(counts)) rec[k] += v;
      tabTally[tabId] = rec;
      changed = true;
    }
    return changed ? tabTally : null;
  });

  const today = S.dayKey(at);
  if (lastPruneDay !== today) {
    lastPruneDay = today;
    const all = await chrome.storage.local.get(null);
    const stale = S.dayKeysToRemove(
      Object.keys(all).filter((k) => /^stats:\d{4}-\d{2}-\d{2}$/.test(k)),
      today,
      KEEP_DAYS,
    );
    if (stale.length) await chrome.storage.local.remove(stale);
  }
}

// A new document in a tab (status 'loading' fires for navigations and
// reloads, not for pushState) starts a fresh page story: drop the old tally.
// Chrome's badge counter resets on the same signal, so the two stay in step.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    mutateTabTally((tabTally) => (tabTally[String(tabId)] ? (delete tabTally[String(tabId)], tabTally) : null)).catch(() => {});
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  mutateTabTally((tabTally) => (tabTally[String(tabId)] ? (delete tabTally[String(tabId)], tabTally) : null)).catch(() => {});
});

// ------------------------------------------------------------ zap store
// zap.js (in the page) reports what it zapped; the selectors persist per host
// in storage.local `zapped` and zap-apply.js re-hides them on every load.

async function storeZapped(host, sel) {
  if (!host || !sel) return;
  const { zapped = {} } = await chrome.storage.local.get('zapped');
  const before = zapped[host]?.length || 0;
  const next = S.zappedAdd(zapped, host, sel, Date.now());
  await chrome.storage.local.set({ zapped: next });
  if (next[host]?.length > before) bumpStats({ zapped: 1 }); // a real new one
}

async function unstoreZapped(host, sel) {
  if (!host || !sel) return;
  const { zapped = {} } = await chrome.storage.local.get('zapped');
  const before = zapped[host]?.length || 0;
  const next = S.zappedRemove(zapped, host, sel);
  await chrome.storage.local.set({ zapped: next });
  if ((next[host]?.length || 0) < before) bumpStats({ zapped: -1 }); // un-zap un-counts
}

// ------------------------------------------------------- update checks
// Asks the native helper (native/philterads-updater.mjs, registered once by
// `npm run install-updater`) where origin/main is, and stores the answer in
// storage.local as `update` for the popup. Read-only: the helper only fetches.
// Deliberately never touches the badge — that shows blocked counts.

const UPDATER_HOST = 'com.aialchemist.philterads';
const UPDATE_ALARM = 'update-check';

function sendNative(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(UPDATER_HOST, message, (reply) => {
        // lastError is set when the host isn't installed / not allowed for
        // this extension; keep its text so the popup can explain the setup.
        const err = chrome.runtime.lastError?.message;
        resolve(err ? { ok: false, error: err } : (reply ?? { ok: false, error: 'helper closed without a reply' }));
      });
    } catch (e) {
      resolve({ ok: false, error: String(e?.message || e) });
    }
  });
}

async function checkForUpdates() {
  const r = await sendNative({ cmd: 'status' });
  const prev = (await chrome.storage.local.get({ update: {} })).update;
  // on failure keep whatever was last known (a network hiccup must not
  // clear the dot), only stamp the error and time
  const update = r.ok
    ? { behind: r.behind, remote: r.remote, local: r.local, version: r.version, checkedAt: Date.now(),
        // a dismissal sticks to the commit it dismissed; a newer remote
        // re-arms the popup's update reminder
        ...(prev.dismissed === r.remote ? { dismissed: prev.dismissed } : {}) }
    : { behind: prev.behind ?? 0, local: prev.local, error: r.error, checkedAt: Date.now(),
        ...(prev.dismissed ? { dismissed: prev.dismissed } : {}) };
  await chrome.storage.local.set({ update });
}

function ensureUpdateAlarm() {
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 6 * 60 }); // every 6 hours
}
