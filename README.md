# PhilterAds

Free Chrome ad blocker (Manifest V3) from [philterads.com](https://philterads.com). Blocks ads and trackers on every site, blocks malware sites outright, closes pop-up ad tabs, and goes further than the big blockers on YouTube — without breaking how sites work. "Doesn't break functionality" always outranks "blocks one more ad".

Today it installs unpacked from this folder; store listings are next (see the roadmap).

## Roadmap

Also on the site: [philterads.com/#roadmap](https://philterads.com/#roadmap).

**Out now — v1.6**
- Ads, trackers, malware sites and pop-up ad tabs blocked; YouTube ads skipped
- **Zap**: pick any ad the lists missed and it stays hidden on that site; undo one, a whole site, or everything
- Stats for today and all time, plus a **Zapped** tab listing everything you zapped
- Light/dark theme and an English / 日本語 picker in the popup (the zap overlay follows it)
- One-click updates from GitHub for unpacked installs

**Up next**
- **AI control over MCP** — a small local `philterads-mcp` server so Claude, Cursor or any MCP app can run PhilterAds for you: *"This site is broken. Fix it."*, *"What got blocked here?"*, *"Turn on cookie-banner blocking."* Runs on 127.0.0.1 with a pairing code; no browsing history goes to the AI; every action shows in the popup with one-tap undo; turning off protection or the malware list still needs a click from you. Early access for $15+/month supporters. Design: [docs/MCP.md](docs/MCP.md)
- Chrome Web Store and Microsoft Edge listings (store build without the native updater)
- Welcome page on first install

**Later**
- **Live AI Filter** — a small on-device model spots brand-new ads and sponsored blocks the lists haven't caught yet, as the page loads, and turns what it finds into per-site hiding rules
- **Defender** — real-time warnings for phishing pages, fake download buttons, scam pop-ups and fake "virus found" alerts; also on-device, nothing you browse leaves the computer
- Firefox (desktop and Android), then Opera, then Safari — see [docs/BROWSERS.md](docs/BROWSERS.md)
- More languages after English and Japanese
- Supporters vote on what comes next

Ideas and broken sites: [contact@philterads.com](mailto:contact@philterads.com).

## What it blocks

- **Network requests** via Chrome's declarativeNetRequest, from six filter lists plus a small set of hand rules. Top-level navigation is **never** blocked outside the malware list, so clicking a link always works.
- **Pop-up / pop-under ad tabs**: the lists' `$popup` filters (`||scamhost^$popup`) can't be DNR rules, so their hosts travel in `rulesets/popups.json` and the background closes young tabs that have an opener and land on one — `domain=`-scoped filters only close when the opener site is on the filter's domain list, and never same-site tabs, paused sites, or sign-in/payment hosts. Chrome's own popup blocker only covers gesture-less `window.open`, which click-triggered scam tabs sidestep.
- **Element hiding** (cosmetic filtering): generic + per-site CSS from the lists, injected at `document_start`, minus the lists' own exceptions. Extended-css/scriptlet rules (`#?#`, `:+js()`, `:has-text()`, …) are deliberately skipped — see `rulesets/STATS.md` for the counts.
- **YouTube ads** three ways: the player data is pruned before the player reads it (`yt-main.js`), anything that still slips through is muted/seeked/skipped (`yt-content.js`), and the ad/tracking endpoints are blocked at the network layer. EasyList cosmetics are **not** applied on youtube.com — `yt-content.js` owns YouTube.
- **Google Publisher Tag** (`gpt.js`) is swapped for a no-op stub so pages that wait on it still render.

Filter lists (rebuilt by `tools/build-rules.mjs`; details in `rulesets/STATS.md`):

| Ruleset | Source | On by default | License |
| --- | --- | --- | --- |
| `core` | hand rules (the original `rules.json`) | yes | — |
| `safety` | hand-written allow rules for sign-in/payment/captcha hosts | yes | — |
| `easylist` | [EasyList](https://easylist.to) | yes | GPLv3 / CC BY-SA — attribute the EasyList authors |
| `easyprivacy` | [EasyPrivacy](https://easylist.to) | yes | GPLv3 / CC BY-SA |
| `malware` | [urlhaus-filter](https://gitlab.com/malware-filter/urlhaus-filter) (domain-based *online* variant) | yes | CC0 / MIT |
| `cookies` | [Fanboy Cookie List](https://fanboy.co.nz) | **no** | CC BY 3.0 |
| `annoyances` | Fanboy's Annoyance List (full variant, includes social widgets & cookie banners) | **no** | CC BY 3.0 |

The build converts ABP syntax to DNR rules with eyeo's [`@eyeo/abp2dnr`](https://www.npmjs.com/package/@eyeo/abp2dnr) (GPLv3, dev-time only — nothing from it ships in the extension), then collapses `||domain^` rules into merged `requestDomains` chunks so everything fits far inside Chrome's static-rule limits (~14.4k rules enabled by default vs the 30k per-extension guarantee). The urlhaus URL-based list (~105k path filters on popular hosts) cannot fit in any static ruleset, so the domain-based online variant is used instead — same upstream data, as whole-site blocks.

### The safety guarantee

No rule may break logins or payments: the build drops any list rule that would block `accounts.google.com`, `docs/mail/drive.google.com`, `www.gstatic.com`, `apis.google.com`, `challenges.cloudflare.com`, `www.recaptcha.net`, `hcaptcha.com`, `js.stripe.com`, `checkout.stripe.com`, `www.paypal.com` or `www.google.com/recaptcha`, and `rulesets/safety.json` allows all of them at a priority above every list rule. `npm test` proves this against every generated ruleset.

## Install

1. `chrome://extensions` → **Developer mode** (top right) → **Load unpacked** → this folder.
2. Turn off AdBlock in the same profile so the two don't fight.

After editing anything: press the reload icon on the PhilterAds card, then reload the page.

## The popup

- **Master switch** — everything off (rulesets, scripts, cosmetics, badge) in one click.
- **Pause on this site** — stops all blocking for the current host (dynamic `allowAllRequests` + allow rules) and skips cosmetic/YouTube scripts there. Reversible from the same toggle.
- **Blocked on this page** — count from `declarativeNetRequest.getMatchedRules` (this is why the extension needs the `declarativeNetRequestFeedback` permission).
- **Zap a missed ad** — pick an element on the page; it is hidden on that site from then on (`zap.js` picker, `zap-apply.js` re-applies). **Undo** sits next to it.
- **Stats** — today, lifetime (including how often the YouTube fallback had to intervene) and **Zapped**, the list of every zapped element with per-item and per-site undo.
- **Filters** — turn EasyList/EasyPrivacy/etc. or the optional cookie-banner and annoyance lists on and off.
- **Settings** — updates, theme (auto/light/dark). The language picker (EN / 日本語) sits in the header next to the master switch.

The badge shows the per-tab blocked count (Chrome's own counter).

## Updating the lists

```
npm install
npm run build:rules        # downloads into .cache/, writes rulesets/ + cosmetic/
npm test                   # validates everything (schema, limits, safety domains)
```

Then reload the extension. The generated `rulesets/` and `cosmetic/` files are committed, so the extension always loads straight from the folder without running npm. `npm run build:rules -- --offline` reuses the cached lists.

## Updates

Two halves: a weekly GitHub Action refreshes the lists on `main`, and the popup's **Updates** section pulls those commits into this folder and reloads the extension — no terminal needed.

### One-time setup (Windows only)

```
npm run install-updater
```

This registers the native messaging helper Chrome needs (an extension cannot touch files on its own):

- writes `native/philterads-updater.cmd` — the launcher Chrome runs, with the absolute path to `node.exe` baked in (Chrome's environment may not have node on PATH),
- writes `native/com.aialchemist.philterads.json` — the host manifest (`type: stdio`, allowed only for this extension's id),
- creates **one** registry key under `HKCU\Software\Google\Chrome\NativeMessagingHosts\` pointing Chrome at that manifest. Nothing else in the registry, HKCU only, current user only.

The default extension id is the one Chrome gave this folder here; pass the real one if it differs: `npm run install-updater -- --id <id>` (find it on `chrome://extensions`, Developer mode → PhilterAds card → ID; the popup also prints it when the helper is missing). `--dry-run` writes the two files and prints the registry command instead of running it; undo with `npm run install-updater -- --uninstall`. Requires `git` on PATH.

### The popup button

**Check for updates** asks the helper where `origin/main` is (`git fetch`), then shows version + local short SHA. If commits are waiting: **Update now · N new** fast-forwards the folder (`git pull --ff-only`) and reloads the extension; reload open tabs afterwards to use the new version everywhere. A dot on the Updates section means the background's daily check (a `chrome.alarms` job, also run at browser startup) found something. Clear errors are shown for the helper not being installed, local changes, a diverged branch, or network failures.

What the helper can and cannot do (`native/philterads-updater.mjs`): it runs exactly `git fetch`, `git status`, `git rev-parse`, `git rev-list`, `git pull --ff-only` and `git diff --name-only` — never push, reset, checkout, clean, stash or npm — always against this folder (resolved from its own location, never from the message), refuses to update a dirty tree, a diverged branch or anything not on `main`, times out every git call (30 s), and answers one request per process. Each request is logged to `native/updater.log` (gitignored, truncated at 200 KB).

### The weekly refresh

`.github/workflows/refresh-lists.yml` runs every Monday 06:00 UTC (also runnable by hand: repo → **Actions** → *refresh-lists* → **Run workflow**): it rebuilds `rulesets/` + `cosmetic/` on ubuntu (Node 22, `npm ci`, no Playwright browsers), runs the full test suite, then `tools/check-shrink.mjs` — a guard that fails the run if any default-on list loses more than 30% of its rules or any list ends up empty, so a broken upstream download can never replace a good ruleset. Only if everything passes, `tools/commit-lists.mjs` commits the refreshed lists (bumping the manifest patch version) as `lists: refresh <date>` and pushes to `main` — which the popup's next check will offer. A stats-only timestamp change does not trigger a commit.

## Development

- `npm test` — node test runner: ruleset schema/ids/limits, main_frame policy, safety-domain proof, cosmetic shape, manifest↔files consistency.
- `npm run smoke` — Playwright (bundled Chromium, new headless, `--load-extension`): loads 12 real sites with and without the extension, checks titles, ≥70% visible text, YouTube playback with no ad showing, prints a table. Uses the Playwright install from `%LOCALAPPDATA%\ms-playwright`; no new browser downloads.
- `npm run make:icons` — regenerates the shield icons (pure Node, zlib PNG writer).

No bundler, no runtime dependencies, no remote code, no telemetry; the only network calls the extension ever makes are the page's own.

## Troubleshooting

- **A site misbehaves** → popup → *Pause on this site* → reload. If that fixes it, it's a list rule, not you.
- **YouTube ads come back** → check the "YouTube ads skipped" row in the popup's Stats tab. Rising counter: the fallback is carrying it and the data keys in `yt-main.js` need updating. Ads playing with a flat counter: the player class names in `yt-content.js` changed.
- **A login/captcha breaks anyway** → that's a bug against the safety guarantee; `npm test` should have caught it. Pause the site and fix `rulesets/safety.json`.
- **Cookie banners still show** → turn on the *Cookie banners* list in the popup (it's off by default because it's the most likely to hide something useful).

## Layout

```
manifest.json            MV3, permissions, static rulesets, cosmetic.js
background.js            settings -> rulesets/scripts/badge; pause rules; heartbeat self-heal; daily update check; pop-up ad-tab guard
popups.js                pop-up ad-tab close decision (shared by background.js + tests)
cosmetic.js              element hiding, all frames, document_start
yt-main.js / yt-content.js   YouTube pruning + skip fallback (registered dynamically)
popup.html / popup.js    UI (incl. the Updates section)
rulesets/                generated + hand rulesets, blocks.json, STATS.md
cosmetic/                generated per-list element-hiding data
native/                  one-click-update helper: philterads-updater.mjs (host), install.mjs (setup)
.github/workflows/       weekly list refresh (build -> test -> guard -> commit)
tools/                   build-rules.mjs, smoke.mjs, make-icons.mjs, check-shrink.mjs, commit-lists.mjs, lib/
tests/                   node:test suites
```

## Licence and credits

PhilterAds is free software under the [GNU GPL v3](LICENSE). The filter lists belong to their authors and keep their own licences: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The PhilterAds name, the Sip mascot and the logo are not covered by the GPL; forks need their own name and artwork.

Found a security problem? Please report it privately: [SECURITY.md](SECURITY.md).
