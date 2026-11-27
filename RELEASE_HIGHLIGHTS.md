<!--
  RELEASE HIGHLIGHTS, the curated, user-facing summary for the NEXT stable release.

  ## Highlights: at most five bullets, ONE sentence each, describing what users
  can now DO. Lead with the capability, not the implementation
  ("`extension publish`, share a live build via a URL", not "Add publish command
  relay over the control websocket"). Link to docs where it helps. Keep it to the
  things worth pinging @everyone about.

  ## Also: everything else worth a line, one change per bullet. Printed folded.

  ## Upgrade notes: one bullet per thing a user must do or a script must read
  differently (renamed codes, new exit codes, removed entries). Printed folded.

  The highlights appear at the TOP of the GitHub Release, the Discord
  announcement, the website changelog, and the tweet. The two folded lists
  follow them in the GitHub Release and the changelog only, above the
  auto-generated commit list.

  Leave a section empty, or leave it out, to ship without it.
  This file is reset to this template automatically after each stable release.

  Example:
  ## Highlights

  - **`extension publish`**, share a live, installable build through a single URL. [Docs](https://extension.js.org/docs/publish)
  - **Safari (alpha)**, `extension dev --browser=safari` now scaffolds and launches a Safari build.

  ## Also

  - `build --zip` no longer packages the previous build after compile errors.

  ## Upgrade notes

  - The dev reload socket moved from `/ws` to `/ws/<instance id>`.
-->

## Highlights

## Also

- A first `build` in a folder with no `node_modules` no longer fails when `extension.config.js` resolves a declared package as the file loads, and the browser that config names is kept.
- `extension dev --browser=edge` no longer opens with Edge's "Installed theme, Undo" bar, since the Extension.js theme is left out on Edge.
- `extension install edge` on Linux runs without a terminal when `sudo` asks for no password, as on a CI runner or in a container.

## Upgrade notes
