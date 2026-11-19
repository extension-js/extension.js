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

- **A steadier dev loop**, a save that fixes a build error rebuilds the page, a content script file deleted and written back is rebuilt, a content script still waiting on the old build retires on reload, and dev on macOS no longer misses an edit. [Docs](https://extension.js.org/docs/commands/dev)
- **Private files never ship**, files such as `.env`, `.npmrc`, `.git` and `.DS_Store` are never copied into the build, even from `public/`, and a page or stylesheet that points at one gets a single warning with a code. [Docs](https://extension.js.org/docs/features/special-folders)
- **Build diagnostics you can match on**, named build warnings and errors carry a stable code, and `--output json` reports them without terminal layout or paths from your machine, so scripts and CI can rely on them. [Docs](https://extension.js.org/docs/commands/build)
- **Install several browsers at once**, `extension install chrome firefox` takes more than one browser name, and the update check asks the npm registry you configured, caches the answer for an hour and stays quiet in CI, under `--output json` or with `EXTENSION_NO_UPDATE_CHECK=1`. [Docs](https://extension.js.org/docs/commands/install)
- **Fail a build on a budget overrun**, set `perfBudgets.onExceed: 'error'` and a production build that goes over an asset size budget fails instead of only warning. [Docs](https://extension.js.org/docs/features/extension-configuration)
- **Upgrade notes**, the bundler moves to rspack 2.3.3 and Extension.js no longer ships `postcss-preset-env`. If your PostCSS config names `postcss-preset-env` without installing it, run `npm install -D postcss-preset-env`, or the build skips that plugin with a warning. A project with no package.json now writes `dist/` at the folder you name, not beside a manifest in `src/`, and a `perfBudgets` value that is not a positive number now stops the build with a clear error.
- **Warning codes start with W_**, every coded warning now reports a `W_` code in `--output json` details, in `warnings` and in `ready.json` `cdpFaultCode`, while errors and refusals keep their `E_` code. A script that matches a warning by code reads `W_` in place of `E_` for these 30 names: `MANAGED_DEP_CONFLICT`, `TYPES_EMIT`, `MODULE_NOT_FOUND`, `ENTRY_NOT_FOUND`, `ASSET_MISSING`, `SCRIPT_DEP_MISSING`, `CSS_PARSE`, `CSS_PREPROCESSOR_MISSING`, `CSS_DEAD_REF`, `POLYFILL_NOT_FOUND`, `LOCALES_LAYOUT`, `PROD_LOOPBACK_ORIGIN`, `NO_ENTRYPOINTS`, `REMOTE_RESOURCE_BLOCKED`, `PERF_BUDGET`, `ENV_NO_MATCH`, `LAUNCH_SKIPPED_COMPILE_ERRORS`, `UNINSTALL_NOOP`, `PORT_IN_USE`, `LOGS_STREAM_GAP`, `CDP_NOT_CONNECTED`, `CDP_TIMEOUT`, `CDP_OP_FAILED`, `BROWSER_CONNECTION_CLOSED`, `EXTENSION_ID_UNKNOWN`, `MANIFEST_INVALID`, `WAR_INVALID`, `RESERVED_FOLDER`, `INTERNAL`, `COMPANION_EXTENSION_PATH`.
