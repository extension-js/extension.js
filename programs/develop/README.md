[npm-version-image]: https://img.shields.io/npm/v/extension-develop.svg?color=0971fe
[npm-version-url]: https://www.npmjs.com/package/extension-develop
[npm-downloads-image]: https://img.shields.io/npm/dm/extension-develop.svg?color=0971fe
[npm-downloads-url]: https://www.npmjs.com/package/extension-develop
[powered-image]: https://img.shields.io/badge/Powered%20by-Extension.js-0971fe
[powered-url]: https://extension.js.org
[action-image]: https://github.com/extension-js/extension.js/actions/workflows/ci.yml/badge.svg?branch=main&color=0971fe
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
  extensionDev,
  extensionBuild,
  extensionStart,
  extensionPreview,
  type DevOptions,
  type BuildOptions,
  type StartOptions,
  type PreviewOptions
} from 'extension-develop'

async function run() {
  // Development server
  await extensionDev(undefined, {
    browser: 'chrome',
    open: true
  } satisfies DevOptions)

  // Production build + zip
  await extensionBuild(undefined, {
    browser: 'firefox',
    zip: true
  } satisfies BuildOptions)

  // Build then preview from dist/<browser>
  await extensionStart(undefined, {browser: 'edge'} satisfies StartOptions)

  // Preview using an existing output folder or project path
  await extensionPreview(undefined, {
    browser: 'chrome',
    mode: 'production'
  } satisfies PreviewOptions)
}

run()
```

## Features

- Live reload/HMR development server with per-instance browser runners
- Cross-browser support: Chrome, Edge, Firefox, Chromium-based, Gecko-based
- Rspack-based build with opinionated plugin stack
- Clean production output in `dist/<browser>`
- Zipping: distribution and/or source packages (respects `.gitignore`)
- Auto-install of missing build + optional dependencies on first run
- Type generation for TS projects via `extension-env.d.ts`
- User config via `extension.config.(js|mjs)` for commands, browser start, unified logger defaults, and webpack config hooks
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

Options accepted by each command. Values shown are typical types or enumerations; see the tables for specifics.

### Common (browser/runtime)

| Option         | Type / Values                                      | Description                                                     |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| browser        | chrome, edge, firefox, chromium-based, gecko-based | Target browser/runtime                                          |
| profile        | string or false                                    | Profile path or disable profile persistence                     |
| startingUrl    | string                                             | Initial URL to open                                             |
| open           | boolean                                            | Focus/open the browser window (CLI: use `--no-open` to disable) |
| --no-runner    | boolean                                            | Skip launching the browser runner                               |
| chromiumBinary | string                                             | Custom Chromium-based executable path                           |
| geckoBinary    | string                                             | Custom Gecko-based executable path                              |

### dev

| Option        | Type / Values                       | Description                                                                       |
| ------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| mode          | development, production, none       | Build mode                                                                        |
| polyfill      | boolean                             | Include `webextension-polyfill` when possible                                     |
| port          | number or string                    | Dev server port                                                                   |
| source        | string                              | Inspect a source directory                                                        |
| watchSource   | boolean                             | Watch the source directory                                                        |
| logs          | off,error,warn,info,debug,trace,all | Unified logger verbosity (all shows everything)                                   |
| logContext    | list or `all`                       | Comma-separated contexts (background,content,page,sidebar,popup,options,devtools) |
| logFormat     | pretty,json                         | Pretty text or JSON output                                                        |
| logTimestamps | boolean                             | Include timestamps in pretty output                                               |
| logColor      | boolean                             | Colorize pretty output                                                            |
| logUrl        | string or /regex/flags              | Filter by URL substring or JS-style regex literal                                 |
| logTab        | number                              | Filter by tabId                                                                   |

### build

| Option      | Type / Values | Description                                                    |
| ----------- | ------------- | -------------------------------------------------------------- |
| zip         | boolean       | Package `dist/<browser>` as an artifact (e.g., `.zip`, `.xpi`) |
| zipSource   | boolean       | Package source files (respects `.gitignore`)                   |
| zipFilename | string        | Custom base name for artifacts                                 |
| polyfill    | boolean       | Include `webextension-polyfill` when possible                  |
| silent      | boolean       | Suppress non-error logs                                        |

### start

| Option   | Type / Values | Description                                   |
| -------- | ------------- | --------------------------------------------- |
| mode     | `production`  | Build mode                                    |
| polyfill | boolean       | Include `webextension-polyfill` when possible |

### preview

| Option     | Type / Values | Description                                                         |
| ---------- | ------------- | ------------------------------------------------------------------- |
| mode       | `production`  | Build mode                                                          |
| outputPath | string        | Directory to run from (defaults to `dist/<browser>` when available) |

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
- browser.chrome | .firefox | .edge | .chromium-based | .gecko-based: start flags, excluded flags, preferences, binaries, profile reuse (persistProfile), and per-browser `extensions`.
  - extensions: load-only companion extensions (unpacked dirs) loaded alongside your extension in dev/preview/start.
    - Example: { dir: "./extensions" } loads every "./extensions/\*" folder that contains a manifest.json.
- Precedence when composing options: browser._ → commands._ → CLI flags. CLI flags always win over config defaults.
- Browser key aliases when resolving `browser.*` from `extension.config.*`:
  - When the runtime asks for `chromium`, `loadBrowserConfig` prefers `browser.chromium` and then falls back to `browser['chromium-based']`.
  - When the runtime asks for `chromium-based`, it prefers `browser['chromium-based']` and then `browser.chromium`.
  - When the runtime asks for `firefox`, it prefers `browser.firefox` and then `browser['gecko-based']`.
  - When the runtime asks for `gecko-based`, it prefers `browser['gecko-based']` and then `browser.firefox`.
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
- **Invalid entries**: ignored. In author mode (`EXTENSION_AUTHOR_MODE=true`) we print a warning if `extensions` is configured but nothing resolves.
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
- During config loading, develop preloads environment files from the project directory into `process.env` using the following order (first match wins):
  1. `.env.defaults` (always merged first when present)
  2. `.env.development`
  3. `.env.local`
  4. `.env`
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
- Source packaging respects `.gitignore`.

Example layout when both `zip` and `zipSource` are enabled:

```
dist/
  chrome/
    <name>-<version>.zip
  <name>-<version>-source.zip
