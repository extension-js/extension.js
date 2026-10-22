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

- **Build beside a running dev session**, `extension build --out-dir <path>` writes `<path>/<browser>` and leaves `dist/<browser>` to the dev server, so a test suite or store packaging never stops the window you are working in
- **Embedded options pages open every time**, a Chromium `options_ui` page that paints empty until its data arrives used to leave Chrome's options dialog closed; builds now give it a first layout, so the dialog opens and grows with the content
- **Your `web_accessible_resources` scope wins**, a resource you already list for a few sites stays on those sites even when a `scripts/` file references it, instead of being widened to every origin
