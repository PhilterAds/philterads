# Security policy

## Reporting a vulnerability

Please report security problems privately, never in a public issue:

- GitHub: **Security → Report a vulnerability** on this repository (private vulnerability reporting), or
- email **contact@philterads.com** with "SECURITY" in the subject.

Tell us what you found, how to reproduce it, and which version you tested (Settings tab in the popup). We aim to reply within 3 days and to ship a fix for anything serious as fast as we can, then credit you in the release notes if you'd like.

## What counts

- Anything that lets a web page read or change PhilterAds settings, or turn protection off.
- A rule that blocks sign-in, payment or captcha pages (the safety guarantee).
- Anything that makes the extension send data anywhere. It must never make a network request of its own.
- Problems in the native update helper (`native/`) or the weekly list workflow.

## Supported versions

Only the latest release gets fixes.
