# Contributing to PhilterAds

Thanks for wanting to brew with Sip. Bug reports, broken-site reports and pull requests are all welcome.

## The one rule

**Never break a site.** "Doesn't break functionality" always outranks "blocks one more ad". A change that hides one more ad but breaks a login, a checkout or a video player will not be merged.

## Report a broken site or a missed ad

Open an issue with:

- the page URL (or the site, if the URL is private),
- what you expected and what happened,
- whether pausing PhilterAds on that site (Home tab) fixes it,
- your Chrome version and the PhilterAds version (Settings tab).

## Run it locally

1. `npm install`
2. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder.
3. Change something, then click the reload arrow on the PhilterAds card.

## Before you open a pull request

- `npm test` passes. It includes the safety guarantee: no rule may block sign-in, payment or captcha hosts.
- If you changed the filter-list build, run `npm run build:rules` and commit the regenerated `rulesets/`.
- If you changed the popup, check it in light and dark mode. Every tab must fit the 340 × 392 window without scrolling the page.
- Plain HTML, CSS and JavaScript only: no frameworks, no remote code, and no new runtime dependencies.
- Keep pull requests small and focused, and say why in the description.

## Filter lists

The rules come from the upstream lists credited in the [README](README.md). Fix a list rule upstream where you can. Hand rules belong in `rulesets/core.json` (blocking) or `rulesets/safety.json` (allow rules that protect sites).

## Privacy

PhilterAds collects nothing. Pull requests that add analytics, telemetry or any network call home will be closed.
