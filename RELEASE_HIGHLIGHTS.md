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

- **Faster dev rebuilds**, two steps that ran on every rebuild went from about 155 ms to under 30 ms on a large project.
- **A pinned browser binary is never ignored**, `--gecko-binary` alone runs a Gecko browser, and a failed launch names the binary and what pinned it. [Docs](https://extension.js.org/docs/browsers/running-other-browsers)
- **JSON errors say where**, a file that fails to parse is reported by line and column, never by quoting its text. [Docs](https://extension.js.org/docs/contracts/error-codes)
- **A missing file that comes back rebuilds**, creating or restoring a file a page or worker names rebuilds without a second save.
- **Windows sessions stop and recover cleanly**, Ctrl+C closes the browser at once, and a Firefox session follows the browser through a self-update.

## Also

- A binary set in the config file is named by its key and file, for example `browser.chrome.chromiumBinary in extension.config.js`.
- On Windows, a pinned binary's version is read in a fraction of a second, where each read could take 20 s or more.
- On Windows, a pinned binary that never answers its version probe is stopped with its child processes, and a Firefox profile path with accented or CJK characters works.
- Stopping `preview`, `start` or `dev` while the browser is still starting ends as stopped with exit 0, and `ready.json` says `stopped`.
- `extension create` scaffolds the examples with exact dependency versions, and on Windows waits for a timed-out install to end before it removes the folder.
- The manifest is read 4 times on a first build and once per rebuild, down from 51 and 14.

## Upgrade notes

- A binary flag for the engine you did not pick, such as `--browser firefox --chromium-binary <path>`, was ignored and is now refused with `E_INVALID_OPTION`.
- With no `--browser`, a binary flag picks its engine (`--gecko-binary` alone runs `gecko-based`), and both flags together are refused. Pass `--browser chromium-based,gecko-based` to run both.
- A script that matched the runtime's JSON wording, such as `Unexpected token`, now reads `unexpected character at line 1 column 1`.
- `binaryPinnedBy` in `ready.json` can hold a config key and file, not only a flag or variable name.
