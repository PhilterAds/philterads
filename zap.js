// "Zap a missed ad": in-page picker injected into the top frame by
// background.js (chrome.scripting.executeScript, {type:'zap-start'}). All UI
// lives in one <philterads-zap-host> with an open shadow root (all:initial,
// own tokens by prefers-color-scheme) so nothing inherits page styles, and
// the page never sees a click while picking: window-level capture handlers
// swallow pointer/key events except the ones aimed at our own UI.
//
// The selector generator at the top is pure (DOM access goes through a small
// adapter) so tests can exercise it without a page.

(() => {
  // ---- selector generation (pure; adapter `a` supplies all DOM access) ----

  // ids/classes with digits or a long consonant run are build-generated
  // (hashes, session ids): they change next pageview and must not be stored.
  function isStableClass(c) {
    return c.length > 0 && !/\d/.test(c) && !/[bcdfghjklmnpqrstvwxz]{8}/i.test(c);
  }
  function idUsable(id) {
    return !!id && id.length <= 24 && !/\d{3}/.test(id);
  }

  // Build a selector that matches exactly `el` at zap time, or null:
  //   1. #id            — stable (no digit run, short) and unique
  //   2. tag.stableCls  — stable classes only, unique match
  //   3. anchor > tag:nth-of-type(...) chain — anchored at the nearest
  //      stably-id'd ancestor (searched up to 6 levels), else at body;
  //      nth-of-type chains pick exactly one child per step, so the result
  //      is unique by construction — and verified anyway before storing.
  // Never returns a selector for html/body or one that matches 2+ elements.
  function buildSelector(el, a) {
    const tag = a.tag(el);
    if (!tag || tag === 'html' || tag === 'body') return null;
    const id = a.idOf(el);
    if (idUsable(id)) {
      const sel = '#' + a.escape(id);
      if (a.matches(sel) === 1) return sel;
    }
    const classes = a.classes(el);
    if (classes.length) {
      const sel = tag + classes.map((c) => '.' + a.escape(c)).join('');
      if (a.matches(sel) === 1) return sel;
    }
    let anchorEl = null;
    let anchorSel = null;
    let p = a.parent(el);
    for (let up = 0; p && up < 6; up += 1, p = a.parent(p)) {
      const pid = a.idOf(p);
      if (idUsable(pid)) {
        const sel = '#' + a.escape(pid);
        if (a.matches(sel) === 1) { anchorEl = p; anchorSel = sel; break; }
      }
    }
    const segs = [];
    let node = el;
    while (node) {
      const t = a.tag(node);
      if (t === 'html') return null;
      if (node === anchorEl || t === 'body') break;
      const i = a.nthOfType(node);
      if (!i) return null; // sibling position unknown: refuse rather than guess
      segs.unshift(`${t}:nth-of-type(${i})`);
      node = a.parent(node);
    }
    if (!segs.length) return null;
    const sel = `${anchorSel || 'body'} > ${segs.join(' > ')}`;
    return a.matches(sel) === 1 ? sel : null;
  }

  if (!globalThis.ZapSelect) globalThis.ZapSelect = { isStableClass, idUsable, buildSelector };

  // ---- page entry (the guard keeps this from running under node --test) ----
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.documentElement) return;
  if (window.__philterZap) { window.__philterZap.arm(); return; } // re-arm, no double inject

  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => CSS.escape(s);
  const adapter = {
    tag: (el) => el.tagName.toLowerCase(),
    idOf: (el) => el.id || '',
    classes: (el) => [...el.classList].filter(isStableClass),
    escape: esc,
    matches(sel) { try { return document.querySelectorAll(sel).length; } catch { return Infinity; } },
    parent: (el) => el.parentElement,
    nthOfType(el) {
      let i = 1;
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.tagName === el.tagName) i += 1;
      }
      return i;
    },
  };

  // ---- host + shadow root: everything visible lives in here ----

  const host = document.createElement('philterads-zap-host');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    /* the descendant reset is a bare * on purpose: specificity (0,0,0), so
       every rule below wins over it (e.g. .x svg path, (0,0,3)). :host * would
       be (0,1,0) and would override those. style stays hidden explicitly —
       all:initial would otherwise beat the UA style{display:none} (author
       origin > UA origin) and the CSS text would lay out as inline boxes
       covering the viewport, eating every click */
    :host { all: initial; box-sizing: border-box;
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    * { all: initial; box-sizing: border-box;
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    :host style { display: none !important; }
    [hidden] { display: none !important; }
    :host { --bg:#FFFFFF; --text:#221736; --muted:#6F6482; --border:#E8E1F2; --accent:#D4267C;
            --potion:#FF4FA3; --spark:#FFD23F; --plum:#2A1B4E; --shadow:0 8px 24px rgb(34 23 54 / 28%); }
    :host[data-dark] { --bg:#1F1930; --text:#F1ECF8; --muted:#A79EBB; --border:#2E2742; --accent:#FF6EB4; }
    .panel { position: fixed; display: flex; align-items: center; background: var(--bg);
             border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); }
    .banner { top: 16px; left: 50%; transform: translateX(-50%); height: 44px; max-width: min(92vw, 440px);
              padding: 0 6px 0 12px; gap: 10px; opacity: 0; transition: opacity .16s ease-out; }
    .banner.on { opacity: 1; }
    .sip { width: 24px; height: 24px; flex: none; }
    .title { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; }
    .hint { font-size: 12px; color: var(--muted); white-space: nowrap; }
    @media (max-width: 359px) { .hint { display: none; } }
    .x { pointer-events: auto; width: 44px; height: 44px; flex: none; margin: 0 -6px 0 -6px;
         padding: 13px; border: 0; background: none; border-radius: 10px; cursor: pointer; }
    .x svg { width: 100%; height: 100%; display: block; }
    .x svg path { fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; }
    .x:hover { background: rgb(212 38 124 / 12%); }
    .x:hover svg path { stroke: var(--accent); }
    .x:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .hl { position: fixed; pointer-events: none; border: 2px solid var(--potion);
          background: rgb(255 79 163 / 12%); border-radius: 4px;
          transition: top .08s linear, left .08s linear, width .08s linear, height .08s linear; }
    .pill { position: fixed; pointer-events: none; height: 18px; line-height: 18px; padding: 0 6px;
            border-radius: 4px; background: var(--plum); color: #FFFFFF;
            font-size: 11px; font-weight: 600; white-space: nowrap; max-width: 40vw; overflow: hidden;
            text-overflow: ellipsis; }
    .toast { bottom: 20px; left: 50%; transform: translateX(-50%); height: 44px; max-width: min(92vw, 460px);
             padding: 0 6px 0 14px; gap: 8px; opacity: 0; transition: opacity .16s ease-out; }
    .toast.on { opacity: 1; }
    .toast-text { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toast button { pointer-events: auto; height: 32px; padding: 0 10px; min-width: 44px; flex: none;
                    border: 0; background: none; border-radius: 8px; cursor: pointer;
                    font-size: 13px; font-weight: 600; color: var(--muted); }
    .toast button:hover { background: rgb(212 38 124 / 12%); }
    .toast button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .toast .undo { color: var(--accent); }
    .puff { position: fixed; pointer-events: none; overflow: visible; }
    .puff i { position: absolute; inset: 0; border-radius: 50%; display: block;
              background: radial-gradient(circle, var(--potion), transparent 70%); }
    .puff b { position: absolute; width: 6px; height: 6px; border-radius: 50%; background: var(--spark); }
    .poof { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            color: #FFFFFF; font-size: 20px; font-weight: 800; letter-spacing: .02em;
            text-shadow: 0 1px 0 var(--plum), 0 0 12px var(--potion); }
    @media (prefers-reduced-motion: reduce) { .banner, .toast, .hl { transition: none; } }
  </style>
  <div class="panel banner" tabindex="-1">
    <svg class="sip" viewBox="0 0 128 128" aria-hidden="true">
      <g transform="rotate(-7 64 72)" stroke="#2A1B4E" stroke-linejoin="round" stroke-linecap="round">
        <rect x="52" y="6" width="24" height="20" rx="5" fill="#D9985E" stroke-width="7"/>
        <path d="M50 24 H78 V40.5 A40 40 0 1 1 50 40.5 Z" fill="#F1EBFF" stroke-width="7"/>
        <path d="M29.5 66 A36.5 36.5 0 1 0 98.5 66 Q81 71 64 66 Q47 61 29.5 66 Z" fill="#FF4FA3" stroke="none"/>
        <rect x="44" y="20" width="40" height="12" rx="6" fill="#F1EBFF" stroke-width="7"/>
        <path d="M36 62 A32 32 0 0 1 53 48" fill="none" stroke="#FFFFFF" stroke-opacity=".85" stroke-width="5"/>
        <circle cx="50" cy="79" r="8" fill="#FFFFFF"/><circle cx="78" cy="79" r="8" fill="#FFFFFF"/>
        <circle cx="52" cy="78" r="4" fill="#2A1B4E"/><circle cx="80" cy="78" r="4" fill="#2A1B4E"/>
        <path d="M52 93 Q64 104 78 91" fill="none" stroke-width="5"/>
      </g>
    </svg>
    <span class="title">Pick the ad to zap</span>
    <span class="hint">Click it &middot; &uarr; grows &middot; Esc cancels</span>
    <button class="x" aria-label="Cancel zapping" title="Cancel">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
    </button>
  </div>
  <div class="hl" hidden></div><div class="pill" hidden></div>
  <div class="panel toast" role="status" hidden>
    <span class="toast-text"></span>
    <button class="undo" type="button">Undo</button>
    <button class="again" type="button">Zap another</button>
  </div>`;

  // the popup's language pick (header EN / 日本語), mirrored to storage as `lang`
  const ZT = {
    en: {
      title: 'Pick the ad to zap', hint: 'Click it &middot; &uarr; grows &middot; Esc cancels', cancel: 'Cancel', cancelAria: 'Cancel zapping',
      undo: 'Undo', again: 'Zap another', whole: "That's the whole page. Pick something smaller.",
      zapped: (h) => `Zapped! Hidden on ${h} from now on.`, visit: 'Zapped for this visit — it kept shape-shifting.',
      back: "Un-zapped. It's back.",
    },
    ja: {
      title: 'ザップする広告を選んでね', hint: 'クリック &middot; &uarr; で範囲を広げる &middot; Escでやめる', cancel: 'やめる', cancelAria: 'ザップをやめる',
      undo: '元に戻す', again: 'もう1つザップ', whole: 'それはページ全体です。もっと小さい部分を選んでね。',
      zapped: (h) => `ザップ！${h} ではこれからずっと非表示です。`, visit: 'この訪問中だけザップしました（形が変わり続けるため）。',
      back: 'ザップを取り消しました。元に戻りました。',
    },
  };
  let zt = ZT.en;
  const relabel = () => {
    $('.title').textContent = zt.title;
    $('.hint').innerHTML = zt.hint;
    $('.x').title = zt.cancel;
    $('.x').setAttribute('aria-label', zt.cancelAria);
    $('.undo').textContent = zt.undo;
    $('.again').textContent = zt.again;
  };

  // Settings → Theme can pin light/dark; "auto" (or unset) follows the browser
  let themePick = 'auto';
  const scheme = () => host.toggleAttribute('data-dark',
    themePick === 'dark' || (themePick !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches));
  try {
    chrome.storage.local.get({ theme: 'auto', lang: '' }).then(({ theme, lang }) => {
      themePick = theme;
      scheme();
      const pick = lang || ((navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en');
      if (ZT[pick] && pick !== 'en') { zt = ZT[pick]; relabel(); }
    }).catch(() => {});
  } catch { /* context gone */ }

  const $ = (sel) => root.querySelector(sel);
  const banner = $('.banner'), hint = $('.hint'), xBtn = $('.x');
  const hl = $('.hl'), pill = $('.pill');
  const toast = $('.toast'), toastText = $('.toast-text'), undoBtn = $('.undo'), againBtn = $('.again');

  // ---- state ----
  let picking = false;
  let candidate = null;
  let growStack = [];
  let px = -1, py = -1, raf = 0;
  let lastZap = null; // { host, sel, el } for Undo
  let toastTimer = 0, hintTimer = 0;

  const ac = new AbortController(); // teardown() unregisters every listener
  const SIG = { capture: true, signal: ac.signal };

  const crosshair = document.createElement('style'); // in the page, not the shadow
  crosshair.setAttribute('data-philterads-zap', '');
  crosshair.textContent = 'html, html * { cursor: crosshair !important; }';

  const docStyle = document.createElement('style'); // pageview copy of the zap
  docStyle.setAttribute('data-philterads-zap-css', '');

  function send(msg) { try { chrome.runtime.sendMessage(msg); } catch { /* context gone */ } }

  // ---- highlight ----

  function place(el) {
    if (!picking || !el || isPageEl(el)) { // never highlight the page itself
      hl.setAttribute('hidden', '');
      pill.setAttribute('hidden', '');
      return;
    }
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) { hl.setAttribute('hidden', ''); pill.setAttribute('hidden', ''); return; }
    hl.removeAttribute('hidden');
    Object.assign(hl.style, {
      top: `${r.top - 2}px`, left: `${r.left - 2}px`, width: `${r.width}px`, height: `${r.height}px`,
    });
    const cls = adapter.classes(el).find(isStableClass) || '';
    const label = `${adapter.tag(el)}${cls ? '.' + cls : ''}`;
    pill.textContent = label.length > 24 ? `${label.slice(0, 23)}…` : label;
    pill.removeAttribute('hidden');
    const inside = r.height >= 26 && r.width >= 40;
    pill.style.top = inside ? `${r.top + 4}px` : `${r.bottom + 4}px`;
    pill.style.left = `${Math.max(4, r.left + 4)}px`;
  }

  window.addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY;
    if (raf) return; // rAF-throttled
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!picking) return;
      growStack = []; // pointer takes over from keyboard again
      candidate = candidateAt(px, py);
      place(candidate);
    });
  }, { capture: true, passive: true, signal: ac.signal });

  function candidateAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!(el instanceof Element) || el === host) continue; // our UI hit-tests as the host
      return el; // may be html/body: the whole-page guard in zap() catches those
    }
    return null;
  }

  function wholePage(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height > 0.9 * innerWidth * innerHeight;
  }

  const remeasure = () => place(candidate);
  window.addEventListener('scroll', remeasure, { capture: true, passive: true, signal: ac.signal });
  window.addEventListener('resize', remeasure, { capture: true, passive: true, signal: ac.signal });

  // ---- banner ----

  function showBanner() {
    scheme();
    banner.classList.add('on');
    if (!RM) {
      banner.animate(
        [{ transform: 'translateX(-50%) translateY(-8px)' }, { transform: 'translateX(-50%) translateY(0)' }],
        { duration: 160, easing: 'ease-out' },
      );
    }
    banner.focus({ preventScroll: true }); // Esc works no matter what held focus
  }

  function flashHint(text) { // whole-page guard: explain, shake, carry on
    clearTimeout(hintTimer);
    hint.textContent = text;
    hintTimer = setTimeout(() => { hint.innerHTML = zt.hint; }, 2000);
    if (!RM) {
      banner.animate(
        [{ transform: 'translateX(-50%)' }, { transform: 'translateX(calc(-50% - 4px))' },
         { transform: 'translateX(calc(-50% + 4px))' }, { transform: 'translateX(-50%)' }],
        { duration: 200, easing: 'ease-in-out' },
      );
    }
  }

  // ---- zap ----

  function zapAt(x, y) {
    const el = candidateAt(x, y);
    if (el) zap(el);
  }

  function isPageEl(el) {
    const t = adapter.tag(el);
    return t === 'html' || t === 'body';
  }

  function zap(el) {
    if (!el || isPageEl(el) || wholePage(el)) {
      flashHint(zt.whole);
      return;
    }
    const sel = buildSelector(el, adapter);
    const pageHost = location.hostname;
    exitPicker();
    lastZap = { host: pageHost, sel, el };
    if (sel) {
      send({ type: 'zapped', host: pageHost, selector: sel });
      docStyle.textContent = `${sel}{display:none !important}`; // re-rendered copies vanish too
      document.documentElement.appendChild(docStyle);
      puff(el);
    }
    animateHide(el);
    showToast(sel
      ? zt.zapped(pageHost.replace(/^www\./, ''))
      : zt.visit);
  }

  function animateHide(el) {
    el.setAttribute('data-philterads-zapped', ''); // zap-apply.js undoes these inline styles on an undo
    if (RM) {
      el.style.setProperty('transition', 'opacity 120ms linear', 'important');
      el.style.setProperty('opacity', '0', 'important');
      setTimeout(() => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }, 130);
      return;
    }
    el.style.setProperty('transition', 'transform 320ms cubic-bezier(.4,0,.2,1), opacity 320ms, filter 320ms', 'important');
    el.style.setProperty('transform', 'scale(.85)', 'important');
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('filter', 'blur(2px)', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.style.setProperty('display', 'none', 'important');
    };
    el.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 400); // fallback if the transition never ends
  }

  function restore(el) {
    el.style.removeProperty('display');
    el.style.removeProperty('pointer-events');
    el.style.setProperty('transition', 'transform 200ms ease, opacity 200ms ease, filter 200ms ease', 'important');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.removeProperty('transform');
      el.style.removeProperty('opacity');
      el.style.removeProperty('filter');
    }));
    setTimeout(() => el.style.removeProperty('transition'), 280);
  }

  // ---- puff + POOF ----

  function puff(el) {
    if (RM) return;
    const r = el.getBoundingClientRect();
    const size = Math.min(160, Math.max(80, Math.min(r.width, r.height)));
    const layer = document.createElement('div');
    layer.className = 'puff';
    Object.assign(layer.style, {
      top: `${r.top + r.height / 2 - size / 2}px`,
      left: `${r.left + r.width / 2 - size / 2}px`,
      width: `${size}px`, height: `${size}px`,
    });
    const blobs = [[-20, -10], [20, -14], [0, 20]].map(([dx, dy]) => {
      const b = document.createElement('i');
      b.style.translate = `${dx}px ${dy}px`;
      layer.appendChild(b);
      return b;
    });
    for (let i = 0; i < 6; i += 1) {
      const d = document.createElement('b');
      const ang = (i * 60 * Math.PI) / 180;
      const dist = 40 + (i % 3) * 15;
      layer.appendChild(d);
      d.animate(
        [{ transform: 'translate(0,0) scale(1)', opacity: 1 },
         { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) scale(.6)`, opacity: 0 }],
        { duration: 420, easing: 'ease-out', fill: 'forwards' },
      );
    }
    const word = document.createElement('span');
    word.className = 'poof';
    word.textContent = 'POOF';
    layer.appendChild(word);
    root.appendChild(layer);
    blobs.forEach((b, i) => b.animate(
      [{ transform: 'scale(.4)', opacity: .9 }, { transform: 'scale(1.3)', opacity: 0 }],
      { duration: 420, easing: 'ease-out', delay: i * 40, fill: 'forwards' },
    ));
    word.animate(
      [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-16px)', opacity: 0 }],
      { duration: 420, easing: 'ease-out', delay: 60, fill: 'forwards' },
    );
    setTimeout(() => layer.remove(), 700);
  }

  // ---- toast ----

  function showToast(text, buttons = true) {
    toastText.textContent = text;
    undoBtn.hidden = !buttons;
    againBtn.hidden = !buttons;
    toast.removeAttribute('hidden');
    toast.classList.add('on');
    if (!RM) {
      toast.animate(
        [{ transform: 'translateX(-50%) translateY(8px)' }, { transform: 'translateX(-50%) translateY(0)' }],
        { duration: 160, easing: 'ease-out' },
      );
    }
    armToastTimer(6000);
  }

  function armToastTimer(ms) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(dismissToast, ms);
  }

  function dismissToast() {
    clearTimeout(toastTimer);
    if (toast.hasAttribute('hidden')) return;
    toast.classList.remove('on');
    if (RM) { toast.setAttribute('hidden', ''); return; }
    setTimeout(() => toast.setAttribute('hidden', ''), 180); // let the fade finish
  }

  toast.addEventListener('pointerenter', () => clearTimeout(toastTimer));
  toast.addEventListener('pointerleave', () => { if (!toast.hasAttribute('hidden')) armToastTimer(3000); });
  toast.addEventListener('focusin', () => clearTimeout(toastTimer));

  undoBtn.addEventListener('click', () => {
    if (!lastZap) return;
    const { host: h, sel, el } = lastZap;
    if (sel) {
      send({ type: 'unzap', host: h, selector: sel });
      docStyle.textContent = '';
    }
    restore(el);
    lastZap = null;
    toastText.textContent = zt.back;
    undoBtn.hidden = true;
    againBtn.hidden = true;
    armToastTimer(1500);
  });

  againBtn.addEventListener('click', () => { dismissToast(); arm(); });

  // ---- picker lifecycle ----

  function arm() {
    if (picking) return;
    picking = true;
    candidate = null;
    growStack = [];
    if (!crosshair.isConnected) document.documentElement.appendChild(crosshair);
    showBanner();
    if (px >= 0) { candidate = candidateAt(px, py); place(candidate); }
  }

  function exitPicker() {
    picking = false;
    banner.classList.remove('on');
    crosshair.remove();
    hl.setAttribute('hidden', '');
    pill.setAttribute('hidden', '');
  }

  function teardown() { // cancel paths: remove everything, no toast
    exitPicker();
    dismissToast();
    clearTimeout(hintTimer);
    if (raf) cancelAnimationFrame(raf);
    ac.abort();
    host.remove();
    delete window.__philterZap;
  }

  xBtn.addEventListener('click', teardown);

  // ---- event swallowing: an ad click must never navigate ----

  const inHost = (e) => e.composedPath().includes(host);

  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick']) {
    window.addEventListener(type, (e) => {
      if (!picking || inHost(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (type === 'pointerdown') zapAt(e.clientX, e.clientY);
    }, SIG);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (picking) teardown();
      else dismissToast();
      return;
    }
    if (!picking) return;
    const path = e.composedPath();
    const onOwnButton = path.some((n) => n.nodeType === 1 && n.tagName === 'BUTTON' && root.contains(n));
    if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key) && !onOwnButton) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'ArrowUp' && candidate?.parentElement && candidate.parentElement !== document.documentElement) {
        growStack.push(candidate); // growing may land on body: the guard handles it
        candidate = candidate.parentElement;
        place(candidate);
      } else if (e.key === 'ArrowDown' && growStack.length) {
        candidate = growStack.pop();
        place(candidate);
      } else if (e.key === 'Enter' && candidate) {
        zap(candidate);
      }
      return;
    }
    if (inHost(e)) return; // our own UI keeps normal keyboard behaviour
    e.preventDefault();
    e.stopImmediatePropagation();
  }, SIG);

  window.addEventListener('pagehide', teardown, { signal: ac.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) teardown(); }, { signal: ac.signal });

  document.documentElement.appendChild(host);
  window.__philterZap = { arm };
  arm();
})();
