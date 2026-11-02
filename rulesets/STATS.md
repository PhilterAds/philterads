# Ruleset build stats

Built 2026-11-02T17:53:31.262Z

| list | source version | filters read | DNR rules written | $popup hosts (global/scoped) | skipped by DNR converter | dropped: main_frame policy | dropped: safety domains | dropped: regex overflow | cosmetic generic/specific/exceptions | cosmetic skipped (extended) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| easylist | Version: 202611021741 | 77153 | 3902 | 2718/20 | 5193 | 0 | 9 | 0 | 13635/8889/243 | 504 |
| easyprivacy | Version: 202611021741 | 56459 | 9183 | 0/0 | 50 | 0 | 30 | 0 | 2/0/0 | 22 |
| malware | Updated: 2026-11-02T12:10:10Z | 1449 | 905 | 0/0 | 0 | 0 | 0 | 0 | 0/0/0 | 0 |
| cookies | Last modified: 2026-11-02 15:00 UTC | 25366 | 1789 | 0/0 | 1426 | 0 | 0 | 0 | 15272/6252/239 | 71 |
| annoyances | Version: 202611021500 | 54141 | 3195 | 0/0 | 3669 | 0 | 7 | 0 | 27306/15487/340 | 3197 |

Enabled-by-default static rules (core + safety + easylist + easyprivacy + malware): **14048**. Chrome guarantees 30k per extension plus a shared pool; this build's policy cap is 150000.

Notes:

- `rulesets/core.json` (hand rules, moved from the old root `rules.json`) and `rulesets/safety.json` (login/payment/captcha allow rules) are hand-maintained; the build only indexes them into `rulesets/blocks.json`.
- Outside the malware list, block rules never match `main_frame`: navigation is never blocked, so following a link always works. The malware list blocks whole malicious domains including top-level navigation (that is its job).
- `safety.json` allows accounts.google.com, docs/mail/drive.google.com, gstatic, apis.google.com, challenges.cloudflare.com, recaptcha, hcaptcha, stripe, paypal and www.google.com/recaptcha at a priority above every list rule, and the build drops any list rule that would block those hosts outright.
- `||domain^` rules are collapsed into merged `requestDomains` chunks of at most 500 domains, which is what keeps the rule count inside Chrome's limits.
- The malware list uses urlhaus-filter's domain-based *online* variant: the ABP/URL-based online list is ~105k path-specific filters on popular hosts (CDNs, docs.google.com, discord...) which no static DNR ruleset can hold; the domain variant carries the same upstream data as whole-domain blocks plus raw IPs.
- Element-hiding rules with extended-css / snippet syntax (`#?#`, `#$#`, `:-abp-`, `:has-text`, `+js()`, `:style()`, negated domain prefixes) are skipped and counted, not guessed at.
- `rulesets/popups.json` (list id -> `{ hosts, scoped }`, not a DNR ruleset) carries the `||host^$popup` filters, which declarativeNetRequest cannot express; background.js closes young tabs that have an opener and land on one of those hosts (never same-site tabs, paused sites or safety hosts). `domain=` -scoped filters keep their scope — the host only closes popups whose opener site is on its domain list, so link shorteners like t.co stay clickable everywhere except the sites the list caught abusing them. Filters with negated domains, pattern/regex `$popup` filters and the `third-party` qualifier (implied by the never-close-same-site rule) are not carried; safety-domain hosts and their parents are excluded like everywhere else.
- Regex rules are capped below 1000 per ruleset (Chrome hard limit); plain-literal regexes become urlFilters instead, which cost nothing against that budget.

To rebuild: `npm install && npm run build:rules` (downloads into `.cache/`; add `--offline` to reuse it).
