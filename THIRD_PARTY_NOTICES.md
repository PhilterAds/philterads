# Third-party notices

PhilterAds is licensed under the GNU General Public License v3.0 (see [LICENSE](LICENSE)). It ships rules built from the filter lists below. Thank you to everyone who maintains them.

## Filter lists (shipped in `rulesets/` and `cosmetic/`)

| List | Authors | Licence | Source |
| --- | --- | --- | --- |
| EasyList | The EasyList authors | GPLv3 or CC BY-SA 3.0 | https://easylist.to |
| EasyPrivacy | The EasyList authors | GPLv3 or CC BY-SA 3.0 | https://easylist.to |
| urlhaus-filter (domain-based online variant) | curbengh, from the URLhaus data by abuse.ch | CC0 (list) / MIT (scripts) | https://gitlab.com/malware-filter/urlhaus-filter |
| Fanboy's Cookie List (off by default) | Fanboy | CC BY 3.0 | https://fanboy.co.nz |
| Fanboy's Annoyance List (off by default) | Fanboy | CC BY 3.0 | https://fanboy.co.nz |

The lists are converted to Chrome's declarativeNetRequest format and element-hiding data by `tools/build-rules.mjs`. The conversion changes their format, not their content. Each weekly refresh rebuilds them from the upstream sources above.

## Website (`site/`, not part of the extension)

| Component | Licence |
| --- | --- |
| Nunito font (ExtraBold, Latin subset) | SIL Open Font License 1.1, see `site/assets/fonts/OFL.txt` |

## Development tools (not shipped in the extension)

| Package | Licence |
| --- | --- |
| [@eyeo/abp2dnr](https://www.npmjs.com/package/@eyeo/abp2dnr) | GPLv3 |
| [Playwright](https://playwright.dev) | Apache 2.0 |

## Name and artwork

The PhilterAds name, the Sip mascot and the logo are the project's brand. The GPL covers the code and lets you fork it, but a fork must use its own name and artwork so nobody mistakes it for PhilterAds.
