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

- **Extension.js v4 — now on Node.js 22+.** Node 20 is no longer supported. There are no API changes: upgrade Node and your project keeps working.
- **Multi-file content scripts just work in dev.** Split a content script across plain files (a base class in one, the rest in another) — saves now hot-reload without a restart, and a thrown error traces back to your real file and line instead of an inlined blob.
- **Snappier Safari dev.** `extension dev --browser=safari` resyncs in the background instead of blocking on a full Xcode build every save, and a burst of saves collapses into a single rebuild.
- **No leaked browsers.** A dev session that exits on its own now reliably shuts the browser down — no more Chrome or Firefox processes lingering after you're finished.
