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

- **Safari builds take your own app icon**, `extension build --browser=safari --app-icon=icon.png` uses the PNG as is instead of plating the manifest icon on a white tile. [Docs](https://extension.js.org/docs/browsers/safari#app-identity-and-packaging-options)
- **A production build warns when a public env variable is named like a secret**, so an `EXTENSION_PUBLIC_API_KEY` never ships in a bundle unnoticed. [Docs](https://extension.js.org/docs/features/environment-variables#secrets-never-take-the-extension_public_-prefix)
- **SQLite in DevTools**, `npx extension@latest create my-extension --template=devtools-typescript-sqlite` starts a DevTools panel backed by SQLite in the browser.
- **Firefox content scripts run once after a reload**, the dev session no longer injects a second copy, and a missing `scripting` permission is named instead of failing quietly.
- **The Edge store zip leaves the manifest `key` out, `dist/edge` keeps it**, so an unpacked Edge install keeps the pinned id your OAuth redirects depend on.
