// No-op stand-in for Google Publisher Tag so pages that wait on googletag keep loading.
(() => {
  const noop = () => {};
  const self = function () { return this; };
  const slot = {
    addService: self, setTargeting: self, setCollapseEmptyDiv: self, defineSizeMapping: self,
    setClickUrl: self, clearTargeting: self, getSlotElementId: () => '', getAdUnitPath: () => '',
    getTargeting: () => [], getTargetingKeys: () => [], getResponseInformation: () => null,
  };
  const pubads = {
    addEventListener: self, removeEventListener: self, enableSingleRequest: self,
    collapseEmptyDivs: self, disableInitialLoad: self, enableLazyLoad: self, setTargeting: self,
    clearTargeting: self, setPrivacySettings: self, setRequestNonPersonalizedAds: self,
    refresh: noop, clear: noop, getSlots: () => [], getTargeting: () => [], getTargetingKeys: () => [],
    set: self, get: () => null, updateCorrelator: self, enableVideoAds: self, setCentering: self,
  };
  Object.setPrototypeOf(slot, null);
  for (const o of [slot, pubads]) for (const k of Object.keys(o)) if (o[k] === self) o[k] = () => o;
  const gt = window.googletag || {};
  const queued = Array.isArray(gt.cmd) ? gt.cmd : [];
  Object.assign(gt, {
    apiReady: true, pubadsReady: true,
    pubads: () => pubads, companionAds: () => pubads, content: () => pubads,
    defineSlot: () => slot, defineOutOfPageSlot: () => slot, destroySlots: noop,
    display: noop, enableServices: noop, disablePublisherConsole: noop, openConsole: noop,
    sizeMapping: () => { const b = { addSize: () => b, build: () => [] }; return b; },
    setAdIframeTitle: noop, getVersion: () => '', cmd: { push: (fn) => { try { fn(); } catch {} return 1; } },
  });
  window.googletag = gt;
  for (const fn of queued) { try { fn(); } catch {} }
})();
