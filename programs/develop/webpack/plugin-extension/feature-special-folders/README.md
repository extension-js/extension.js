[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-special-folders

> Handle extension "special folders" (public, pages, scripts) during builds and development.

This module adds support for special folders in a browser extension project and is part of the [Extension.js](https://extension.js.org) project. It copies static assets from `public/` to the output directory and, in development watch mode, warns when HTML files in `pages/` or script files in `scripts/` are added or removed after compilation (which typically requires a server restart).

- Copies everything from `public/` (case-insensitive on some platforms, e.g., `Public/`) into the build output root, preserving the folder structure.
- In development with watch enabled, monitors `pages/` and `scripts/`:
  - Adding supported files logs a warning (non-fatal) so you can continue working.
  - Removing supported files triggers a compilation error that exits the process, to avoid running with broken entry points.

Output mapping overview:

| Source pattern | Output behavior                                                                  |
| -------------- | -------------------------------------------------------------------------------- |
| `public/**`    | Copied 1:1 into output root (e.g., `public/img/icon.png` → `dist/img/icon.png`). |
| `pages/**`     | Surfaced via HTML feature; not copied by this plugin.                            |
| `scripts/**`   | Surfaced via Scripts feature; not copied by this plugin.                         |

## Usage

```ts
import {SpecialFoldersPlugin} from '@/webpack/plugin-extension/feature-special-folders'

export default {
  // ... your Rspack/Webpack config
  plugins: [
    new SpecialFoldersPlugin({
      // Absolute path to your manifest.json
      manifestPath: '/absolute/path/to/manifest.json'
    })
  ]
}
```

## Include/Exclude semantics

- This plugin does not accept `includeList`/`excludeList`. It always copies from `public/` and watches `pages/` and `scripts/` (dev-only) based on the `manifestPath` project root.
- For include/exclude of specific assets referenced in `manifest.json`, use the respective plugins (HTML, Icons, Scripts) which support `includeList`/`excludeList`.

## Compatibility

- Typed against `@rspack/core` and tested with Rspack.
- Webpack 5 may work but isn’t officially supported here.

## API

```ts
export interface SpecialFoldersPluginOptions {
  manifestPath: string
}

export class SpecialFoldersPlugin {
  static readonly name: string
  constructor(options: SpecialFoldersPluginOptions)
}
```

## Examples

- Basic copy from `public/`:
  - `public/css/file.css` → `dist/css/file.css`
  - `public/img/icon.png` → `dist/img/icon.png`
  - `public/logo.svg` → `dist/logo.svg`
- Dev watch behavior:
  - Add `pages/foo.html` → logs a warning advising a restart.
  - Remove `scripts/content.js` → logs an error and exits to prevent broken builds.

## Tested behaviors

- Copies `public/**` into output root during builds and mirrors add/change/unlink in development watch.
- In dev watch, adding HTML under `pages/` or supported scripts under `scripts/` logs a warning; removing them logs an error and exits.

## License

MIT (c) Cezar Augusto
