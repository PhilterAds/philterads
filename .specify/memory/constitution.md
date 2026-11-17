# PhilterAds Constitution

Distilled from CONTRIBUTING.md, SECURITY.md and README.md. Where they differ, those files win; update this one to match.

## Core Principles

### I. Never break a site (NON-NEGOTIABLE)
"Doesn't break functionality" always outranks "blocks one more ad". A change that hides one more ad but breaks a login, a checkout or a video player is rejected. No rule may block sign-in, payment or captcha hosts; `npm test` enforces this safety guarantee and it must stay green.

### II. Collects nothing
The extension makes no network request of its own: no analytics, telemetry or call home. Specs that need data from users must find another way or be dropped.

### III. Plain web platform, no remote code
Plain HTML, CSS and JavaScript only: no frameworks, no remote code, no new runtime dependencies. Manifest V3 and declarativeNetRequest rules; permissions stay minimal and each one must be justifiable in the store review form.

### IV. Small, tested changes
Every change keeps `npm test` passing and runs `npm run smoke` before a release. Pull requests stay small and focused and say why. Popup changes are checked in light and dark mode and fit the 340 × 392 window without page scrolling.

### V. Upstream lists first
Filter rules come from the credited upstream lists, rebuilt by `npm run build:rules` and committed. Fix rules upstream where possible; hand rules go only in `rulesets/core.json` (blocking) or `rulesets/safety.json` (allow rules that protect sites). The weekly refresh keeps its shrink guard.

## Releases and stores

- The version lives only in `manifest.json` (MAJOR.MINOR.PATCH). Pull requests never bump it; the weekly list refresh bumps PATCH, feature releases bump MINOR.
- Every version on `main` gets a protected `vX.Y.Z` tag and a GitHub Release. The store package contains runtime files only (no tools, tests, site, docs, native helper or spec-kit files).
- The publish-store workflow sends releases to the Chrome Web Store and Edge Add-ons; each store reviews every submission.

## Security

Vulnerabilities are reported privately (GitHub private reporting or contact@philterads.com). Anything that lets a page change PhilterAds settings, turns protection off, sends data anywhere, or weakens the native update helper or list workflow is a security issue.

## Governance

This constitution guides every spec, plan and task in this repo. Specs that conflict with a principle are revised before planning. Amendments go through a normal pull request and bump the version below.

**Version**: 1.0.0 | **Ratified**: 2026-11-17 | **Last Amended**: 2026-11-17
