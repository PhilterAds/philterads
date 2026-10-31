// Popup state: everything is driven from chrome.storage.local; background.js
// reacts to storage changes and re-applies rulesets/scripts. The per-page
// blocked count comes from declarativeNetRequest.getMatchedRules (needs the
// declarativeNetRequestFeedback permission) filtered through
// rulesets/blocks.json, which the build generates with the id ranges of
// block/redirect rules per ruleset.
// Stats tab + "Zapped by you" card live in popup-stats.js; pure helpers in
// stats.js (PhilterStats).

const LISTS = [
  // energy 1-4 = how strong the list is (flask fill); mood = how safe it is to keep on (flask face)
  { id: 'easylist', name: T('list.ads'), source: 'EasyList', on: true, energy: 2, mood: 'happy', info: 'info.ads' },
  { id: 'easyprivacy', name: T('list.trackers'), source: 'EasyPrivacy', on: true, energy: 2, mood: 'happy', info: 'info.trackers' },
  { id: 'malware', name: T('list.malware'), source: `URLhaus · ${T('list.wholeSites')}`, on: true, energy: 3, mood: 'happy', info: 'info.malware' },
  { id: 'cookies', name: T('list.cookies'), source: 'Fanboy Cookie List', on: false, energy: 3, mood: 'ok', info: 'info.cookies' },
  { id: 'annoyances', name: T('list.annoyances'), source: 'Fanboy Annoyances', on: false, energy: 4, mood: 'wary', info: 'info.annoyances' },
];

// Home chips: label, per-tab tally key, title (tooltip). Fixed order breaks
// ties when counts are equal; chips render sorted by count descending.
const CHIP_DEFS = [
  ['ads', T('chip.ads'), T('chip.ads.t')],
  ['trackers', T('chip.trackers'), null],
  ['malware', T('chip.malware'), null],
  ['cookies', T('chip.cookies'), T('chip.cookies.t')],
  ['annoyances', T('chip.annoyances'), null],
  ['popups', T('chip.popups'), T('chip.popups.t')],
  ['zapped', T('chip.zapped'), T('chip.zapped.t')],
];

const fmt = new Intl.NumberFormat();
const $ = (id) => document.getElementById(id);

// Hero + site card are re-rendered from this on every change, so toggles
// made while the popup is open keep the two in sync.
const state = {
  enabled: true,
  host: null, // hostname of the active tab; null when it is not a web page
  tabId: null,
  pausedHere: false,
  blocked: undefined, // undefined = still resolving, null = unavailable
  tally: null, // background's per-tab session tally
  zappedCount: 0, // stored zap selectors for this host chain
};

async function loadBlocksIndex() {
  try {
    const r = await fetch(chrome.runtime.getURL('rulesets/blocks.json'));
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}

async function blockedOnTab(tabId, index) {
  // Chrome's badge is the number already in the toolbar corner, so read it
  // first and the two always agree (getMatchedRules forgets after 5 minutes).
  try {
    const text = await chrome.action.getBadgeText({ tabId });
    if (/^\d+$/.test(text)) return Number(text);
  } catch {}
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    return rulesMatchedInfo.filter((m) => {
      const entry = index[m.rule.rulesetId];
      return entry && entry.ranges.some(([a, b]) => m.rule.ruleId >= a && m.rule.ruleId <= b);
    }).length;
  } catch {
    return null; // quota reached or feedback unavailable
  }
}

