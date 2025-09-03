[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-icons

> Emit and watch browser extension icon files declared in `manifest.json`.

Handles icon assets referenced in an extension manifest and emits them into the final build output. It also adds those files to the compilation file-dependency graph so changes are picked up in subsequent builds. This module is part of the [Extension.js](https://extension.js.org) project.

Emits files referenced by icon-related manifest fields into the appropriate output folders. When used inside Extension.js, the orchestrator computes `includeList`/`excludeList` for you; when used standalone, you can pass them manually.

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
      },
      // Prevent emitting specific files (exact path or subpath match)
      excludeList: {
        icons: [path.resolve(__dirname, 'icons/skip.png')]
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

## Include/Exclude semantics

- `includeList`: a map of feature keys to absolute file paths (string or string[]).
- `excludeList`: a map of feature keys to absolute file paths you want to skip emitting. If a file path in `includeList` matches (or is contained within) a value in `excludeList`, it will not be emitted. This is commonly used to avoid duplicating assets already handled via special folders (e.g., `public/`).
- Excluded files are not emitted or added to the compilation dependency graph. Static assets under `public/` are handled by the Special Folders feature, which copies and watches them independently.

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
    excludeList?: FilepathList | Record<string, unknown>
  })

  apply(compiler: import('@rspack/core').Compiler): void
}
```

## License

MIT (c) Cezar Augusto
