[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

## @/commands

> Developer commands used by Extension.js to develop, build, run and package browser extensions.

Small, focused commands that orchestrate the Rspack-powered build stack, local browser runners, and packaging utilities. They provide a batteries‑included workflow with sensible defaults and production‑ready output.

### Commands

| Name    | Summary                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dev     | - Starts a local development server with live reload/HMR<br/>- Auto-installs dependencies if missing<br/>- Generates TypeScript shim types (`extension-env.d.ts`) when applicable<br/>- Launches a target browser with an isolated/stable profile |
| build   | - Production build using the webpack/Rspack plugin stack<br/>- Cleans `dist/<browser>` before emitting<br/>- Optional packaging: distribution zip and/or source zip<br/>- Merges user config; excludes browser runners during compilation         |
| start   | - Runs a silent production build, then launches preview from `dist/<browser>`<br/>- Mirrors the runtime environment of shipped output                                                                                                             |
| preview | - Launches the extension for manual testing without dev server<br/>- Uses `dist/<browser>` when present, otherwise uses the project directory<br/>- Preserves production settings; only browser runners are applied                               |
| cleanup | - Removes orphaned browser instances and temporary profiles created during development                                                                                                                                                            |

### Options

Common (browser/runtime)

| Option         | Type / Values                                      | Description                                 |
| -------------- | -------------------------------------------------- | ------------------------------------------- |
| browser        | chrome, edge, firefox, chromium-based, gecko-based | Target browser/runtime                      |
| profile        | string or false                                    | Profile path or disable profile persistence |
| startingUrl    | string                                             | Initial URL to open                         |
| open           | boolean                                            | Focus/open the browser window               |
| chromiumBinary | string                                             | Custom Chromium-based executable path       |
| geckoBinary    | string                                             | Custom Gecko-based executable path          |

dev

| Option      | Type / Values                 | Description                                   |
| ----------- | ----------------------------- | --------------------------------------------- |
| mode        | development, production, none | Build mode                                    |
| polyfill    | boolean                       | Include `webextension-polyfill` when possible |
| port        | number or string              | Dev server port                               |
| source      | string                        | Inspect a source directory                    |
| watchSource | boolean                       | Watch the source directory                    |

build

| Option      | Type / Values | Description                                                    |
| ----------- | ------------- | -------------------------------------------------------------- |
| zip         | boolean       | Package `dist/<browser>` as an artifact (e.g., `.zip`, `.xpi`) |
| zipSource   | boolean       | Package source files (respects `.gitignore`)                   |
| zipFilename | string        | Custom base name for artifacts                                 |
| polyfill    | boolean       | Include `webextension-polyfill` when possible                  |
| silent      | boolean       | Suppress non-error logs                                        |

start

| Option   | Type / Values | Description                                   |
| -------- | ------------- | --------------------------------------------- |
| mode     | `production`  | Build mode                                    |
| polyfill | boolean       | Include `webextension-polyfill` when possible |

preview

| Option     | Type / Values | Description                                                         |
| ---------- | ------------- | ------------------------------------------------------------------- |
| mode       | `production`  | Build mode                                                          |
| outputPath | string        | Directory to run from (defaults to `dist/<browser>` when available) |

### Project detection and inputs

- **Path or remote**: Commands accept a local path or a remote URL.
  - **GitHub repo URL**: downloaded via `go-git-it` into a subfolder named after the repository.
  - **Other HTTP(S) URLs**: treated as zip archives and extracted locally.
- **Monorepos**: The nearest `manifest.json` is resolved recursively; the nearest valid `package.json` is then located and validated.

### User config

- Provide `extension.config.js` or `extension.config.mjs` in your project root.
- Supported sections:
  - **config(config: Configuration)**: mutate the assembled Rspack config.
  - **commands.dev | .build | .start | .preview**: per-command options (browser, profile, binaries, flags, preferences, packaging).
  - **browser.chrome | .firefox | .edge | .chromium-based | .gecko-based**: launch flags, excluded flags, preferences, binaries, and profile reuse.
- When detected, a one‑time notice is printed to indicate config is active.

### Safety and ergonomics

- **Managed dependency guard**: If your `extension.config.*` references dependencies that are managed by Extension.js itself, the command aborts with a detailed message to prevent version conflicts.
- **Auto‑install**: If `node_modules` is missing, the appropriate package manager is detected and dependencies are installed before running.
- **Type generation**: For TypeScript projects, `extension-env.d.ts` is generated/updated to include required types and polyfills.

### Packaging outputs

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

### Notes and compatibility

- Requires Node.js >= 18.
- Built on the same Rspack stack as `@/webpack`; user config is loaded when an `extension.config.*` is present.
- Only `EXTENSION_PUBLIC_*` variables are injected into client code; avoid secrets in templated `.json`/`.html`.

### License

MIT(c) Cezar Augusto