function renderChips() {
  const ul = $('chips');
  const empty = $('chips-empty');
  ul.textContent = '';
  if (!state.enabled || state.pausedHere || !state.host) {
    ul.hidden = true;
    empty.hidden = true;
    return; // Corked / Paused / not a web page: word state only, no chips
  }
  if (state.blocked === 0) {
    ul.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const chips = CHIP_DEFS
    .map(([key, label, title], i) => ({ label, title, i, n: key === 'zapped' ? state.zappedCount : (state.tally?.[key] || 0) }))
    .filter((c) => c.n > 0); // no "0" chips, ever
  if (!chips.length) {
    ul.hidden = true; // blocked > 0 but no tally yet: nothing under the caption
    return;
  }
  chips.sort((a, b) => b.n - a.n || a.i - b.i); // count desc, ties: fixed order
  ul.hidden = false;
  for (const c of chips) {
    const li = document.createElement('li');
    li.className = 'chip';
    if (c.title) li.title = c.title;
    li.append(`${c.label} `);
    const b = document.createElement('b');
    b.textContent = fmt.format(c.n);
    li.append(b);
    ul.append(li);
  }
}

function renderHero() {
  const muted = !state.enabled || state.pausedHere; // paused / corked: word state, quiet hero
  const num = $('hero-num');
  $('hero').classList.toggle('muted', muted);
  // the sparkle is an <svg>: el.hidden=true would only set an expando
  // (SVGElement has no hidden IDL attribute), so toggle the attribute
  $('hero-sparkle').toggleAttribute('hidden', muted);
  num.classList.toggle('word', muted);
  if (!state.enabled) {
    num.textContent = T('hero.corked');
    $('hero-caption').textContent = T('hero.corkedCap');
  } else if (state.pausedHere) {
    num.textContent = T('hero.paused');
    $('hero-caption').textContent = T('hero.pausedCap');
  } else if (!state.host) {
    num.textContent = '–';
    $('hero-caption').textContent = T('hero.none');
  } else {
    num.textContent = state.blocked == null ? '–' : fmt.format(state.blocked);
    $('hero-caption').textContent = T('hero.caption');
  }
  renderChips();
}

function renderSite() {
  const pause = $('pause');
  const sub = $('site-sub');
  $('site-card').classList.toggle('dim', !state.enabled || !state.host);
  pause.disabled = !state.enabled || !state.host;
  if (!state.host) {
    $('site-host').textContent = T('site.notWeb');
    $('site-host').title = '';
    sub.textContent = state.enabled ? T('site.nothing') : T('site.off');
    sub.classList.remove('danger');
  } else {
    $('site-host').textContent = state.host.replace(/^www\./, ''); // display only
    $('site-host').title = state.host;
    pause.setAttribute('aria-label', T('site.pauseOn', { host: state.host }));
    sub.textContent = !state.enabled
      ? T('site.off')
      : state.pausedHere ? T('site.paused') : T('site.pause');
    sub.classList.toggle('danger', state.enabled && state.pausedHere);
    pause.checked = state.pausedHere;
  }
}

// ---- Zap button: idle / busy / error ----

let zapPhase = 'idle';

function renderZap() {
  if (zapPhase !== 'idle') return; // a click is in flight (or just failed)
  const btn = $('zap');
  btn.disabled = !state.enabled || state.pausedHere || !state.host;
  btn.title = !state.enabled ? T('zap.titleOff')
    : state.pausedHere ? T('zap.titlePaused')
    : !state.host ? T('zap.titleNone')
    : T('zap.title');
  $('zap-label').textContent = T('zap.label');
}

// "Undo" sits beside Zap once this site has zaps; it clears them for this
// site and zap-apply.js brings the elements back live, no reload needed.
let unzapBusy = false;

function renderUnzap() {
  if (unzapBusy) return;
  const btn = $('unzap');
  const n = state.zappedCount;
  btn.hidden = !(n > 0) || !state.host;
  btn.disabled = false;
  $('unzap-label').textContent = T('unzap.label', { n: fmt.format(n) });
  const site = (state.host || '').replace(/^www\./, '');
  btn.title = T('unzap.title', { count: n, n: fmt.format(n), site });
  btn.setAttribute('aria-label', btn.title);
}

async function refreshZapped() {
  const { zapped = {} } = await chrome.storage.local.get('zapped');
  state.zappedCount = state.host ? PhilterStats.zappedCount(zapped, PhilterStats.hostChain(state.host)) : 0;
  renderChips();
  renderUnzap();
  if (typeof renderZappedView === 'function') renderZappedView(zapped);
}

function wireZap() {
  $('unzap').addEventListener('click', async () => {
    if (unzapBusy || !state.host) return;
    unzapBusy = true;
    $('unzap').disabled = true;
    const { zapped = {} } = await chrome.storage.local.get('zapped');
    await chrome.storage.local.set({ zapped: PhilterStats.zappedRemoveHosts(zapped, PhilterStats.hostChain(state.host)) });
    $('unzap-label').textContent = T('unzap.back');
    setTimeout(() => { unzapBusy = false; refreshZapped(); }, 900);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.zapped && !unzapBusy) refreshZapped();
  });

  $('zap').addEventListener('click', async () => {
    if (zapPhase !== 'idle') return;
    zapPhase = 'busy';
    $('zap').disabled = true;
    $('zap-label').textContent = T('zap.opening');
    let res = null;
    try { res = await chrome.runtime.sendMessage({ type: 'zap-start', tabId: state.tabId }); } catch {}
    if (res?.ok) {
      window.close();
      return;
    }
    zapPhase = 'error';
    $('zap-label').textContent = T('zap.cant');
    setTimeout(() => { zapPhase = 'idle'; renderZap(); }, 2000);
  });
}

