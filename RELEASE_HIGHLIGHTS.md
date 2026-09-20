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

- **Zen and Floorp launch by name.** `extension dev --browser=zen` and `extension dev --browser=floorp` find a stock install on macOS, Windows and Linux, the same way Waterfox and LibreWolf already do.
- **Readable Opera builds and a `--minify` switch.** `extension build --browser=opera` ships unminified production code, which Opera Add-ons asks for in review, and `--minify` or `--no-minify` overrides the default on any target.
- **Dev server and build fixes.** A one-byte file is served with its byte instead of an empty body that broke the connection, a manifest page kept under `pages/` compiles once, files named under custom manifest keys ship, and the unpacked extension id matches Chrome when the project sits behind a symlink.
