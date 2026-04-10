[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-static-assets

> Emits common static assets to stable `assets/` paths with sensible defaults and production hashing.

### What it does

- **Asset rules**: Emits images (`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `ico`, `bmp`), fonts (`woff`, `woff2`, `eot`, `ttf`, `otf`), and misc files (`txt`, `md`, `csv`, `tsv`, `xml`, `pdf`, `docx`, `doc`, `xls`, `xlsx`, `ppt`, `pptx`, `zip`, `gz`, `gzip`, `tgz`) under `assets/`.
- **SVG rule**: Default `asset` rule with a 2KB inline threshold; inlines small SVGs and emits larger ones to `assets/`.
- **Prod hashing**: Uses `assets/[name].[contenthash:8][ext]` in production; `assets/[name][ext]` in development.
- **Custom SVG respect**: Skips adding the default SVG rule if a custom `.svg` rule with `use` already exists.

### Feature overview

|                                                                            | Feature                                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Images/Fonts/Files**<br/>Smart defaults for common assets under a stable `assets/`.  |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **SVG handling**<br/>Inline small SVGs (<=2KB) and emit larger ones.                   |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Prod hashing**<br/>Content hashes in filenames for long-term caching in production.  |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Respect custom rules**<br/>Leaves custom `.svg` loader rules untouched when present. |

### Usage

```ts
import {StaticAssetsPlugin} from '@/webpack/plugin-static-assets'

export default {
  plugins: [
    new StaticAssetsPlugin({
      manifestPath: '/abs/path/to/manifest.json',
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'development'
    })
  ]
}
```

### API

```ts
export class StaticAssetsPlugin {
  static readonly name: 'plugin-static-assets'
  constructor(options: {
    manifestPath: string
    mode: 'development' | 'production'
  })
  apply(compiler: import('@rspack/core').Compiler): Promise<void>
}
```
