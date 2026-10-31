// Re-applies the user's zapped selectors at document_start in every frame.
// Unlike cosmetic.js this runs on youtube.com too: the user picked these
// elements by hand, so they are trusted wherever they appear. Everything is
// wrapped in an IIFE with its own names — content scripts share one world
// per frame, and cosmetic.js already declares LISTS/hostChain at top level.

(() => {
  const host = location.hostname;
  if (!host) return;

  const labels = host.split('.');
  const chain = [host];
  for (let i = 1; labels.length - i >= 3; i += 1) chain.push(labels.slice(i).join('.'));
  if (labels.length >= 3) {
    const two = labels.slice(-2).join('.');
    if (!['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'mil', 'or', 'ne'].includes(two.split('.')[0])) {
      chain.push(two);
    }
  }

  let style = null;

  async function apply() {
    const { enabled = true, paused = [], zapped = {} } = await chrome.storage.local.get({
      enabled: true, paused: [], zapped: {},
    });
    // Corked / Paused = ads walk free, zapped ones too (same contract as
    // cosmetic.js, minus its YouTube exclusion).
    const off = !enabled || paused.some((p) => host === p || host.endsWith('.' + p));
    const sels = [];
    if (!off) for (const h of chain) for (const z of zapped[h] || []) sels.push(z.sel);
    if (!sels.length) {
      style?.remove();
      style = null;
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-philterads', 'zap');
    }
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    style.textContent = sels.map((s) => `${s}{display:none !important}`).join('\n');
  }

  // An undo (popup or Settings) brings zapped elements back without a
  // reload: drop zap.js's leftovers from this visit, then re-apply what is
  // still stored.
  function restoreVisit() {
    document.querySelectorAll('style[data-philterads-zap-css]').forEach((el) => el.remove());
    document.querySelectorAll('[data-philterads-zapped]').forEach((el) => {
      for (const p of ['display', 'opacity', 'transform', 'filter', 'transition', 'pointer-events']) el.style.removeProperty(p);
      el.removeAttribute('data-philterads-zapped');
    });
  }

  try {
    apply().catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(changes.zapped || changes.enabled || changes.paused)) return;
      if (changes.zapped) {
        const before = changes.zapped.oldValue || {};
        const after = changes.zapped.newValue || {};
        const n = (o) => chain.reduce((a, h) => a + (o[h]?.length || 0), 0);
        if (n(after) < n(before)) restoreVisit();
      }
      apply().catch(() => {});
    });
  } catch {
    /* a failure here must never take the page down */
  }
})();
