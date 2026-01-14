[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-scripts

> Add, wrap, and HMR‑enable extension scripts declared in `manifest.json`.

Handles all script-like entries in a browser extension: `background.scripts`, `background.service_worker`, `content_scripts` (JS and CSS), and `user_scripts.api_script`. It creates proper Rspack entries, applies framework‑aware wrappers for content scripts (React, Vue, Svelte, Preact, TypeScript, JavaScript), enables HMR during development, and ensures correct publicPath resolution in production. This module is part of the Extension.js project.

Emits and wires bundles for all script‑related manifest fields and optional extras provided via `includeList`. For content scripts, a wrapper is applied by default that isolates styles via Shadow DOM and wires CSS import handling and HMR automatically. No directives are required. For background workers, it respects classic vs module workers.

| Manifest field              | includeList key               | Output path example                        |
| --------------------------- | ----------------------------- | ------------------------------------------ |
| `background.scripts[]`      | `background/scripts`          | `background/scripts.js`                    |
| `background.service_worker` | `background/service_worker`   | `background/service_worker.js` (or `.mjs`) |
| `content_scripts[n].js`     | `content_scripts/content-<n>` | `content_scripts/content-0.js`             |
| `content_scripts[n].css`    | `content_scripts/content-<n>` | `content_scripts/content-0.css`            |
| `user_scripts.api_script`   | `user_scripts/api_script`     | `user_scripts/api_script.js`               |

Notes:

- Exact filenames may vary based on chunking and hashing; the table shows the base path mapping.
- Icon‑related fields are handled by `@/webpack/plugin-extension/feature-icons`.

## Usage

Standalone usage (manual include list):

```ts
import * as path from 'path'
import type {Configuration} from '@rspack/core'
import {ScriptsPlugin} from '@/webpack/plugin-extension/feature-scripts'

const config: Configuration = {
  plugins: [
    new ScriptsPlugin({
      manifestPath: path.resolve(__dirname, 'manifest.json'),
      // Keys are feature buckets; values are absolute file paths
      includeList: {
        'background/scripts': path.resolve(__dirname, 'src/background.js'),
        'background/service_worker': path.resolve(__dirname, 'src/sw.js'),
        // Each content script entry can include JS and/or CSS
        'content_scripts/content-0': [
          path.resolve(__dirname, 'src/content.tsx'),
          path.resolve(__dirname, 'src/content.css')
        ],
        'user_scripts/api_script': path.resolve(__dirname, 'src/user-script.js')
      }
    })
  ]
}

export default config
```

### Details

- Adds entries for script-like manifest fields and optional extra scripts you pass via `includeList`.
- Applies a content‑script wrapper (default) that:
  - Mounts in an isolated Shadow DOM container (automatic)
  - Injects referenced CSS (including `.css`, `.scss`, `.sass`, `.less`)
  - Detects common frameworks (React, Vue, Svelte, Preact) and generates framework‑specific bootstrap code
- Enables HMR for both JS and CSS during development, with safe cleanup
- Injects a development‑only centralized logger bridge:
  - Content scripts forward their `console.*` to the centralized DevTools logger
  - A small page script is injected to forward page `console.*` via `window.postMessage` to the content script, which relays to background
  - Background scripts forward their `console.*` to the centralized logger
- Ensures publicPath is available for content scripts in production builds.
- Reload integration (development):
  - Patches CSP, permissions, and web_accessible_resources automatically.
  - Ensures a minimal background entry exists and injects the HMR reloader.
  - Wraps content scripts so no user HMR code is required.
- For non‑module `background.service_worker`, configures `chunkLoading: 'import-scripts'` for correct runtime behavior (module workers are left as‑is).

### Compile‑time validation and restart guard

- Missing script files referenced by supported manifest fields (or extras via `includeList`) are surfaced during compilation with a focused message, before the browser runs.
  - Leading `/` paths show a hint explaining they resolve from the extension output root (served from `public/`), not the source directory. The hint appears only when the original manifest entry used a leading `/`.
- Changing manifest script entrypoints during development requires a restart. The plugin detects changes and emits a compile‑time error with PATH BEFORE/AFTER guidance.

### Content scripts wrapper contract

- The wrapper applies automatically to any file referenced in `manifest.content_scripts`.
- You do not need to add `import.meta.webpackHot` or any tool‑specific HMR code; Extension.js handles HMR registration and cleanup.
- Your script can be self‑bootstrapping (imperative DOM mount) or export a default mount function; the wrapper adapts to common patterns across frameworks.
- The wrapper provides an isolated host element inside a `ShadowRoot` so styles and markup are sandboxed from the host page.
- HMR performs safe cleanup between updates to prevent duplicate mounts.
- Default export contract:
  - Preferred: export a callable default function returning an optional cleanup.
  - Back‑compat: missing default export is tolerated in dev with a warning, but will be required in v3.
  - Returning a cleanup function is respected for back‑compat, but the wrapper provides its own unmount; returning cleanup is discouraged.
  - Side‑effect only defaults are supported; the wrapper detects and removes created nodes on unmount/HMR.
- Required for wrapper application: the loader applies wrappers when a `export default` is present in the content script, ensuring correct targeting and avoiding legacy files unintentionally.

CSS handling and HMR:

- CSS referenced via ES imports (e.g., `import './styles.css'`) is injected and hot‑reloaded.
- CSS referenced via `new URL('./styles.css', import.meta.url)` is also detected, injected, and hot‑reloaded. Renaming the URL path (e.g., switching to `styles2.css`) is picked up on rebuild and the new stylesheet is injected without a full page reload.

### CSP considerations

- The wrapper injects styles by creating a `<style>` element with text content. Ensure your extension’s CSP permits style injection in content scripts, or configure policies accordingly.
- Script execution is bundled; no remote code is injected by the wrapper.

## Supported fields and behavior

| Feature                        | Description                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `background.scripts[]`         | Each file becomes part of the `background/scripts` entry; HMR accept is injected in development.                       |
| `background.service_worker`    | Creates a dedicated entry; classic workers use `import-scripts` chunk loading, module workers are preserved.           |
| `content_scripts[n].js / .css` | Generates `content_scripts/content-<index>` entries; wrapper injects CSS, adds HMR hooks, and isolates via Shadow DOM. |
| `user_scripts.api_script`      | Added as `user_scripts/api_script` entry; HMR accept is injected in development.                                       |

## API

```ts
export type FilepathList = Record<string, string | string[] | undefined>

export interface PluginInterface {
  manifestPath: string
  browser?: import('../../../development-lib/config-types').DevOptions['browser']
  includeList?: FilepathList
}

export class ScriptsPlugin {
  constructor(options: PluginInterface)
  apply(compiler: import('@rspack/core').Compiler): void
}
```

### Supported manifest fields (as includeList keys)

| Feature                           | Description                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `background/scripts`              | Logical entry for classic background scripts (MV2 or grouped background files). |
| `background/service_worker`       | Logical entry for background service worker (MV3).                              |
| `content_scripts/content-<index>` | Generated per item in `manifest.content_scripts`; includes JS and/or CSS.       |
| `user_scripts/api_script`         | Logical entry for user scripts API script.                                      |
