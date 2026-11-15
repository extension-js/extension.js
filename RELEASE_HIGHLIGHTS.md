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

- **Firefox builds fit the store's script size limit**, a build for Firefox splits large files so addons.mozilla.org can parse every script, and names any file it cannot split. [Docs](https://extension.js.org/docs/commands/build#firefox-builds-split-large-files)
- **MAIN world scripts registered at runtime work in dev**, a file your background registers or injects into the MAIN world loads its chunks and resolves extension URLs on Chrome and Firefox. [Docs](https://extension.js.org/docs/implementation-guide/content-scripts#main-world-notes)
- **Content script styles apply and update in the open tab**, component styles, CSS modules and a Vue `<style>` block now reach the page, and a stylesheet edit lands without a reload.
- **The `browser` polyfill is off by default on Chromium**, Chromium 148 and later ship `browser` natively, so a build no longer bundles it. Pass `--polyfill` to keep it for older versions. [Docs](https://extension.js.org/docs/features/multi-platform-builds#polyfilling-browser-apis)
- **`icon_variants` builds for every browser**, light and dark icons are emitted and checked, and a browser that does not read the key yet, Safari included, gets `icons` filled from your variants. [Docs](https://extension.js.org/docs/implementation-guide/icons#icon-variants)
