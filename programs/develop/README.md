[npm-version-image]: https://img.shields.io/npm/v/extension-develop.svg?color=0971fe
[npm-version-url]: https://www.npmjs.com/package/extension-develop
[downloads-image]: https://img.shields.io/npm/dm/extension-develop.svg?color=2ecc40
[downloads-url]: https://npmjs.org/package/extension-develop
[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org

[![Empowering][empowering-image]][empowering-url] [![Version][npm-version-image]][npm-version-url] [![Downloads][downloads-image]][downloads-url]

# extension-develop

> Develop, build, preview, and package [Extension.js](https://extension.js.org) projects.

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
  cleanupCommand,
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

  // Cleanup orphaned browser instances
  await cleanupCommand()
}

run()
```

## Features

- Live reload/HMR development server with per-instance browser runners
- Cross-browser support: Chrome, Edge, Firefox, Chromium-based, Gecko-based
- Rspack-based build with opinionated plugin stack
- Clean production output in `dist/<browser>`
- Zipping: distribution and/or source packages (respects `.gitignore`)
- Auto-install of missing dependencies and package manager detection
- Type generation for TS projects via `extension-env.d.ts`
- User config via `extension.config.(js|mjs)` for commands, browser launch, and webpack config hooks
- Managed dependency guard to avoid conflicts

## Commands

| Name    | Summary                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dev     | - Starts a local development server with live reload/HMR<br/>- Auto-installs dependencies if missing<br/>- Generates TypeScript shim types (`extension-env.d.ts`) when applicable<br/>- Launches a target browser with an isolated/stable profile |
| build   | - Production build using the webpack/Rspack plugin stack<br/>- Cleans `dist/<browser>` before emitting<br/>- Optional packaging: distribution zip and/or source zip<br/>- Merges user config; excludes browser runners during compilation         |
| start   | - Runs a silent production build, then launches preview from `dist/<browser>`<br/>- Mirrors the runtime environment of shipped output                                                                                                             |
| preview | - Launches the extension for manual testing without dev server<br/>- Uses `dist/<browser>` when present, otherwise uses the project directory<br/>- Preserves production settings; only browser runners are applied                               |
| cleanup | - Removes orphaned browser instances and temporary profiles created during development                                                                                                                                                            |

## Command options

Options accepted by each command. Values shown are typical types or enumerations; see the tables for specifics.

### Common (browser/runtime)

| Option         | Type / Values                                      | Description                                 |
| -------------- | -------------------------------------------------- | ------------------------------------------- |
| browser        | chrome, edge, firefox, chromium-based, gecko-based | Target browser/runtime                      |
| profile        | string or false                                    | Profile path or disable profile persistence |
| startingUrl    | string                                             | Initial URL to open                         |
| open           | boolean                                            | Focus/open the browser window               |
| chromiumBinary | string                                             | Custom Chromium-based executable path       |
| geckoBinary    | string                                             | Custom Gecko-based executable path          |

### dev

| Option      | Type / Values                 | Description                                   |
| ----------- | ----------------------------- | --------------------------------------------- |
| mode        | development, production, none | Build mode                                    |
| polyfill    | boolean                       | Include `webextension-polyfill` when possible |
| port        | number or string              | Dev server port                               |
| source      | string                        | Inspect a source directory                    |
| watchSource | boolean                       | Watch the source directory                    |

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

## User config

- Provide `extension.config.js` or `extension.config.mjs` in your project root.
- Supported sections:
  - config(config: Configuration): mutate the assembled Rspack config.
  - commands.dev | .build | .start | .preview: per-command options (browser, profile, binaries, flags, preferences, packaging).
  - browser.chrome | .firefox | .edge | .chromium-based | .gecko-based: launch flags, excluded flags, preferences, binaries, and profile reuse.
- When detected, a one‑time notice is printed to indicate config is active.

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
| plugin-reload        | core  | - Dev‑time live reload/HMR orchestration<br/>- Per‑instance WebSocket server<br/>- Manifest dev overrides<br/>- Full recompiles on HTML entry changes                                                           |

## Notes and compatibility

- Built against `@rspack/core`; Webpack 5 may work for some plugins but is not officially supported here.
- Only `EXTENSION_PUBLIC_*` variables are injected into client code; avoid embedding secrets in templated `.json`/`.html`.

## Related files in this folder

- `webpack/webpack-config.ts`: Assembles the plugin stack and shared configuration.
- `webpack/dev-server.ts`: Local development server wiring and reload orchestration.
- `webpack/webpack-types.ts`: Common types for the plugin stack.

## License

MIT (c) Cezar Augusto and the Extension.js Authors.
