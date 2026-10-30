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

- **Development-only pages and scripts**, a `player.dev.html` in `pages/` or a `bench.dev.ts` in `scripts/` runs in `extension dev` and never reaches a production build, no HTML, no chunk, no manifest entry
- **Extra files in the build with `include`**, map output paths to files or folders in `extension.config.js`, model weights or an exported tree outside the project included, layered per browser and per command
- **A MAIN-world content script leaves nothing on the page**, production builds stop publishing the extension's base URL and the cleanup global to the host page, and the dev browser now passes bot checks and keeps sign-in pop-ups responsive
