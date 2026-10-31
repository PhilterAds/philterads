// Stats tab (Today / Lifetime / Zapped), split out of popup.js to keep both
// readable. Loads before popup.js; every binding it needs ($, fmt, state,
// selectTab) is a global popup.js declares, resolved at call time.

const S = PhilterStats;

let statsPeriod = 'today';
let statsData = null; // { todayKey, today, all, skipped, since }

async function loadStatsData() {
  const todayKey = `stats:${S.dayKey(Date.now())}`; // background stores days as stats:YYYY-MM-DD
  const got = await chrome.storage.local.get({
    [todayKey]: null, 'stats:all': null, skipped: 0, statsSince: 0,
  });
  return { todayKey, today: got[todayKey], all: got['stats:all'], skipped: got.skipped, since: got.statsSince };
}

function countsFor(period) {
  const counts = { ...S.emptyCounts(), ...(period === 'today' ? statsData.today : statsData.all) };
  if (period !== 'today') {
    // the old `skipped` counter predates per-day collection: never drop it
    counts.youtubeSkipped = S.lifetimeYouTube(statsData.skipped, statsData.all);
  }
  return counts;
}

function renderStats() {
  for (const btn of document.querySelectorAll('#panel-stats .seg button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.period === statsPeriod));
  }
  const zapView = statsPeriod === 'zapped';
  $('stats-rows').hidden = zapView;
  $('zv-list').hidden = !zapView;
  if (zapView) { chrome.storage.local.get({ zapped: {} }).then(({ zapped }) => renderZappedView(zapped)); return; }
  $('zv-empty').hidden = true;
  $('zv-clear-all').hidden = true;

  const counts = countsFor(statsPeriod);
  const rows = S.ROW_DEFS.map(([k]) => counts[k]);
  const total = rows.reduce((a, b) => a + b, 0);
  const max = Math.max(...rows, 1);

  if (statsPeriod === 'today') {
    $('stats-date').textContent = new Date().toLocaleDateString(LANG, { weekday: 'short', month: 'short', day: 'numeric' });
    $('stats-cap').textContent = total > 0 ? T('stats.capToday') : T('stats.capTodayZero');
  } else {
    const d = new Date(statsData.since || Date.now());
    const sameYear = d.getFullYear() === new Date().getFullYear();
    $('stats-date').textContent = T('stats.since', { date: d.toLocaleDateString(LANG, {
      month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
    }) });
    $('stats-cap').textContent = total > 0 ? T('stats.capAll') : T('stats.capAllZero');
  }
  $('stats-num').textContent = fmt.format(total);

  const box = $('stats-rows');
  box.textContent = '';
  for (const [key] of S.ROW_DEFS) {
    const label = T(`row.${key}`);
    const n = counts[key];
    const li = document.createElement('li');
    li.className = 'stats-row' + (n === 0 ? ' zero' : '');
    li.setAttribute('aria-label', `${label}: ${fmt.format(n)}`);
    const name = document.createElement('span');
    name.textContent = label;
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('i');
    fill.style.width = `${n === 0 ? 0 : Math.max(2, (n / max) * 100)}%`; // >0 but tiny: visible sliver
    bar.append(fill);
    const value = document.createElement('b');
    value.textContent = fmt.format(n);
    li.append(name, bar, value);
    box.append(li);
  }
}

async function refreshStats() {
  statsData = await loadStatsData();
  renderStats();
}

async function initStats() {
  statsData = await loadStatsData();
  ({ statsPeriod = 'today' } = await chrome.storage.local.get({ statsPeriod: 'today' }));
  for (const btn of document.querySelectorAll('#panel-stats .seg button')) {
    btn.addEventListener('click', () => {
      if (statsPeriod === btn.dataset.period) return;
      statsPeriod = btn.dataset.period;
      if (statsPeriod !== 'zapped') chrome.storage.local.set({ statsPeriod }); // Today/Lifetime persist; Zapped is a peek
      renderStats();
    });
  }
  renderStats();
  // the popup-open poll (and the next alarm) land as storage writes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !statsData) return;
    if (changes[statsData.todayKey] || changes['stats:all'] || changes.statsSince) refreshStats();
  });
}

// ---- Stats > Zapped: every zapped record, grouped by site ----

const X_SVG = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
const UNDO_SVG = '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7"/></svg>';

function zapDate(at) {
  if (!at) return '';
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(LANG, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: '2-digit' }) });
}

function renderZappedView(store) {
  if (statsPeriod !== 'zapped') return;
  const { total, hosts } = S.zappedTotal(store);
  const chain = state.host ? S.hostChain(state.host) : [];
  $('stats-num').textContent = fmt.format(total);
  $('stats-cap').textContent = total ? T('zv.cap', { hosts, count: hosts }) : T('zv.capZero');
  $('stats-date').textContent = total ? T('zv.hint') : '';
  $('zv-clear-all').hidden = total === 0;
  $('zv-empty').hidden = total > 0;

  const box = $('zv-list');
  box.hidden = total === 0;
  box.textContent = '';
  const latest = (list) => Math.max(0, ...list.map((z) => z.at || 0));
  const order = Object.keys(store).filter((h) => store[h]?.length).sort((a, b) =>
    (chain.includes(b) - chain.includes(a)) || (latest(store[b]) - latest(store[a])));

  for (const host of order) {
    const list = store[host];
    const site = host.replace(/^www\./, '');
    const head = document.createElement('div');
    head.className = 'zv-host';
    const name = document.createElement('span');
    name.className = 'zv-name';
    name.textContent = `${site} · ${fmt.format(list.length)}`;
    head.append(name);
    if (chain.includes(host)) {
      const here = document.createElement('span');
      here.className = 'zv-here';
      here.textContent = T('zv.here');
      head.append(here);
    }
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'zv-btn';
    all.innerHTML = UNDO_SVG;
    all.append(Object.assign(document.createElement('span'), { textContent: T('zv.undoAll') }));
    all.title = T('zv.undoAllT', { count: list.length, n: fmt.format(list.length), site });
    all.setAttribute('aria-label', all.title);
    all.addEventListener('click', () => zvWrite((z) => S.zappedRemoveHosts(z, [host])));
    head.append(all);
    box.append(head);

    for (const z of [...list].sort((a, b) => (b.at || 0) - (a.at || 0))) {
      const row = document.createElement('div');
      row.className = 'zv-rec';
      const sel = document.createElement('span');
      sel.className = 'zv-sel';
      sel.textContent = z.sel;
      sel.title = z.sel;
      const at = document.createElement('span');
      at.className = 'zv-at';
      at.textContent = zapDate(z.at);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'zv-btn x';
      x.innerHTML = X_SVG;
      x.title = T('zv.undoOneT', { site });
      x.setAttribute('aria-label', x.title);
      x.addEventListener('click', () => zvWrite((s2) => S.zappedRemove(s2, host, z.sel)));
      row.append(sel, at, x);
      box.append(row);
    }
  }
}

// every change goes through storage; the onChanged listener in popup.js
// (refreshZapped) re-renders this list, the Home chip and the Undo button
async function zvWrite(fn) {
  const { zapped = {} } = await chrome.storage.local.get('zapped');
  await chrome.storage.local.set({ zapped: fn(zapped) });
}

function initZappedView() {
  $('zv-clear-all').addEventListener('click', () => zvWrite(() => ({})));
}
