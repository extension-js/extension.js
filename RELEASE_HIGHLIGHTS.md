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

- **"Ready" means the extension is running**, Chrome dev sessions print ready only once the extension connects, and name the stuck profile when it never does
- **A build never overwrites a live dev session**, `extension build` into the folder a running `extension dev` serves now stops before writing anything and points to `--out-dir`, so the browser you are working in keeps its files
- **Store warnings before you upload**, a production build flags `localhost` and other loopback origins left in the manifest, and an Edge build says when its embedded settings page will be clipped to 368px, with the one-line `edge:options_ui` fix