// Sip hops on a boop, when PhilterAds wakes up, and when the page count lands.
function hop() {
  const m = $('mascot');
  m.classList.remove('hop');
  void m.offsetWidth; // restart the animation if it is already hopping
  m.classList.add('hop');
}

function applyMaster() {
  const on = $('master').checked;
  state.enabled = on;
  if (on) document.body.removeAttribute('data-state');
  else document.body.setAttribute('data-state', 'off');
  $('master').title = on ? T('master.off') : T('master.on');
  renderHero();
  renderSite();
  renderZap();
}

// ---- tabs: Home / Stats / Filters / Settings / AI MCP ----

const TABS = ['home', 'stats', 'filters', 'settings', 'ai'];
let currentTab = 'home';

function selectTab(name, moveFocus = false, animate = true) {
  currentTab = name;
  for (const n of TABS) {
    const active = n === name;
    const tab = $(`tab-${n}`);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1; // roving tabindex
    $(`panel-${n}`).hidden = !active;
    $(`panel-${n}`).classList.toggle('enter', active && animate); // fade on switch, not on open
  }
  if (moveFocus) $(`tab-${name}`).focus();
}

function wireTabs(initial) {
  for (const n of TABS) $(`tab-${n}`).addEventListener('click', () => selectTab(n));
  $('tabs').addEventListener('keydown', (e) => {
    let i = TABS.indexOf(currentTab);
    if (e.key === 'ArrowLeft') i = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'ArrowRight') i = (i + 1) % TABS.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = TABS.length - 1;
    else return;
    e.preventDefault();
    selectTab(TABS[i], true); // move + activate
  });
  selectTab(initial, false, false);
}

// ---- Settings → Theme: Auto (browser) / Light / Dark ----

function wireTheme() {
  const root = document.documentElement;
  const buttons = document.querySelectorAll('[data-theme-pick]');
  const show = (pick) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themePick === pick)));
  let current = 'auto';
  try { current = localStorage.getItem('philter_theme') || 'auto'; } catch {}
  show(current);
  buttons.forEach((b) => b.addEventListener('click', () => {
    const pick = b.dataset.themePick;
    if (pick === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pick);
    try { localStorage.setItem('philter_theme', pick); } catch {}
    chrome.storage.local.set({ theme: pick }); // zap.js reads this one in the page
    show(pick);
  }));
}

// ---- header: language picker (EN / 日本語); picking reloads the popup ----

function wireLang() {
  const btn = $('lang-btn');
  const menu = $('lang-menu');
  $('lang-short').textContent = LANGS.find((l) => l.id === LANG).short;
  for (const l of LANGS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(l.id === LANG));
    item.lang = l.id;
    item.innerHTML = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg>';
    item.append(Object.assign(document.createElement('span'), { textContent: l.name }));
    item.addEventListener('click', () => { close(); setLang(l.id); });
    menu.append(item);
  }
  const items = () => [...menu.querySelectorAll('button')];
  const open = () => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    (items().find((i) => i.getAttribute('aria-checked') === 'true') || items()[0]).focus();
  };
  const close = (refocus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  };
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i + list.length - 1) % list.length].focus(); }
    else if (e.key === 'Tab') close();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.lang')) close(); });
}

