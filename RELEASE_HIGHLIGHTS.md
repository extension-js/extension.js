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

- **Bun as a runtime**, `bunx --bun extension@latest dev` runs the CLI on Bun 1.2 or newer, judged on Bun's own version. Older Bun gets one clear line and the Node.js path. [Docs](https://extension.js.org/docs/languages-and-frameworks/bun)
- **Runtime loaded modules know their own URL**, a file reached through `chrome.runtime.getURL`, `importScripts` or a root-absolute `<script src>` now reads its own emitted path from `import.meta.url`, so wasm, model and worker glue that resolves siblings from it finds them. [Docs](https://extension.js.org/docs/features/environment-variables#import-meta-url)
- **No more manifests without a manifest_version**, since 4.1.19 `chrome:` and `edge:` apply to one browser each, so a manifest that scoped every `manifest_version` to a vendor could build for another target with none. That build is now refused with the fix named. Use a plain `manifest_version` or `chromium:manifest_version` for the whole family. [Docs](https://extension.js.org/docs/features/browser-specific-fields)
