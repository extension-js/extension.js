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

- **One sidebar or toolbar key builds for every browser.** Declare the Chrome side panel and Firefox gets a working sidebar, declare the Firefox sidebar and Chrome and Edge get the side panel, and the Firefox Manifest V2 recipe gets its toolbar button back. The build translates `side_panel`, `sidebar_action` and `action` to the key each browser reads and says so in one line.
- **Zip archives moved, so check your CI paths.** `extension build --zip` writes beside the browser folder as `dist/<name>-<version>-<browser>.zip` instead of inside `dist/<browser>/`. `--zip-filename=release` writes `dist/release-chrome.zip` and one `dist/release-source.zip`, so two browsers built with the same name never write over each other.
- **The dev server answers only the hosts it knows.** A request under another name, like a Docker service, a tunnel or a `.local` address, gets a 403 that names the fix: `extension dev --allowed-hosts web,.ngrok.app`, or `commands.dev.allowedHosts` in the config.
- **Dev says what it really loaded.** A changed `.env` restarts the session with the new value and an edited `extension.config.js` asks for a restart instead of printing success. A browser that never started or quit early marks `ready.json` as an error and `--wait` exits non-zero. `extension dev <github url>` builds only a folder it downloaded itself and leaves a same-named folder of yours untouched.
