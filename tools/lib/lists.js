// Filter-list definitions shared by the build (tools/build-rules.mjs) and tests.
// `blockMainFrame`: only the malware list may block main_frame (top-level
// navigation); everywhere else navigation must keep working (task policy).

export const SAFETY_DOMAINS = [
  'accounts.google.com',
  'docs.google.com',
  'mail.google.com',
  'drive.google.com',
  'www.gstatic.com',
  'apis.google.com',
  'challenges.cloudflare.com',
  'www.recaptcha.net',
  'hcaptcha.com',
  'js.stripe.com',
  'checkout.stripe.com',
  'www.paypal.com',
  // Path-scoped (kept out of requestDomains; matched by urlFilter instead):
  // 'www.google.com/recaptcha/'
];
export const SAFETY_PATHS = ['||www.google.com/recaptcha'];

export const LISTS = [
  {
    id: 'easylist',
    url: 'https://easylist.to/easylist/easylist.txt',
    license: 'GPLv3 / CC BY-SA (EasyList authors)',
    defaultOn: true,
    blockMainFrame: false,
    cosmetic: true,
    description: 'The main ad list: ads everywhere (EasyList).',
  },
  {
    id: 'easyprivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    license: 'GPLv3 / CC BY-SA (EasyPrivacy authors)',
    defaultOn: true,
    blockMainFrame: false,
    cosmetic: true,
    description: 'Trackers and analytics (EasyPrivacy).',
  },
  {
    // urlhaus-filter "online" (lite) variant. The ABP/URL-based online list is
    // 105k path-specific filters on popular hosts (CDNs, docs.google.com, ...)
    // which cannot be expressed within Chrome's static-rule limits and mostly
    // targets exactly the shared hosts we must never break. The domain-based
    // online variant is the same upstream data collapsed to dedicated malware
    // domains (~560) + malicious IPs (~1.3k), and is what actually gives us
    // "block navigation to malware sites". Documented in rulesets/STATS.md.
    id: 'malware',
    url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt',
    license: 'CC0 / MIT (curbengh, urlhaus-filter)',
    defaultOn: true,
    blockMainFrame: true,
    cosmetic: false,
    description: 'Malware distribution sites (URLhaus online domains).',
    plainDomains: true, // host-style list: one domain per line, '#' comments
  },
  {
    id: 'cookies',
    url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
    license: 'CC BY 3.0 (Fanboy)',
    defaultOn: false,
    blockMainFrame: false,
    cosmetic: true,
    description: 'Cookie / consent banners (Fanboy Cookie List). Off by default.',
  },
  {
    // EasyList's "Fanboy's Annoyance List" (full variant, includes social
    // widgets and cookie-banner hiding). Off by default, so the overlap with
    // the separate cookies list only matters if you turn both on.
    id: 'annoyances',
    url: 'https://secure.fanboy.co.nz/fanboy-annoyance.txt',
    license: 'CC BY 3.0 (Fanboy)',
    defaultOn: false,
    blockMainFrame: false,
    cosmetic: true,
    description: 'Annoyances: newsletters, social widgets (Fanboy). Off by default.',
  },
];

// Rulesets that are hand-maintained in rulesets/ (not touched by the build,
// but validated by tests and counted into rulesets/blocks.json).
export const HAND_RULESETS = [
  { id: 'core', path: 'rulesets/core.json' },
  { id: 'safety', path: 'rulesets/safety.json' },
];

// Chrome caps we build against.
export const LIMITS = {
  regexPerRuleset: 1000, // hard Chrome limit per ruleset
  domainsPerRule: 500, // self-imposed merge chunk size
  enabledStaticTotal: 150000, // task policy: stay realistic vs shared pool
};
