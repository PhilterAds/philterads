# PhilterAds: every browser we can reach

Written 2026-10-30. Goal: put PhilterAds in as many browsers as possible without ever breaking the one rule (never break a site) and without a second codebase.

## The idea in one line

One source tree, one build script that writes a package per store (`dist/chrome.zip`, `dist/edge.zip`, `dist/firefox.zip`, ...). Store differences live in a small per-target manifest patch, never in forked code.

## Wave map

| Wave | Browser / store | Users reached | Code work | Account / cost | Review time (typical) |
| --- | --- | --- | --- | --- | --- |
| **1 (launch)** | **Chrome Web Store** | Chrome, plus **Brave, Vivaldi, Arc, Yandex, Opera (via its Chrome-store bridge)** which install from it directly | Store build variant (no native updater, store auto-updates) | $5 one-time developer fee | days |
| **1 (launch)** | **Microsoft Edge Add-ons** | Edge on Windows and Mac | None beyond the store build: same zip | Free (Microsoft Partner Center) | up to ~7 days |
| **2** | **Firefox Add-ons (AMO)**, desktop | Firefox desktop | Port spike + Firefox manifest patch (below) | Free | hours to days (automated + human) |
| **2** | **Firefox for Android** | Firefox on Android phones: our first mobile reach | Same Firefox build, mark Android compatible, test the popup at phone size | Free (same AMO listing) | same as above |
| **3** | **Opera add-ons** | Opera, Opera GX users who avoid the Chrome store | Same zip as Chrome | Free | can be weeks |
| **3** | **Naver Whale store** | Whale (Korea) | Same zip as Chrome | Free | unknown, check at the time |
| **4** | **Safari** (macOS, then iOS/iPadOS) | Safari on Mac, iPhone, iPad | Xcode wrapper app via Apple's web-extension converter; Safari's declarativeNetRequest support and limits must be tested; YouTube scripts may need changes | Apple Developer Program, $99/year, and a Mac with Xcode | days, App Review rules apply |
| **4** | **Orion** (Kagi; Mac and iOS) | Orion users | Nothing: Orion installs Chrome and Firefox store extensions | Free | n/a |

Wave 1 is part of launch. Each later wave starts only after the previous one has been live for a week with no breakage reports.

## Wave 1: Chrome + Edge (launch)

1. **Store build variant** (`npm run build:store`): drops `nativeMessaging` and the updater UI (Settings shows the version only; stores update extensions themselves), drops the update reminder, keeps everything else identical. Tests run against both variants.
2. Chrome listing: text, 5 screenshots (1280×800), small promo tile (440×280), privacy answers ("collects nothing"), single-purpose statement, permission justifications (`<all_urls>` for cosmetic filtering and the pop-up guard).
3. Edge listing: same package and text; Edge also asks for a privacy policy URL (`philterads.com/privacy`).
4. Owner actions: pay the $5 Chrome fee; create the free Microsoft Partner Center account (Edge program). Lead prepares everything else.
5. Site: each store badge appears the moment its listing URL is set in `site/assets/js/config.js` (see "Badges" below).

## Wave 2: Firefox (desktop + Android)

Firefox runs Manifest V3 extensions and supports `declarativeNetRequest`, so this is a port, not a rewrite. A one-day spike settles the unknowns before any listing:

| Area | What to check | Likely fix |
| --- | --- | --- |
| Manifest | `background.service_worker` → Firefox uses `background.scripts` (event page); add `browser_specific_settings.gecko.id` and `strict_min_version` | Firefox manifest patch in the build |
| Rule limits | Static ruleset count and rule caps differ from Chrome; regex limits differ | Build checks per target; drop or split lists if over |
| Badge count | `setExtensionActionOptions({ displayActionCountAsBadgeText })` support | If missing, count from `getMatchedRules` or `onRuleMatchedDebug` alternatives, or hide the badge on Firefox |
| `getMatchedRules` | Availability and permission name in Firefox | Stats collector falls back gracefully |
| YouTube | `world: "MAIN"` content scripts (yt-main.js) | Supported in recent Firefox; verify the skip still works |
| Pop-up guard | `tabs.onCreated` `openerTabId` behaviour | Test the same e2e cases as Chrome |
| Android | Popup at phone width; no toolbar badge on mobile | Popup already responsive-safe at 340 wide; verify |

Done when: `npm test` green for the Firefox target, the 12-site smoke passes in Firefox desktop, the YouTube skip works, and a manual pass on Firefox Android shows the popup and blocking working.

## Wave 3: Opera, Whale

Same Chrome zip, separate listings. Low effort, slow reviews; submit and wait.

## Wave 4: Safari, Orion

Safari needs a Mac, Xcode and a $99/year Apple account, and its blocking engine has tighter limits, so it is the last and only goes ahead if Waves 1–3 show demand. Orion needs nothing from us; say "works in Orion" once tested.

## Not possible (today)

- **Chrome on Android and iPhone, Samsung Internet's main store, Edge mobile**: no general extension support for ad blockers like ours.
- **Brave on mobile**: no extensions; Brave's own shields do this job there.

## Badges (site and README)

Only official store artwork, unmodified, each one a clickable link to our live listing, never shown before the listing is live. Sources kept in `philterads-art/badges/src/` (outside the repo):

| Store | Official artwork | Rules that bind us |
| --- | --- | --- |
| Chrome Web Store | "Available in the Chrome Web Store" PNG, developer.chrome.com/docs/webstore/branding | Use as provided; link to the listing |
| Edge Add-ons | "Get it from Microsoft Edge" PNG in 41 languages (EN + JA used), learn.microsoft.com/microsoft-edge/extensions/publish/add-ons-badge | Unmodified, no tilt/shadow/animation, min 32 px tall, always a live link to our Edge listing, never decorative |
| Firefox Add-ons | "Get the add-on" SVG (Mozilla, 2020 artwork), extensionworkshop.com promoting page | Use as provided; link to the AMO listing |
| Opera | No official badge found (2026-10-30) | Text link only |
| Brave, Vivaldi, Arc, Orion | No store of their own | Text line "Also works in Brave, Vivaldi and Arc", no logos (their logos are trademarks with stricter rules) |

Site implementation: `config.js` gets `stores: { chrome: "", edge: "", firefox: "", opera: "" }`; a badge row renders only the stores with a URL, and the "Coming soon" pill shows until at least one is set. The tilted manga-panel style never applies to badges (Edge forbids tilt).

## Owner checklist

- [ ] $5 Chrome Web Store developer account (Wave 1)
- [ ] Free Microsoft Partner Center account, Edge program (Wave 1)
- [ ] Free Mozilla Add-ons account (Wave 2)
- [ ] Free Opera add-ons account (Wave 3)
- [ ] Apple Developer Program, $99/year, only if we go ahead with Safari (Wave 4)
