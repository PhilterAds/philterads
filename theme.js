// Applies the Settings → Theme pick before first paint (loaded in <head>,
// so the popup never flashes the wrong theme). localStorage is the fast,
// synchronous copy; storage.local `theme` is the shared one zap.js reads.
// No value or "auto" = follow the browser (prefers-color-scheme).

(() => {
  let pick = 'auto';
  try { pick = localStorage.getItem('philter_theme') || 'auto'; } catch { /* storage blocked */ }
  if (pick === 'light' || pick === 'dark') document.documentElement.setAttribute('data-theme', pick);
})();
