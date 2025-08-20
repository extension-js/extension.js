[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-scripts

> Add, wrap, and HMR‑enable extension scripts declared in `manifest.json`.

Handles all script-like entries in a browser extension: `background.scripts`, `background.service_worker`, `content_scripts` (JS and CSS), and `user_scripts.api_script`. It creates proper Rspack entries, applies framework‑aware wrappers for content scripts (React, Vue, Svelte, Preact, TypeScript, JavaScript), enables HMR during development, and ensures correct publicPath resolution in production. This module is part of the Extension.js project.

Emits and wires bundles for all script‑related manifest fields and optional extras provided via `includeList`. For content scripts, it can inject a wrapper that isolates styles via Shadow DOM and wires CSS import handling and HMR. Wrapper activation is explicit: add `'use shadow-dom'` at the top of your content script file to enable the wrapper. For background workers, it respects classic vs module workers.

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

Standalone usage (manual include/exclude lists):

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
      },
      // Optionally skip files (exact or subpath match)
      excludeList: {
        // 'public/some-file': path.resolve(__dirname, 'public/some-file.js')
      }
    })
  ]
}

export default config
```

### Details

- Adds entries for script-like manifest fields and optional extra scripts you pass via `includeList`.
- Applies a content‑script wrapper that:
  - Mounts in an isolated Shadow DOM container (requires `'use shadow-dom'` directive in the content script)
  - Injects referenced CSS (including `.css`, `.scss`, `.sass`, `.less`)
  - Detects common frameworks (React, Vue, Svelte, Preact) and generates framework‑specific bootstrap code
  - Enables HMR for both JS and CSS during development
- Ensures publicPath is available for content scripts in production builds.
- Fixes publicPath for assets imported by content scripts running in the main world.
- For non‑module `background.service_worker`, configures `chunkLoading: 'import-scripts'` for correct runtime behavior (module workers are left as‑is).

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
  excludeList?: FilepathList
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

### Include/Exclude semantics

- **includeList**: Map of feature keys to absolute file paths. Values can be a `string` or `string[]`.
- **excludeList**: Map of feature keys to absolute file paths you want to skip. If a file path in `includeList` matches (or is contained within) a value in `excludeList`, it will not be emitted or added to entries/file‑dependencies. Use this to prevent duplication with special folders like `public/`.

Example:

```ts
new ScriptsPlugin({
  manifestPath: '/abs/manifest.json',
  includeList: {
    'background/scripts': ['/abs/a.js', '/abs/b.js']
  },
  excludeList: {
    'background/scripts': ['/abs/b.js']
  }
})
// Resulting entry imports only ['/abs/a.js']
```

### Wrapper behavior (content scripts)

- Applied to files referenced by `manifest.content_scripts` when the file contains the `'use shadow-dom'` directive at the top of the file.
- Detects React, Vue, Svelte, Preact, or falls back to TypeScript/JavaScript.
- Injects CSS imported from the content script and wires HMR for style updates.
- The wrapper does not apply by default. You must explicitly annotate your content script with `'use shadow-dom'` for the wrapper to be generated.
- Classic vs module service worker: non‑module workers get `chunkLoading: 'import-scripts'` to ensure correct runtime behavior, while module workers are left untouched.

## Tested behavior

- Adds entries for `background.scripts`, `background.service_worker`, `content_scripts` (JS/CSS), and `user_scripts.api_script`.
- Injects HMR accept code into content scripts and background scripts (not service workers).
- Emits a minimal JS bundle even for CSS-only content scripts, so they can be loaded reliably in development.
- In production, ensures publicPath is available and corrected for content scripts and main-world asset resolution.
- Honors `includeList` and `excludeList` for script and CSS files; excluded file paths (or subpaths) are not emitted.

### Compatibility

- Built and typed against `@rspack/core`.
- Webpack 5 may work (compiler interfaces are similar), but it is not officially supported here.

### Learn more

- Extension.js website: `https://extension.js.org`
- Source repo: `https://github.com/extension-js/extension.js`

## License

MIT (c) Cezar Augusto
