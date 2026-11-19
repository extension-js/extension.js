[npm-version-image]: https://img.shields.io/npm/v/extension-develop.svg?color=0065e6
[npm-version-url]: https://www.npmjs.com/package/extension-develop
[npm-downloads-image]: https://img.shields.io/npm/dm/extension-develop.svg?color=0065e6
[npm-downloads-url]: https://www.npmjs.com/package/extension-develop
[powered-image]: https://img.shields.io/badge/Powered%20by-Extension.js-0065e6
[powered-url]: https://extension.js.org
[action-image]: https://github.com/extension-js/extension.js/actions/workflows/ci.yml/badge.svg?branch=main&color=0065e6
[action-url]: https://github.com/extension-js/extension.js/actions

[![Powered by Extension.js][powered-image]][powered-url]

# extension-develop [![Version][npm-version-image]][npm-version-url] [![Downloads][npm-downloads-image]][npm-downloads-url] [![workflow][action-image]][action-url]

Develop, build, preview, and package [Extension.js](https://extension.js.org) projects.

This package powers Extension.js during local development and production builds. It provides the commands and build plugins that compile your extension, run it in browsers, and produce distributable artifacts.

## Installation

```
pnpm add extension-develop
```

## Usage

```ts
import {
  extensionBuild,
  type BuildOptions,
  type BuildSummary
} from 'extension-develop'
import {
  extensionPreview,
  type PreviewLauncherFn,
  type PreviewOptions
} from 'extension-develop/preview'

// Production build of the project in the current folder, with a zip
const summary: BuildSummary = await extensionBuild(undefined, {
  browser: 'chrome',
  zip: true
} satisfies BuildOptions)

console.log(summary.errors_count)

// This package starts no browser. The caller passes the launcher, which
// receives the built folder and every unpacked extension to load.
const launcher: PreviewLauncherFn = async ({browser, extensionsToLoad}) => {
  console.log(`Start ${browser} with`, extensionsToLoad)
}

// Runs the build in dist/chrome with no dev server
await extensionPreview(
  undefined,
  {browser: 'chrome', mode: 'production'} satisfies PreviewOptions,
  launcher
)
```

The `extension-develop/manifest` entry is deprecated and is removed in the next minor.

## Features

- Live reload/HMR development server with per-instance browser runners
- Cross-browser support: Chrome, Edge, Firefox, Safari, Chromium-based, Gecko-based
- Rspack-based build with opinionated plugin stack
- Clean production output in `dist/<browser>`
- Zipping: distribution and/or source packages (respects `.gitignore`)
- Auto-install of missing build + optional dependencies on first run
- Type generation for TS projects via `extension-env.d.ts`
- User config via `extension.config.(js|mjs)` for commands, browser start, unified logger defaults, and the bundler config hooks (`config`, `configResolved`)
- Managed dependency guard to avoid conflicts

## Commands

| Name    | Summary                                                                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| dev     | - Starts a local development server with live reload/HMR<br/>- Auto-installs build + optional deps if missing<br/>- Generates TypeScript shim types (`extension-env.d.ts`) when applicable<br/>- Runs a target browser with an isolated/stable profile |
| build   | - Production build using the webpack/Rspack plugin stack<br/>- Cleans `dist/<browser>` before emitting<br/>- Optional packaging: distribution zip and/or source zip<br/>- Merges user config; excludes browser runners during compilation              |
| start   | - Runs a silent production build, then runs preview from `dist/<browser>`<br/>- Mirrors the runtime environment of shipped output                                                                                                                      |
| preview | - Runs the extension for manual testing without dev server<br/>- Uses `dist/<browser>` when present, otherwise uses the project directory<br/>- Preserves production settings; only browser runners are applied                                        |
| cleanup | - Removes orphaned browser instances and temporary profiles created during development                                                                                                                                                                 |

## Command options

Each table lists fields of the exported option types `DevOptions`, `BuildOptions`, `StartOptions` and `PreviewOptions`, under the commands whose type has them. Every field is optional except `browser` and, for `start`, `mode`.

`extensionDev` and `extensionPreview` start a browser only through a launcher the caller passes. This package exports no `extensionStart`. `StartOptions` types the `start` command the CLI runs as `extensionBuild` followed by `extensionPreview`.

### dev, build, start and preview

| Option           | Type / Values                                                                                                                                                                         | Description                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `browser`        | chrome, edge, firefox, safari, chromium, brave, opera, vivaldi, yandex, waterfox, librewolf, zen, floorp, chromium-based, gecko-based, firefox-based, webkit-based, chromium-emulator | Target browser                                                                                                                |
| `mode`           | development, production, none                                                                                                                                                         | Bundler mode. `dev` always runs `development`, `start` and `preview` take `production` only, `build` defaults to `production` |
| `chromiumBinary` | string                                                                                                                                                                                | Path of a Chromium-based executable to run                                                                                    |
| `geckoBinary`    | string                                                                                                                                                                                | Path of a Gecko-based executable to run                                                                                       |
| `firefoxBinary`  | string                                                                                                                                                                                | Same as `geckoBinary`, which wins when both are set                                                                           |
| `extensions`     | string[] or `{dir, paths}`                                                                                                                                                            | Companion extensions for this command, see "Companion extensions" below                                                       |

### dev, start and preview

| Option               | Type / Values                                                                                      | Description                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `noOpen`             | boolean                                                                                            | Start the browser without opening a tab for the extension                                                                              |
| `noBrowser`          | boolean                                                                                            | Start no browser at all                                                                                                                |
| `profile`            | string or false                                                                                    | Profile folder to use. `false` asks for the browser's own default profile. Defaults to a fresh managed profile                         |
| `persistProfile`     | boolean                                                                                            | Reuse one managed profile across runs, off by default                                                                                  |
| `keepProfileChanges` | boolean                                                                                            | Keep the managed profile and what the run changed in it                                                                                |
| `copyFromProfile`    | string                                                                                             | Seed the managed profile from a copy of this profile folder, on first creation                                                         |
| `startingUrl`        | string                                                                                             | Page to open when the browser starts                                                                                                   |
| `port`               | number or string                                                                                   | `dev`: the dev server port, 8080 by default. `start` and `preview`: handed to the launcher, which seeds the browser debug port from it |
| `host`               | string                                                                                             | Address to bind, 127.0.0.1 by default. `dev` binds the dev server, `start` and `preview` bind the control channel                      |
| `publicHost`         | string                                                                                             | `dev`: the address the browser dials when it differs from `host`. Accepted and unused by `start` and `preview`                         |
| `logLevel`           | off, error, warn, info, debug, trace, all                                                          | Lowest level of browser log printed in the terminal, `off` by default                                                                  |
| `logContexts`        | array of: background, content, page, popup, options, sidebar, devtools, newtab, history, bookmarks | Contexts whose logs print. Leave unset for all of them                                                                                 |
| `logFormat`          | pretty, json, ndjson                                                                               | Output format of the printed logs, `pretty` by default                                                                                 |
| `logTimestamps`      | boolean                                                                                            | Timestamps in `pretty` output, on by default                                                                                           |
| `logColor`           | boolean                                                                                            | Colors in `pretty` output, on by default                                                                                               |
| `logUrl`             | string                                                                                             | Print only logs whose URL holds this text or matches this `/regex/flags` literal                                                       |
| `logTab`             | number or string                                                                                   | Print only logs from this tab id                                                                                                       |
| `preferences`        | object                                                                                             | Browser preferences to set in the profile                                                                                              |
| `browserFlags`       | string[]                                                                                           | Extra flags for the browser command line                                                                                               |
| `excludeBrowserFlags` | string[]                                                                                           | Default flags to leave off the browser command line                                                                                    |

### dev and build

| Option            | Type / Values | Description                                                                                                                                                                   |
| ----------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `polyfill`        | boolean       | Bundle `webextension-polyfill` on a Chromium target, off by default                                                                                                           |
| `safariBinary`    | string        | Path of a Safari or WebKit-based app to run                                                                                                                                   |
| `appName`         | string        | Safari app name, the manifest name by default                                                                                                                                 |
| `bundleId`        | string        | Safari bundle identifier                                                                                                                                                      |
| `developmentTeam` | string        | Apple development team that signs the Safari app                                                                                                                              |
| `macOsOnly`       | boolean       | Generate the macOS-only Xcode project, on by default                                                                                                                          |
| `appIcon`         | string        | Square 1024 px PNG the Safari app icon set is made from, relative to the project                                                                                              |
| `forceRegenerate` | boolean       | Regenerate the Xcode project even when it is current                                                                                                                          |
| `safariPackager`  | function      | The callback that packages the Safari app. Without it no Safari app is produced                                                                                               |
| `zip`             | boolean       | `build`: package `dist/<browser>` as an archive. Accepted and unused by `dev`, which writes no archive                                                                        |
| `zipSource`       | boolean       | `build`: package the source files, respecting `.gitignore`. Unused by `dev`                                                                                                   |
| `zipFilename`     | string        | `build`: base name of the archives. Unused by `dev`                                                                                                                           |
| `zipDir`          | string        | `build`: folder for the archives, relative to the project or absolute. Unused by `dev`                                                                                        |
| `sourceMaps`      | boolean       | `build`: write a `.map` file beside each script and stylesheet of a production build, never zipped. Unused by `dev`, which always writes maps                                 |
| `exitOnError`     | boolean       | `dev`: exit the process with code 1 on a failed session, off by default for a library. Deprecated and ignored by `build`: a failed build rejects and the caller owns the exit |

### dev

| Option                | Type / Values      | Description                                                                                                              |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `allowedHosts`        | string or string[] | Extra host names the dev server answers. A leading dot allows every subdomain                                            |
| `hashContentScripts`  | boolean            | Put a content hash in each content script file name, on by default                                                       |
| `allowControl`        | boolean            | Open the control channel for the act verbs                                                                               |
| `allowEval`           | boolean            | Also allow the `eval` verb. Implies `allowControl`                                                                       |
| `hintFor`             | function           | The hint for a terminal `failed` or `usage` frame that carries none. Called with the code, returns a string or undefined |

A host that learns a session cannot go on calls `endSessionAsFailed(code, message, instanceId?)`, exported beside `extensionDev`. It ends the named session, or the newest one, with one `failed` frame and answers `false` when that session is not live or is already stopping. A host that did not pass `exitOnError` keeps running.

### build

| Option          | Type / Values | Description                                                                                                            |
| --------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `outDir`        | string        | Base folder of the output, relative to the project. The build writes `<outDir>/<browser>`, `dist/<browser>` by default |
| `silent`        | boolean       | Print nothing on stdout. A failure still prints                                                                        |
| `addonLint`     | boolean       | Run `addons-linter` over a production build for a Gecko target, on by default when it is installed                     |
| `minify`        | boolean       | Minify first-party code in a production build. On by default, off for `opera`                                          |
| `failOnWarning` | boolean       | Deprecated. Nothing reads it, a build never fails on a warning                                                         |

### start

| Option     | Type / Values | Description                                                         |
| ---------- | ------------- | ------------------------------------------------------------------- |
| `polyfill` | boolean       | Bundle `webextension-polyfill` on a Chromium target, off by default |

### preview

| Option         | Type / Values | Description                                                      |
| -------------- | ------------- | ---------------------------------------------------------------- |
| `outputPath`   | string        | Folder to run from, `dist/<browser>` by default                  |
| `allowControl` | boolean       | Open the control channel for the act verbs on the production run |
| `allowEval`    | boolean       | Also allow the `eval` verb. Implies `allowControl`               |
| `dryRun`       | boolean       | Handed to the launcher, which then starts no browser             |

## Project detection and inputs

- Path or remote: Commands accept a local path or a remote URL.
  - GitHub repo URL: downloaded via `go-git-it` into a subfolder named after the repository.
  - Other HTTP(S) URLs: treated as zip archives and extracted locally.
- Monorepos: The nearest `manifest.json` is resolved recursively; the nearest valid `package.json` is then located and validated.

### Root semantics (manifest vs package.json)

- `manifest.json` may live in any subdirectory of your project.
- The project root for build/dev is the directory containing the nearest valid `package.json` (i.e., webpack `context`).
- Special folders and root-relative paths are anchored at the package root:
  - `public/`, `pages/`, `scripts/`, and URLs starting with `/` resolve relative to the package root (e.g., `/logo.png` → `<packageRoot>/public/logo.png`).
- Web-only mode: if no `package.json` is found, the manifest directory is used as a fallback project root.

## User config

- Provide `extension.config.js` or `extension.config.mjs` in your project root.
- Supported sections:
  - config(config: Configuration): mutate the assembled Rspack config. Supports a function or a plain object. When an object is provided, it is deep‑merged on top of the assembled config.
  - commands.dev | .build | .start | .preview: per‑command options (browser, profile, binaries, flags, preferences, unified logger defaults, packaging). These defaults are applied for all respective commands.
- browser.chrome | .firefox | .edge | .safari | .chromium-based | .gecko-based | .webkit-based: start flags, excluded flags, preferences, binaries, profile reuse (persistProfile), and per-browser `extensions`.
  - extensions: load-only companion extensions (unpacked dirs) loaded alongside your extension in dev/preview/start.
    - Example: { dir: "./extensions" } loads every "./extensions/\*" folder that contains a manifest.json.
- Precedence when composing options (one contract for every command): stock defaults → browser._ → commands._ → CLI flags.
  - Scalars: an unset flag never clobbers config, and an explicit flag (including `false`) always wins.
    - Example: `commands.dev.polyfill: true` turns the polyfill on for the team, and `--no-polyfill` turns it back off for one run.
  - Lists (`browserFlags`, `excludeBrowserFlags`): concatenate across layers in order (browser, then command, then CLI) and dedupe.
  - Objects (`preferences`): deep-merge, later layers win on key conflict.
- Browser key aliases when resolving `browser.*` from `extension.config.*` (engine families adopt product blocks; named products do not adopt engine-based blocks):
  - When the runtime asks for `chromium-based`, it prefers `browser['chromium-based']` and then `browser.chromium`.
  - When the runtime asks for `gecko-based`, it prefers `browser['gecko-based']` and then `browser.firefox`.
  - When the runtime asks for `webkit-based` **or any webkit-flavored fork name** (e.g. `acme-webkit`), it prefers the exact `browser.<name>` block, then `browser['webkit-based']`, then `browser.safari`.
  - Named product `safari` only uses `browser.safari` (does not adopt `webkit-based`).
- When detected, a one‑time notice is printed to indicate config is active.

### Companion extensions (load-only)

Use this when you have other unpacked extensions you want loaded alongside your main extension during `dev`, `start`, and `preview`.

- **What it loads**: directories that contain a `manifest.json` at their root (unpacked extension roots).
- **How they’re loaded**: they’re appended into the browser runner’s `--load-extension` list (Chromium) / addon install list (Firefox) **before** your extension. Your extension is always loaded last for precedence.
- **Discovery**:
  - `extensions.dir`: scans one level deep (e.g. `./extensions/*/manifest.json`)
    - When `dir` points to `./extensions`, browser folders like `./extensions/chrome/*` and `./extensions/firefox/*` are also scanned.
  - `extensions.paths`: explicit directories (absolute or relative to the project root)
- **Overrides**: top-level `extensions` applies to all commands, but `commands.<cmd>.extensions` overrides it for that command.
- **Invalid entries**: ignored. With `--debug` we print a warning if `extensions` is configured but nothing resolves.
- **Store URLs**: entries pointing to Chrome Web Store, Edge Addons, or AMO are downloaded on-demand into `./extensions/<browser>/<id-or-slug>`.
- **Local paths**: only paths under `./extensions/` are accepted for companion extensions.
- **CLI**: use `--extensions <csv>` to provide a comma-separated list of paths or store URLs.

Example:

```js
// extension.config.mjs
export default {
  // Applies to dev/start/preview unless overridden per-command
  extensions: {
    dir: './extensions',
    paths: ['./vendor/some-unpacked-extension']
  },
  commands: {
    dev: {
      // Override only for dev
      extensions: ['./extensions/debug-helper']
    }
  }
}
```

### Environment variables in `extension.config.*`

- `extension.config.*` runs in a Node context during command startup.
  - Use `process.env.*` to read environment variables inside the config file.
  - `import.meta.env.*` is available in your extension code at bundle time (via the Env plugin), not in the Node config.
- Before the config runs, develop loads the env files that match the running mode and browser into `process.env`. Values layer key by key: every matching file is read, and for each key the strongest file that sets it wins. A value already set in the shell or CI wins over every file. Strongest first:
  1. `.env.<browser>.<mode>`, then `.env.<browser>`, for the browser and then for each name of its family (for example `.env.chrome.production`, `.env.chrome`, `.env.chromium`). These apply once the browser is known.
  2. `.env.<mode>.local`
  3. `.env.<mode>` (`development` for `dev`, `production` otherwise)
  4. `.env.local`
  5. `.env`
  6. `.env.defaults` (weakest, it only fills keys no other file sets)
- In a monorepo, a package with none of the files 1 to 5 reads them from the nearest workspace root instead (the directory containing `pnpm-workspace.yaml`), even when the package has its own `.env.defaults`. The root's `.env.defaults` is then the weakest layer, the package's `.env.defaults` comes above it, and the root's other env files come above both. A package with any of the files 1 to 5 reads only its own folder.
- Only variables you read explicitly in the config are used there; client-side injection still requires the `EXTENSION_PUBLIC_*` prefix.
- Example:

```js
// extension.config.js (Node-based)
export default {
  browser: {
    chrome: {
      startingUrl:
        process.env.EXTENSION_PUBLIC_START_URL || 'https://example.com'
    }
  },
  commands: {
    dev: {
      // Unified logger defaults for `extension dev`
      logLevel: 'off',
      // omit or set to undefined to include all
      logContexts: ['background', 'content'],
      logFormat: 'pretty',
      logTimestamps: true,
      logColor: true,
      // Optional filters
      logUrl: '/example\\.com/i',
      logTab: 123
    }
  },
  // Either a function
  config: (config) => config
  // Or a plain object to merge
  // config: { resolve: { alias: { react: 'preact/compat' } } }
}
```

## Safety and ergonomics

- Managed dependency guard: If your `extension.config.*` references dependencies that are managed by Extension.js itself, the command aborts with a detailed message to prevent version conflicts.
- Auto‑install: If `node_modules` is missing, the appropriate package manager is detected and dependencies are installed before running.
- Type generation: For TypeScript projects, `extension-env.d.ts` is generated/updated to include required types and polyfills.

## Packaging outputs

- Distribution artifacts live under `dist/<browser>/` and source artifacts under `dist/`.
- File names default to a sanitized form of `manifest.name` plus `manifest.version` (override with `zipFilename`).
- `zipDir` moves both archives to another folder. A relative path has to stay inside the project, an absolute path is taken as written, and a folder inside `dist/<browser>` is refused.
- Source packaging respects `.gitignore`.

Example layout when both `zip` and `zipSource` are enabled:

```
dist/
  chrome/
    <name>-<version>.zip
  <name>-<version>-source.zip
```

## Notes and compatibility

- Built on the Rspack stack; user config is loaded when an `extension.config.*` is present.
- Only `EXTENSION_PUBLIC_*` variables are injected into client code; avoid secrets in templated `.json`/`.html`.

- A `dev` session started within the watcher's accuracy margin of the last source write (up to 2 s, usually 10 to 100 ms, for example `create` followed at once by `dev`) compiles twice at startup. The second compile is the watcher reporting files written just before it attached, not a change in the project, and the session is unaffected.

## Plugins

| Name                 | Group | Summary                                                                                                                                                                                                         |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plugin-web-extension | core  | - Core builder: emits pages and scripts<br/>- Validates and rewrites `manifest.json`<br/>- Ships icons, JSON, locales, and web resources<br/>- Ensures dev parity between local and shipped output              |
| plugin-css           | core  | - Auto‑wires CSS for HTML and content scripts<br/>- Optional SASS/LESS/PostCSS when configs exist                                                                    |
| plugin-js-frameworks | core  | - Detects React/Preact/Vue/Svelte and TypeScript<br/>- Configures SWC parsing, loaders/plugins, and safe aliases<br/>- Sets `tsconfig` resolution<br/>- Defers heavy work to `beforeRun` in production          |
| plugin-static-assets | core  | - Emits images, fonts, and misc files to `assets/`<br/>- Inlines files up to 2 KB, emits larger ones<br/>- Content-hashed names in development and production<br/>- Steps aside for user asset rules<br/>- Appends `.wasm` to the resolve extensions |
| plugin-compatibility | core  | - Cross‑browser helpers<br/>- Normalizes browser‑specific manifest fields<br/>- Optional `webextension-polyfill` for Chromium (skipped for Firefox/Safari)                                                      |
| plugin-compilation   | core  | - Loads env and templating (`EXTENSION_PUBLIC_*`)<br/>- Optional `dist/<browser>` cleaning<br/>- Compact, de‑duplicated compilation summary                                                                     |
| plugin-special-folders | core | - Copies `public/` to the output root<br/>- Builds the pages in `pages/` and the scripts in `scripts/`<br/>- Resolves companion extensions from `extensions/`<br/>- Applies the `include` and `exclude` lists |
| plugin-wasm          | core  | - Enables async WebAssembly<br/>- Resolves `.wasm` imports<br/>- Aliases runtime wasm assets |
| plugin-perf-budgets  | core  | - Size budgets per extension surface<br/>- Replaces the bundler's single size threshold |
| plugin-reload        | dev   | - Reload and HMR strategy of `extension dev`<br/>- Injects the dev reload runtime<br/>- Classifies each change and dispatches the reload<br/>- Does nothing outside a dev session |
| plugin-playwright    | dev   | - Writes the session contract (`ready.json`, `events.ndjson`) under `dist/extension-js/<browser>`<br/>- Read by `--wait`, `logs` and automation |
| plugin-browsers      | dev   | - Launches the target browser with the built extension loaded<br/>- Passed in by the CLI, absent under `--no-browser` |

## Notes and compatibility

- Built against `@rspack/core`; Webpack 5 may work for some plugins but is not officially supported here.
- Only `EXTENSION_PUBLIC_*` variables are injected into client code; avoid embedding secrets in templated `.json`/`.html`.

## Related files in this folder

- `rspack-config.ts`: Assembles the plugin stack and shared configuration.
- `dev-server/`: Local development server wiring and reload orchestration.
- `types.ts`: Common types for the plugin stack.

## License

MIT (c) Cezar Augusto and the Extension.js authors.
