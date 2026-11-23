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

- **Faster dev rebuilds**, the runtime trace scans only the scripts that changed and a compiled file is reused when nothing it read changed, which took those two steps from about 155 ms to under 30 ms per rebuild on a large project.
- **A pinned browser binary is never ignored**, `--gecko-binary` alone runs a Gecko browser, and a failed launch names the path and the flag, config key or variable that pinned it. [Docs](https://extension.js.org/docs/browsers/running-other-browsers)
- **A JSON file that fails to parse says where**, the error gives the line and column and never quotes the file's text. [Docs](https://extension.js.org/docs/contracts/error-codes)
- **A file that comes back rebuilds**, a script or import that a page or worker names is watched for while it is missing, so creating or restoring it rebuilds without a second save.
- **A Firefox session survives a browser self-update on Windows**, the session follows the restarted browser and reaches ready.

## Also

- A binary set in the config file is named by its key and file, for example `browser.chrome.chromiumBinary in extension.config.js`, in errors, the start card, `doctor` and `ready.json`.
- A version probe that times out on a binary pinned by a variable names the variable, and the `preview` and `start` card shows what pinned the binary.
- On Windows, a pinned browser binary's version is read in a fraction of a second where it could take 20 seconds or more per read, and `preview` refuses a `--gecko-binary` path that does not exist at once.
- On Windows, a pinned browser wrapper that never answers its version probe is fully stopped, child included, before the command reports the refusal.
- On Windows, a Firefox session survives a self-update restart when the profile path has accented or CJK characters.
- The manifest is read 4 times on a first build and once per rebuild, down from 51 and 14.
- `extension create` scaffolds the examples with every dependency pinned to an exact version.
- The line-and-column message covers `package.json`, the manifest, `_locales`, declarative net request rulesets, the managed schema, `ready.json` and the `create` template readers.

## Upgrade notes

- A binary flag beside a `--browser` of the other engine, such as `--browser firefox --chromium-binary <path>`, was ignored and is now refused with `E_INVALID_OPTION` and status `usage` before any work.
- A binary flag with no `--browser` picks its engine: `--gecko-binary` alone runs `gecko-based`, and `--chromium-binary` alone keeps `chromium`.
- Both binary flags with no `--browser` are refused the same way. To run both binaries, pass `--browser chromium-based,gecko-based`.
- A script that matched the runtime's JSON wording, such as `Unexpected token`, reads `unexpected character at line 1 column 1` in its place.
- `binaryPinnedBy` in `ready.json` can hold a config key and file, not only a flag or variable name.
