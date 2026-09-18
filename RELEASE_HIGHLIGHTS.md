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

- **Pages load clean again.** A fresh install of 4.1.18 to 4.1.23 could pull a newer rspack than the one tested here, and every page with a linked stylesheet threw on load. The bundler is now pinned, with a real build spec guarding the shape.
- **`extension create --template transformers-js`** scaffolds the side panel reshaped after Hugging Face's own browser extension sample: type in the box and the classification prints as JSON, with page text, selection and model settings on top, for Chrome, Edge and Firefox from one manifest.
