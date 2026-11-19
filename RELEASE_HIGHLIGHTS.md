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

- **A steadier dev loop**, a save that fixes a build error rebuilds the page, a content script file deleted and written back is rebuilt, a content script still waiting on the old build retires on reload, dev on macOS no longer misses an edit, two dev sessions in one process no longer share a host or port, an auto-exit session lets a slow stop finish and exits 0, and after a restart `--output json` writes `ready` again with `restarted: true`. [Docs](https://extension.js.org/docs/commands/dev)
- **Private files never ship**, files such as `.env`, `.npmrc`, `.git` and `.DS_Store` are never copied into the build, even from `public/`, the dev server answers them as missing, and a page or stylesheet that points at one gets a single warning with a code. [Docs](https://extension.js.org/docs/features/special-folders)
- **Build diagnostics you can match on**, named build warnings and errors carry a stable code, and `--output json` reports them without terminal layout or paths from your machine, so scripts and CI can rely on them. Each issue is said once, and with color off every warning and error line says `Warning:` or `Error:`. [Docs](https://extension.js.org/docs/commands/build)
- **The polyfill stays out of page code**, with `polyfill: true`, MAIN world content scripts, scripts the extension registers into the MAIN world at runtime and sandboxed pages no longer bundle `webextension-polyfill`, which threw "This script should only be loaded in a browser extension." there. Their `browser` is the page's own global, and extension code keeps the polyfill.
- **Failures that say so instead of hanging**, a browser that does not start within 3 minutes, or a first Safari package within 10, is reported with `E_BROWSER_START_TIMEOUT` while rebuilds keep running. A failed Safari package prints why, a browser log capture failure is a warning and the session still reports ready, a locked browser profile leads with the fix, a dev session ends when the process that started it is gone, and `extension create` ends a timed-out template clone or install along with everything it started. [Docs](https://extension.js.org/docs/commands/dev)
- **CSS you can link to**, outside a content script `import href from './panel.css?url'` gives the URL of the compiled sheet under `assets/`, a PostCSS config keeps its `parser`, `syntax`, `stringifier` and `map`, and a project rule that sets a stylesheet `type` gets a warning instead of being replaced without a word.
- **Install several browsers at once**, `extension install chrome firefox` takes more than one browser name, and the update check asks the npm registry you configured, caches the answer for an hour and stays quiet in CI, under `--output json` or with `EXTENSION_NO_UPDATE_CHECK=1`. [Docs](https://extension.js.org/docs/commands/install)
- **Fail a build on a budget overrun**, set `perfBudgets.onExceed: 'error'` and a production build that goes over an asset size budget fails instead of only warning. [Docs](https://extension.js.org/docs/features/extension-configuration)
- **Upgrade notes**, the bundler moves to rspack 2.3.3 and Extension.js no longer ships `postcss-preset-env`. If your PostCSS config names `postcss-preset-env` without installing it, run `npm install -D postcss-preset-env`, or the build skips that plugin with a warning. A project with no package.json now writes `dist/` at the folder you name, not beside a manifest in `src/`, and a `perfBudgets` value that is not a positive number now stops the build with a clear error. A dev stop that runs past its 10 second bound now ends on `failed` with `E_SHUTDOWN_TIMEOUT` in place of `E_INTERNAL` (the exit code stays 1), and a launch with no free debugging port from 9222 to 9271 stops with `E_PORT_UNAVAILABLE`. The generated `extension-env.d.ts` names `@types/chrome` only when your package.json lists it, so a project that relies on those types lists `@types/chrome` itself.
- **Warning codes start with W_**, every coded warning now reports a `W_` code in `--output json` details, in `warnings` and in `ready.json` `cdpFaultCode`, while errors and refusals keep their `E_` code. A script that matches a warning by code reads `W_` in place of `E_` for these 30 names: `MANAGED_DEP_CONFLICT`, `TYPES_EMIT`, `MODULE_NOT_FOUND`, `ENTRY_NOT_FOUND`, `ASSET_MISSING`, `SCRIPT_DEP_MISSING`, `CSS_PARSE`, `CSS_PREPROCESSOR_MISSING`, `CSS_DEAD_REF`, `POLYFILL_NOT_FOUND`, `LOCALES_LAYOUT`, `PROD_LOOPBACK_ORIGIN`, `NO_ENTRYPOINTS`, `REMOTE_RESOURCE_BLOCKED`, `PERF_BUDGET`, `ENV_NO_MATCH`, `LAUNCH_SKIPPED_COMPILE_ERRORS`, `UNINSTALL_NOOP`, `PORT_IN_USE`, `LOGS_STREAM_GAP`, `CDP_NOT_CONNECTED`, `CDP_TIMEOUT`, `CDP_OP_FAILED`, `BROWSER_CONNECTION_CLOSED`, `EXTENSION_ID_UNKNOWN`, `MANIFEST_INVALID`, `WAR_INVALID`, `RESERVED_FOLDER`, `INTERNAL`, `COMPANION_EXTENSION_PATH`.
