[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-locales

> Emit extension `_locales/**/messages.json` files during build.

The Locales plugin scans your extension project for `_locales` folders and emits their `messages.json` files into the final bundle. This ensures Chrome/Firefox localization files are correctly included and watched during development. This module is part of the Extension.js project.

## What it does

- Scans `_<locales>/<locale>/*` under the directory of your `manifest.json`.
- Emits only `.json` files (e.g., `messages.json`) to the output bundle. Non‑JSON files in `_locales` are ignored.
- Adds discovered `.json` files to compilation file dependencies so changes are watched during `dev`.

## Usage

```ts
import {LocalesPlugin} from '@/webpack/plugin-extension/feature-locales'

export default {
  context: __dirname,
  plugins: [
    new LocalesPlugin({
      manifestPath: require('path').resolve(__dirname, 'manifest.json')
      // includeList, excludeList optional
    })
  ]
}
```

## API

```ts
export class LocalesPlugin {
  readonly manifestPath: string
  readonly includeList?: string[]
  readonly excludeList?: string[]

  constructor(options: {
    manifestPath: string
    includeList?: string[]
    excludeList?: string[]
  })
  apply(compiler: unknown): void
}
```

- **manifestPath**: Absolute path to your `manifest.json`.
- **includeList/excludeList**: Optional file path lists to include/exclude. Non-`.json` files are skipped automatically.

## License

MIT (c) Cezar Augusto
