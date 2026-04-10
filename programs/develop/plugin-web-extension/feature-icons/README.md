[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-icons

> Emit and watch browser extension icon files declared in `manifest.json`.

Handles icon assets referenced in an extension manifest and emits them into the final build output. It also adds those files to the compilation file-dependency graph so changes are picked up in subsequent builds. If an icon is missing, we fail fast at compile time to prevent the browser from crashing or refusing to load the extension. This module is part of the [Extension.js](https://extension.js.org) project.

Emits files referenced by icon-related manifest fields into the appropriate output folders. When used inside Extension.js, the orchestrator computes `includeList` for you; when used standalone, you can pass it manually.

Output mapping:

| Manifest field                | Output folder     |
| ----------------------------- | ----------------- |
| `icons/*`                     | `icons/`          |
| `action.default_icon`         | `icons/`          |
| `browser_action.default_icon` | `icons/`          |
| `browser_action.theme_icons`  | `browser_action/` |
| `page_action.default_icon`    | `icons/`          |
| `sidebar_action.default_icon` | `icons/`          |

## Usage

Typical usage:

```ts
import {IconsPlugin} from '@/webpack/plugin-extension/feature-icons'

export default {
  plugins: [
    new IconsPlugin({
      manifestPath: '/abs/path/to/manifest.json'
    })
  ]
}
```

Standalone (manual lists):

```ts
import * as path from 'path'
import {IconsPlugin} from '@/webpack/plugin-extension/feature-icons'

export default {
  // ...your rspack/webpack configuration
  plugins: [
    new IconsPlugin({
      manifestPath: path.resolve(__dirname, 'manifest.json'),
      includeList: {
        // Emits to dist/icons/
        icons: [
          path.resolve(__dirname, 'icons/extension_16.png'),
          path.resolve(__dirname, 'icons/extension_48.png')
        ],

        // Emits to dist/icons/
        'action/default_icon': [
          path.resolve(__dirname, 'icons/extension_16.png')
        ],

        // Emits to dist/icons/
        'browser_action/default_icon': [
          path.resolve(__dirname, 'icons/extension_16.png')
        ],

        // Emits to dist/browser_action/
        'browser_action/theme_icons': [
          path.resolve(__dirname, 'icons/extension_16.png'),
          path.resolve(__dirname, 'icons/extension_48.png')
        ],

        // Emits to dist/icons/
        'page_action/default_icon': [
          path.resolve(__dirname, 'icons/extension_16.png')
        ],

        // Emits to dist/icons/
        'sidebar_action/default_icon': [
          path.resolve(__dirname, 'icons/extension_16.png')
        ]
      }
    })
  ]
}
```

## Supported manifest fields

| Feature                       | Description                                           |
| ----------------------------- | ----------------------------------------------------- |
| `icons`                       | Root icon set mapping defined under `manifest.icons`. |
| `action.default_icon`         | Default icons for MV3 `action` toolbar button.        |
| `browser_action.default_icon` | Default icons for MV2 `browser_action`.               |
| `browser_action.theme_icons`  | Theme‑dependent icons for MV2 `browser_action`.       |
| `page_action.default_icon`    | Default icons for MV2 `page_action`.                  |
| `sidebar_action.default_icon` | Default icons for MV2/Firefox `sidebar_action`.       |

## Include semantics

- `includeList`: a map of feature keys to absolute file paths (string or string[]).
- Static assets under `public/` are handled by the Special Folders feature, which copies and watches them independently.

## Path resolution rules

- Leading `/` in manifest resources means extension root (public root), not OS root. The plugin resolves `/foo/bar.png` as `<manifestDir>/foo/bar.png` prior to validation and emission.
- Relative paths are resolved from the directory containing `manifest.json`.
- Absolute OS paths are used as-is.

These rules align with the common bundler convention that `/` points to the packaged app's public root while still operating correctly during local development.

## Compile-time validation

- Missing icon files referenced by supported manifest fields are surfaced during compilation with a focused message.
  - Top‑level `icons` (i.e., `manifest.icons`) are treated as errors.
  - Default toolbar icon families are also treated as errors: `action.default_icon`, `browser_action.default_icon`, `page_action.default_icon`, and `sidebar_action.default_icon` — because a missing toolbar icon prevents the extension from loading in several browsers.
  - Theme icon variants remain warnings: `browser_action.theme_icons`.
  - The hint “Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.” appears only when the manifest entry uses an extension‑root absolute path (leading `/`), not for relative or OS‑absolute filesystem paths.
- Manifest field presence/shape is validated by other features; this plugin focuses on file existence and emission.

## Compatibility

- This plugin is typed against `@rspack/core` and tested with Rspack.
- Webpack 5 may work since the compiler interfaces are similar, but it is not officially supported here.

## API

```ts
export type FilepathList = Record<string, string | string[]>

export class IconsPlugin {
  constructor(options: {
    manifestPath: string
    includeList?: FilepathList | Record<string, unknown>
  })

  apply(compiler: import('@rspack/core').Compiler): void
}
```

## License

MIT (c) Cezar Augusto
