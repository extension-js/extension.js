<!--
  RELEASE HIGHLIGHTS, the curated, user-facing summary for the NEXT stable release.

  Add 1–3 bullets describing what users can now DO. Lead with the capability, not
  the implementation ("`extension publish`, share a live build via a URL", not
  "Add publish command relay over the control websocket"). Link to docs where it
  helps. Keep it to the things worth pinging @everyone about.

  These bullets appear at the TOP of the GitHub Release, the Discord announcement,
  the website changelog, and the tweet, above the auto-generated commit list.

  Leave the section empty to ship with only the auto-generated notes.
  This file is reset to this template automatically after each stable release.

  Example:
  ## Highlights

  - **`extension publish`**, share a live, installable build through a single URL. [Docs](https://extension.js.org/docs/publish)
  - **Safari (alpha)**, `extension dev --browser=safari` now scaffolds and launches a Safari build.
-->

## Highlights

- **Emulated Chromium needs no flag**, `extension dev --browser=chromium-emulator` opens the emulated browser on its own now that the engine is public, and names the engine origin when it cannot be reached instead of opening a dead page
- **The wasm budget reads the surface that fetches the file**, a `.wasm` reached only by pages and workers gets the 32 MiB budget while one a content script or the service worker reaches keeps 1 MiB and still warns, and `perfBudgets.ignore` excuses any asset by its output path or a glob
