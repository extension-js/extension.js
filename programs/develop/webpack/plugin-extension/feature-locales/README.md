[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-locales

> Emit extension `_locales/**/messages.json` files during build.

The Locales plugin scans your extension project for `_locales` folders and emits their `messages.json` files into the final bundle. This ensures Chrome/Firefox localization files are correctly included and watched during development. This module is part of the Extension.js project.

### Early‑fail validation (break before the browser)

To prevent browser crashes or confusing runtime alerts, this plugin validates locale wiring at compile time and fails fast with clear messages:

- `default_locale` set in `manifest.json` requires `_locales/<default>/messages.json` to exist and contain valid JSON.
- If `_locales/` exists but `default_locale` is missing in `manifest.json`, the build errors (browsers will reject the extension otherwise).
- All discovered `_locales/**/messages.json` are checked for valid JSON.

When any of the above is misconfigured, the build emits a compilation error so you can fix it before launching the browser.

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
    })
  ]
}
```

## API

```ts
export class LocalesPlugin {
  readonly manifestPath: string
  readonly includeList?: string[]

  constructor(options: {manifestPath: string; includeList?: string[]})
  apply(compiler: unknown): void
}
```

- **manifestPath**: Absolute path to your `manifest.json`.
- **includeList**: Optional file path list to include. Non-`.json` files are skipped automatically.

## License

MIT (c) Cezar Augusto
