<!--
  RELEASE HIGHLIGHTS — the curated, user-facing summary for the NEXT stable release.

  Add 1–3 bullets describing what users can now DO. Lead with the capability, not
  the implementation ("`extension publish` — share a live build via a URL", not
  "Add publish command relay over the control websocket"). Link to docs where it
  helps. Keep it to the things worth pinging @everyone about.

  These bullets appear at the TOP of the GitHub Release, the Discord announcement,
  the website changelog, and the tweet — above the auto-generated commit list.

  Leave the section empty to ship with only the auto-generated notes.
  This file is reset to this template automatically after each stable release.

  Example:
  ## Highlights

  - **`extension publish`** — share a live, installable build through a single URL. [Docs](https://extension.js.org/docs/publish)
  - **Safari (alpha)** — `extension dev --browser=safari` now scaffolds and launches a Safari build.
-->

## Highlights

- **`extension doctor`** — one command that walks a dev session's control-channel legs (ready contract, server process, ports, token, executor, browser) and names the first failing one with a fix. Agents get `--output json`.
- **Fork-browser fixes** — waterfox/librewolf now get Firefox-shaped `web_accessible_resources`, and brave/opera/vivaldi/yandex now get the MV2-deprecation warning Chromium targets already had.
- **Clearer control-channel errors** — "no executor connected" and eval "Forbidden" now say *why* (stale service worker mid-resync, browser still launching, missing/mismatched eval token) instead of a catch-all.
