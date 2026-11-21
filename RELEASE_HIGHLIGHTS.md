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

- **Reloads only when they are needed**, saving a file the build never read no longer reloads the extension, saving a page reloads only the tabs that show it, only the project manifest and its `_locales` force a full reload, and a rebuild waits while the browser is still launching or the previous reload is still landing. A dev restart that failed is retried on the next save of any project file, and quitting dev on macOS is prompt. [Docs](https://extension.js.org/docs/commands/dev)
- **A reload that did not land says so**, when a build compiles but the extension never confirms the reload, `--output json` and `events.ndjson` report a `warning` with `W_RELOAD_NOT_APPLIED`, and the reload messages in the browser console carry a code: `W_RELOAD_NOT_APPLIED`, `W_CONTENT_SCRIPT_NOT_INJECTED`, `W_CONTENT_SCRIPT_CLEANUP`, `W_CONTENT_SCRIPT_MOUNT` or `W_DEV_SERVER_SOCKET`. [Docs](https://extension.js.org/docs/contracts/error-codes)
- **Each browser is built for itself**, Firefox output targets `firefox >= 98` and Safari output targets `safari >= 15.4` when the project declares no floor, Safari drops `minimum_chrome_version`, and a browser prefix on a permission item such as `"gecko:tabs"` is kept for that browser and left out for the others with one `W_MANIFEST_COMPAT` warning. [Docs](https://extension.js.org/docs/features/browser-specific-fields)
- **Your Babel config and tsconfig are followed**, a project with a Babel config runs Babel before SWC, tsconfig `jsxImportSource` and `useDefineForClassFields` apply, `.vue` files inside `node_modules` compile, and `extension.config.js` is read with the mode and browser of the command, so `.env.<browser>` values reach it in dev.
- **A broken package.json stops with one clear error**, a `package.json` that is not valid JSON, has a byte order mark, is saved as UTF-16, cannot be opened or is a folder stops `build`, `dev`, `start` and `preview` with `E_PACKAGE_JSON_INVALID` and says what it found, and a config file that fails to load is named by its real file name. [Docs](https://extension.js.org/docs/contracts/error-codes)
- **A JSON run always ends with one frame**, a run interrupted by Ctrl+C or a termination signal writes one `stopped` frame with `E_INTERRUPTED`, a signal that arrives after the build already succeeded exits 0, and `ready.json` keeps what the launcher recorded across rebuilds and drops `cdpPort` and `rdpPort` once the browser exits. [Docs](https://extension.js.org/docs/contracts/ready-json)
- **Safer placeholders and pages**, `$EXTENSION_*` placeholders are filled in copied `.json` and `.html` files and escaped for the spot they land in, a page that declares another charset is converted to UTF-8 with a `W_HTML_NOT_UTF8` warning, a `web_accessible_resources` file that does not exist warns in dev too, and `build --zip` no longer packages the previous build after compile errors. [Docs](https://extension.js.org/docs/commands/build)
- **`extension create` picks a name npm accepts**, the folder keeps the name you typed, `package.json` gets a valid `name`, failures carry real error codes, and a pinned template is cached for the next run. `extension install edge` no longer hangs on an unanswered sudo prompt, an install that times out on Windows is ended even when `taskkill` fails, and the CLI starts under Yarn PnP on Node 22.
- **Upgrade notes**, a `package.json` with a byte order mark or saved as UTF-16 built before and now stops with `E_PACKAGE_JSON_INVALID`, so save it as UTF-8 without one. A leftover Babel config now runs in the build and needs `babel-loader` and `@babel/core` installed. `Pages/`, `Scripts/` and `Public/` must be lowercase, a script entry with an uppercase extension such as `.JS` is no longer an entry, and when two files claim one entry name the last one in sort order wins with a warning. The dev reload socket moved from `/ws` to `/ws/<instance id>`, so a proxy rule that matches the exact path `/ws` must allow the longer one. `$NAME$` tokens in `_locales` messages are left for the browser, and an unquoted placeholder that breaks an inline script stops the build with `E_INLINE_SCRIPT_SYNTAX`. A Svelte project whose `svelte` differs from the bundled compiler runs on the compiler's runtime and warns once. The update notice shows only when stderr is a terminal. TypeScript callers of `extensionDev` can no longer pass `mode`, `sourceMaps` or the zip fields, which dev never read. The `extension-develop/manifest` entry, deprecated in 4.2, is removed.
- **Codes and exit codes that changed**, a script that matches on these reads the new value: an unresolved CSS `url()` is `E_CSS_DEAD_REF` in place of `E_ASSET_MISSING`, a missing `new URL()` target in a script is `E_SCRIPT_DEP_MISSING` in place of `E_CSS_DEAD_REF`, a missing background file is `E_ENTRY_NOT_FOUND` in place of `E_BACKGROUND_REQUIRED`, and an install failure with no known cause is `E_INTERNAL` in place of `E_BROWSER_DOWNLOAD`. In `--output json` an unbuilt `preview` reports status `not-found` with `E_PREVIEW_NO_DIST`, a missing manifest reports `usage`, and usage frames no longer carry `error.name`. `build --zip` exits 1 with `E_ZIP_SKIPPED` when the archive step fails, a mistyped `--log-context` item exits 1, `extension --output json` with no command and `doctor` on a missing folder exit 1, and an orphaned `dev --parent-pid` run exits 1. A parser with a fixed list of event types must accept `warning` and `restart_failed`.
