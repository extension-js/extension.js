[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-special-folders

> Handle extension "special folders" (public, pages, scripts, extensions) during builds and development.

This module adds support for special folders in a browser extension project and is part of the [Extension.js](https://extension.js.org) project. It uses Rspack's `CopyRspackPlugin` to emit static assets under `public/` (for proper watch/incremental behavior). In development watch mode, it also warns when HTML files in `pages/` or script files in `scripts/` are added or removed after compilation (which typically requires a server restart). It also defines a conventional `extensions/` folder for load-only companion extensions.

- Emits everything from the exact `public/` directory into the build output root, preserving the folder structure, via `CopyRspackPlugin`.
- In development with watch enabled, monitors `pages/` and `scripts/`:
  - Adding supported files logs a warning (non-fatal) so you can continue working.
  - Removing supported files triggers a compilation error that exits the process, to avoid running with broken entry points.

Output mapping overview:

| Source pattern  | Output behavior                                                                   |
| --------------- | --------------------------------------------------------------------------------- |
| `public/**`     | Emitted 1:1 into output root (e.g., `public/img/icon.png` → `dist/img/icon.png`). |
| `pages/**`      | Surfaced via HTML feature; nested routes preserved and `/index` collapses.        |
| `scripts/**`    | Surfaced via Scripts feature; not copied by this plugin.                          |
| `extensions/**` | Load-only companion extensions; scanned when no CLI/config `extensions` provided. |

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

## Include semantics

- This plugin does not accept include/exclude lists. It always emits from `public/` and watches `pages/` and `scripts` (dev-only) based on the `manifestPath` project root. It also exposes a default `extensions/` scan when no CLI/config `extensions` are provided.
- For handling specific assets referenced in `manifest.json`, use the respective plugins (HTML, Icons, Scripts) with their `includeList` options.

## Path resolution convention (consistent across @plugin-extension)

- Leading `/` means extension root (public root) relative to the directory containing `manifest.json`.
- Relative paths are resolved from the manifest directory.
- Absolute OS paths are used as-is.

This plugin mirrors that convention by emitting `public/` into the output root so assets addressed as `/foo.png` in manifests/HTML resolve correctly at runtime.

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