```

## Notes and compatibility

- Built on the same Rspack stack as `@/webpack`; user config is loaded when an `extension.config.*` is present.
- Only `EXTENSION_PUBLIC_*` variables are injected into client code; avoid secrets in templated `.json`/`.html`.

## Plugins

| Name                 | Group | Summary                                                                                                                                                                                                         |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plugin-extension     | core  | - Core builder: emits pages and scripts<br/>- Validates and rewrites `manifest.json`<br/>- Ships icons, JSON, locales, and web resources<br/>- Ensures dev parity between local and shipped output              |
| plugin-css           | core  | - Auto‑wires CSS for HTML and content scripts<br/>- Optional SASS/LESS/PostCSS when configs exist<br/>- Integrates Stylelint when configured                                                                    |
| plugin-js-frameworks | core  | - Detects React/Preact/Vue/Svelte and TypeScript<br/>- Configures SWC parsing, loaders/plugins, and safe aliases<br/>- Sets `tsconfig` resolution<br/>- Defers heavy work to `beforeRun` in production          |
| plugin-static-assets | core  | - Emits images, fonts, and misc files to `assets/`<br/>- Inlines small SVGs (≤2KB), emits larger ones<br/>- Content hashing in production; stable names in development<br/>- Respects existing custom SVG rules |
| plugin-compatibility | core  | - Cross‑browser helpers<br/>- Normalizes browser‑specific manifest fields<br/>- Optional `webextension-polyfill` for Chromium                                                                                   |
| plugin-compilation   | core  | - Loads env and templating (`EXTENSION_PUBLIC_*`)<br/>- Optional `dist/<browser>` cleaning<br/>- Compact, de‑duplicated compilation summary                                                                     |

## Notes and compatibility

- Built against `@rspack/core`; Webpack 5 may work for some plugins but is not officially supported here.
- Only `EXTENSION_PUBLIC_*` variables are injected into client code; avoid embedding secrets in templated `.json`/`.html`.

## Related files in this folder

- `webpack/webpack-config.ts`: Assembles the plugin stack and shared configuration.
- `dev-server/`: Local development server wiring and reload orchestration.
- `webpack/webpack-types.ts`: Common types for the plugin stack.

## License

MIT (c) Cezar Augusto and the Extension.js Authors.