async function main() {
  applyI18n();
  wireLang();
  wireTheme();
  const { enabled = true, lists = {}, paused = [], update = {}, newsSeen = '' } = await chrome.storage.local.get({
    enabled: true, lists: {}, paused: [], update: {}, newsSeen: '',
  });

  // master switch
  state.enabled = enabled;
  const master = $('master');
  master.checked = enabled;
  master.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: master.checked });
    applyMaster();
    if (master.checked) hop();
  });
  applyMaster();
  $('mascot').addEventListener('click', hop);

  // "Share the love": copy a friendly link, say so for a moment
  $('share').addEventListener('click', async () => {
    const btn = $('share');
    try {
      await navigator.clipboard.writeText(T('love.shareText'));
      btn.textContent = T('love.copied');
    } catch {
      btn.textContent = 'philterads.com';
    }
    clearTimeout(btn.resetTimer);
    btn.resetTimer = setTimeout(() => { btn.textContent = T('love.share'); }, 1800);
  });
  $('mascot').addEventListener('animationend', (e) => {
    if (e.animationName === 'm-hop') $('mascot').classList.remove('hop');
  });

  // current site + its pause toggle
  const index = await loadBlocksIndex();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('http')) {
    try { state.host = new URL(tab.url).hostname; } catch {}
    state.tabId = tab.id;
  }
  if (state.host) {
    state.pausedHere = paused.some((p) => state.host === p || state.host.endsWith('.' + p));
    $('pause').addEventListener('change', async () => {
      const { paused: current = [] } = await chrome.storage.local.get({ paused: [] });
      const next = $('pause').checked
        ? [...new Set([...current, state.host])]
        // unpause: drop the entries that apply to this host
        : current.filter((p) => !(state.host === p || state.host.endsWith('.' + p)));
      chrome.storage.local.set({ paused: next });
      state.pausedHere = $('pause').checked;
      renderSite();
      renderHero();
      renderZap();
    });
  }
  renderSite();
  renderHero();
  renderZap();
  wireZap();
  if (state.tabId != null) {
    // chips: the background's per-tab tally + this host's stored zaps
    const loadTally = async () => {
      try {
        const { tabTally = {} } = await chrome.storage.session.get('tabTally');
        state.tally = tabTally[String(state.tabId)] || null;
      } catch {}
      await refreshZapped();
    };
    await loadTally();
    // one extra poll on open (background does the call), then refresh
    try { await chrome.runtime.sendMessage({ type: 'stats-poll' }); } catch {}
    await loadTally();
  }
  if (tab) {
    // dash first, swap in the count once it resolves; no count-up
    blockedOnTab(tab.id, index).then((n) => {
      state.blocked = n;
      renderHero();
      if (n > 0 && state.enabled && !state.pausedHere) hop();
    });
  }

  wireTabs(update.tabsHint ? 'settings' : 'home'); // just updated: send the user to Settings
  initStats();
  initZappedView();

  // list toggles
  const hasIndex = Object.keys(index).length > 0;
  const box = $('list-rows');
  const inputs = new Map();
  const infos = [];
  for (const l of LISTS) {
    const on = lists[l.id] ?? l.on;
    const total = index[l.id]?.total;
    const row = document.createElement('label');
    row.className = 'list-row' + (on ? '' : ' off');
    row.htmlFor = `list-${l.id}`; // the info button is labelable too, so point the label at the switch
    const text = document.createElement('span');
    text.className = 'list-text';
    const name = document.createElement('span');
    name.className = 'list-name';
    name.id = `list-name-${l.id}`;
    name.textContent = l.name;
    const desc = document.createElement('span');
    desc.className = 'list-desc';
    desc.textContent = total == null ? l.source : `${l.source} · ${T('list.rules', { n: fmt.format(total) })}`;
    text.append(name, desc);
    const sw = document.createElement('span');
    sw.className = 'sw';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `list-${l.id}`;
    input.setAttribute('aria-labelledby', name.id);
    input.checked = on;
    input.addEventListener('change', () => {
      chrome.storage.local.set({ lists: Object.fromEntries([...inputs].map(([id, i]) => [id, i.checked])) });
      row.classList.toggle('off', !input.checked);
      renderSummary();
    });
    sw.append(input, Object.assign(document.createElement('i'), { className: 'sw-i' }));
    inputs.set(l.id, input);
    const info = document.createElement('div');
    info.className = 'list-info';
    info.id = `list-info-${l.id}`;
    info.hidden = true;
    info.innerHTML = T(l.info);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'info-btn';
    btn.textContent = 'i';
    btn.setAttribute('aria-label', T('info.aria', { list: l.name }));
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', info.id);
    btn.addEventListener('click', (e) => {
      e.preventDefault(); // inside the label: never flip the switch
      const open = info.hidden;
      for (const [b, i] of infos) { i.hidden = true; b.setAttribute('aria-expanded', 'false'); } // one open at a time
      info.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) info.scrollIntoView({ block: 'nearest' });
    });
    infos.push([btn, info]);
    row.append(flask(l), text, btn, sw);
    box.append(row, info);
  }

  // a little potion per list: fill = energy, face = mood
  function flask({ id, energy, mood }) {
    const top = [0, 18, 15.5, 13, 10.5][energy];
    const mouth = { happy: 'M9.3 19.6 Q12 22.8 14.7 19.6', ok: 'M9.9 20.4 Q12 21.9 14.1 20.4', wary: 'M9.6 21 q1.2 -1.2 2.4 0 t2.4 0' }[mood];
    const body = 'M9 2.5 h6 v6.8 l6 11.2 a2.8 2.8 0 0 1 -2.5 4.2 H5.5 a2.8 2.8 0 0 1 -2.5 -4.2 L9 9.3 Z';
    const fizz = energy >= 4 ? '<circle class="fizz" cx="11" cy="9" r="1"/><circle class="fizz" cx="13.4" cy="10" r=".8"/>' : '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `flask mood-${mood}`);
    svg.setAttribute('viewBox', '0 0 24 28');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<defs><clipPath id="fl-${id}"><path d="${body}"/></clipPath></defs>`
      + `<path class="glass" d="${body}"/>`
      + `<g clip-path="url(#fl-${id})"><rect class="liquid" x="0" y="${top}" width="24" height="28"/><rect class="surface" x="0" y="${top}" width="24" height="1.2"/></g>`
      + `<path class="shine" d="M7.2 14 l-1.9 3.6"/>${fizz}`
      + `<circle class="eye" cx="10" cy="17.4" r="1"/><circle class="eye" cx="14" cy="17.4" r="1"/><path class="face" d="${mouth}"/>`;
    return svg;
  }

  function renderSummary() {
    const el = $('list-summary');
    if (!hasIndex) { el.hidden = true; return; }
    let sum = 0;
    for (const [id, input] of inputs) if (input.checked) sum += index[id]?.total ?? 0;
    el.textContent = T('list.active', { n: fmt.format(sum) });
    el.hidden = false;
  }
  renderSummary();

  // ---- updates (native helper: native/philterads-updater.mjs) ----
  // The same sendNativeMessage wrapper the background worker uses for the
  // 6-hourly check; here it also powers the explicit buttons. status is
  // read-only (git fetch); update is pull --ff-only + reload.
  const UPDATER_HOST = 'com.aialchemist.philterads';

  function sendNative(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendNativeMessage(UPDATER_HOST, message, (reply) => {
          const err = chrome.runtime.lastError?.message;
          resolve(err ? { ok: false, error: err } : (reply ?? { ok: false, error: 'helper closed without a reply' }));
        });
      } catch (e) {
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  }

  function explain(error) {
    if (/native messaging host not found|native messaging host .* forbidden/i.test(error || '')) {
      return T('set.setup', { id: chrome.runtime.id });
    }
    if (error === 'local changes') return T('set.dirty');
    if (error === 'diverged') return T('set.diverged');
    if (error === 'not on main') return T('set.notMain');
    return T('set.offline', { error });
  }

  const showMsg = (text, ok = false) => {
    const el = $('update-msg');
    el.hidden = text == null;
    el.textContent = text ?? '';
    el.classList.toggle('err', !ok && text != null);
  };

  const running = chrome.runtime.getManifest().version;
  // the folder can already hold a newer version than Chrome is running
  // (pulled by hand, or pushed from this very checkout): that needs a reload only
  const reloadOnly = (st) => !(st.behind > 0) && !!st.version && st.version !== running;

  // One update path shared by the Settings button and the footer reminder:
  // the native call must never be duplicated.
  async function performUpdate(report) {
    const cur = (await chrome.storage.local.get({ update: {} })).update; // a Check may have run since load
    if (reloadOnly(cur)) {
      // already on disk: nothing to pull, just load it
      chrome.storage.local.set({ update: { ...cur, tabsHint: true } });
      report.ok(T('set.reloading'));
      setTimeout(() => chrome.runtime.reload(), 300);
      return { ok: true };
    }
    const r = await sendNative({ cmd: 'update' });
    if (r.ok) {
      chrome.storage.local.set({ update: { behind: 0, local: r.to, checkedAt: Date.now(), tabsHint: true } });
      $('update-hint').hidden = false;
      report.ok(T('set.updated', { sha: r.to }));
      setTimeout(() => chrome.runtime.reload(), 600);
    } else {
      report.fail(explain(r.error));
    }
    return r;
  }

  // ---- footer: love line or update reminder (every tab) ----
  let reminderShown = false;
  // one-time "what's new" line after updating into this release; fresh
  // installs are stamped seen by the background, so only upgraders see it
  const NEWS = '1.6';
  let newsOn = newsSeen !== NEWS;

  function renderReminder(st) {
    const show = PhilterStats.reminderVisible(st);
    $('love-line').hidden = show || newsOn;
    $('whats-new').hidden = show || !newsOn;
    $('update-reminder').hidden = !show;
    $('remind-body').hidden = false;
    $('remind-state').hidden = true;
    if (show && !reminderShown) {
      reminderShown = true; // the panel-in fade runs once per popup open
      $('update-reminder').classList.add('enter');
    }
  }

  $('news-ok').addEventListener('click', async () => {
    newsOn = false;
    chrome.storage.local.set({ newsSeen: NEWS });
    renderReminder((await chrome.storage.local.get({ update: {} })).update);
  });

  $('remind-later').addEventListener('click', async () => {
    const { update: current = {} } = await chrome.storage.local.get({ update: {} });
    const next = { ...current, dismissed: current.remote };
    chrome.storage.local.set({ update: next });
    renderReminder(next); // a newer remote commit will bring it back
  });

  $('remind-update').addEventListener('click', async () => {
    $('remind-body').hidden = true;
    const st = $('remind-state');
    st.hidden = false;
    st.textContent = T('set.updating');
    await performUpdate({
      ok: () => { st.textContent = T('rem.done'); },
      fail: () => {
        st.textContent = T('rem.fail');
        setTimeout(() => selectTab('settings'), 600);
      },
    });
  });

  function renderUpdate(st) {
    // version = what this popup is running; local sha = what the last check saw on disk
    $('update-sub').textContent = `v${running}${st.local ? ` · ${st.local}` : ''}`;
    const pending = st.behind > 0 || reloadOnly(st);
    $('update-dot').hidden = !pending;
    $('tab-settings').setAttribute('aria-label', pending ? T('tab.settingsDot') : T('tab.settings'));
    const now = $('update-now');
    now.hidden = !pending;
    if (st.behind > 0) now.textContent = T('set.updateNowN', { n: st.behind });
    else if (pending) now.textContent = T('set.updateNowV', { v: st.version });
    renderReminder(st);
  }

  renderUpdate(update);
  if (update.tabsHint) {
    // the update ran last time the popup was open; the extension reloaded
    // with it, so this is the first chance to say "reload your tabs"
    $('update-hint').hidden = false;
    chrome.storage.local.set({ update: { ...update, tabsHint: false } });
  }

  $('update-check').addEventListener('click', async () => {
    const btn = $('update-check');
    btn.disabled = true;
    $('update-now').hidden = true;
    showMsg(T('set.checking'), true);
    const r = await sendNative({ cmd: 'status' });
    btn.disabled = false;
    if (r.ok) {
      const next = { behind: r.behind, remote: r.remote, local: r.local, version: r.version, checkedAt: Date.now() };
      chrome.storage.local.set({ update: next });
      renderUpdate(next);
      if (r.behind > 0 || reloadOnly(next)) showMsg(null);
      else showMsg(T('set.upToDate', { sha: r.local }), true);
    } else {
      // keep the last-known dot/sha; only the error is new information
      const next = { behind: update.behind ?? 0, local: update.local, remote: update.remote, error: r.error, checkedAt: Date.now() };
      chrome.storage.local.set({ update: next });
      renderUpdate(next);
      showMsg(explain(r.error));
    }
  });

  $('update-now').addEventListener('click', async () => {
    const btn = $('update-now');
    btn.disabled = true;
    showMsg(T('set.updating'), true);
    await performUpdate({
      ok: (text) => showMsg(text, true),
      fail: (text) => { btn.disabled = false; showMsg(text); },
    });
  });
}

main();
