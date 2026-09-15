# Architecture

This is the high-level design of Extension.js.
Wire formats are specified in the [contracts docs](https://extension.js.org/docs/contracts).

## Packages

The repository is a pnpm workspace built with Turborepo.
Four packages are published to npm.

| Program | Package | Role |
| --- | --- | --- |
| `programs/extension` | `extension` | The CLI. It parses commands, launches browsers and reports telemetry. |
| `programs/develop` | `extension-develop` | The build engine behind `dev`, `build` and `preview`, based on Rspack. |
| `programs/create` | `extension-create` | Scaffolds a project from the extension-js/examples catalog, a GitHub URL or a ZIP URL. It falls back to a bundled template when the default download fails. |
| `programs/install` | `extension-install` | Downloads and caches managed browser binaries. |

`extensions/` holds two built-in extensions, `extension-js-devtools` and `extension-js-theme`, that the CLI loads into development browsers.

## Build pipeline

`extension-develop` turns an extension project into a browser-ready folder under `dist/<browser>`.
The manifest is the entry point.
Plugins handle each concern: the web extension surface (manifest, HTML pages and scripts), CSS, static assets, WebAssembly, special folders, JavaScript frameworks, compatibility, reload, performance budgets and compilation (for example `--zip` output).
Browser-prefixed manifest keys such as `chrome:` and `firefox:` resolve for the requested target.
A production build for a Gecko-based browser also runs the addons.mozilla.org linter and prints its findings.

## Dev loop

`extension dev` runs the build in watch mode and starts a dev server.
The dev server binds to `127.0.0.1` by default.
The CLI launches the target browser with a dedicated profile and loads the unpacked extension.
On a change, the reload plugin classifies the edit and applies hot module replacement for pages, reinjection for content scripts, a service worker reload, or a full extension reload.

## Control bridge

The dev server hosts a WebSocket channel at `/extjs-control`.
Every client presents the session instance id when it connects.
Clients connect with one of three roles.
A producer is the runtime inside the extension. It sends logs and runs the reload, open, storage and eval commands.
A consumer reads logs, for example `extension logs --follow`.
A controller sends commands such as reload, open and storage, and needs `--allow-control`.
Eval also needs `--allow-eval` and a per-session token stored in a mode 0600 file.

## Session artifacts

Each session writes `ready.json` and `events.ndjson` under `dist/extension-js/<browser>/` in the project.
The control port and the eval token live under `.extension-js/`.
Tools and agents read these files to find the ports and the session state.

## Browser runners

`programs/extension/browsers` contains one runner per engine family: Chromium (Chrome, Edge, Chromium), Firefox and Safari.
Chromium is driven through the DevTools protocol.
Firefox is driven through its remote debugging protocol.
Safari builds go through Apple's converter and Xcode on macOS.

## Project creation

`extension create` downloads the requested template from `codeload.github.com/extension-js/examples` over HTTPS, clones a GitHub URL with git, or fetches a ZIP URL you pass.
If the default template cannot be downloaded, it copies the bundled JavaScript template.
Archive entries that resolve outside the target folder are refused.
It then writes `package.json`, a `.extension-create.json` provenance file and the manifest.
It installs dependencies only when you pass `--install`.

## Release

`.github/workflows/publish-release.yml` builds, tests and publishes the four packages with npm provenance.
`.github/workflows/release-attest.yml` attaches the tarballs and SLSA provenance to the GitHub release.
