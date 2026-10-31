# AI control over MCP (design)

Status: planned, next on the [roadmap](../README.md#roadmap). Nothing here ships yet.

Let any MCP app (Claude, Cursor and others) run PhilterAds for you: *"This site is broken. Fix it."*, *"What got blocked here?"*, *"Turn on cookie-banner blocking."*

```
MCP client (Claude, Cursor…) ──stdio──▶ philterads-mcp (npx)
                                       │ WebSocket, 127.0.0.1 only, pairing code
                                       ▼
                         PhilterAds background → chrome.storage → re-apply
```

- **Package** `philterads-mcp` (Node, no dependencies beyond the MCP SDK): a stdio MCP server plus a WebSocket listener on 127.0.0.1 only.
- **Extension:** an "AI control" switch (off by default) shows a one-time pairing code. While it's on, the background connects to the local bridge; commands write the same storage keys the popup writes.
- **Tools:** `get_status`, `set_enabled`, `list_filters`, `set_filter`, `pause_site(host, minutes?)`, `unpause_site`, `list_paused`, `site_report(host)`, `fix_broken_site(host)` (turns off only the rule(s) that fired on that host, as a per-host allow).

## Guardrails

- Off until you switch it on and pair it.
- Local only: the bridge listens on 127.0.0.1 and never opens a network port.
- No browsing history goes to the AI. `site_report` covers only the host you ask about.
- Every action shows in an activity log in the popup, with one-tap undo.
- Turning off protection or the malware list always needs a click from you in the popup.
- Rate limited.

## Tests

A protocol round-trip, pairing rejection, each tool against a fake storage, and the rate limit.

## Later ideas

- **Live AI Filter:** an on-device model (for example Chrome's built-in AI, or a small bundled model) sorts page elements into ad, sponsored and content as the page loads, and writes per-site hiding rules to the same storage Zap uses. It must stay on-device to keep the "collects nothing" promise, and stays off on devices that can't run it.
- **Defender:** on-device detection of phishing pages, fake download buttons, scam pop-ups and fake virus alerts, with a warning page and a one-click "leave this page". It covers threats too new for the URLhaus malware list.
