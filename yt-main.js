// Runs in YouTube's own page context at document_start. Removes ad slots from the
// player data before the player reads it, so most ads are never scheduled.
(() => {
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];

  const prune = (o) => {
    if (!o || typeof o !== 'object') return o;
    for (const k of AD_KEYS) if (k in o) delete o[k];
    if (o.playerResponse) prune(o.playerResponse);
    if (Array.isArray(o)) for (const item of o) if (item && item.playerResponse) prune(item.playerResponse);
    return o;
  };

  // Inline page data: var ytInitialPlayerResponse = {...}
  let initial;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => initial,
      set: (v) => { initial = prune(v); },
    });
  } catch {}

  // Data fetched as you click between videos.
  const PLAYER_API = /\/youtubei\/v1\/(player|next|reel)/;
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    const p = origJson.apply(this, arguments);
    return PLAYER_API.test(this.url || '') ? p.then(prune) : p;
  };

  const origParse = JSON.parse;
  JSON.parse = function () {
    const r = origParse.apply(this, arguments);
    return r && typeof r === 'object' && (r.playerResponse || r.adPlacements || r.playerAds) ? prune(r) : r;
  };
})();
