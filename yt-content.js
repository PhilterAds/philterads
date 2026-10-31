// Fallback for any ad that still reaches the player: mute it, jump to its end,
// press Skip, and restore your volume and speed afterwards. Also hides ad tiles.
(() => {
  const css = `
    ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer,
    ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer,
    ytd-companion-slot-renderer, ytd-action-companion-ad-renderer, ytd-player-legacy-desktop-watch-ads-renderer,
    ytd-statement-banner-renderer, ytd-search-pyv-renderer, ytd-merch-shelf-renderer,
    ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer),
    ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
    #masthead-ad, #player-ads, #panels > ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    .ytp-ad-overlay-container, .ytp-ad-image-overlay, .ytp-featured-product,
    ytm-promoted-sparkles-web-renderer, ad-slot-renderer { display: none !important; }`;
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button';
  let saved = null; // the user's own settings while an ad plays

  const tick = () => {
    const player = document.querySelector('#movie_player, .html5-video-player');
    const video = player && player.querySelector('video');
    if (!video) return;

    if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) {
      if (!saved) {
        saved = { muted: video.muted, rate: video.playbackRate };
        try { chrome.runtime.sendMessage({ type: 'ad-skipped' }); } catch {}
      }
      video.muted = true;
      if (isFinite(video.duration) && video.duration > 0) video.currentTime = Math.max(video.duration - 0.1, 0);
      else video.playbackRate = 16;
      document.querySelectorAll(SKIP).forEach((b) => b.click());
    } else if (saved) {
      video.muted = saved.muted;
      video.playbackRate = saved.rate;
      saved = null;
    }
  };

  new MutationObserver(tick).observe(document.documentElement, {
    subtree: true, attributes: true, attributeFilter: ['class'], childList: true,
  });
  setInterval(tick, 300);
})();
