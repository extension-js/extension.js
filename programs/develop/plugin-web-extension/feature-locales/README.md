[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# feature-locales

> Emit extension `_locales/**/messages.json` files during build.

The Locales plugin scans your extension project for `_locales` folders and emits their `messages.json` files into the final bundle. This ensures Chrome/Firefox localization files are correctly included and watched during development. This module is part of the Extension.js project.

### Early‑fail validation (break before the browser)

To prevent browser crashes or confusing runtime alerts, this plugin validates locale wiring at compile time and fails fast with clear messages:

- `default_locale` set in `manifest.json` requires `_locales/<default>/messages.json` to exist and contain valid JSON. The manifest is read as resolved for the target browser, so a `chromium:default_locale` counts for a Chromium build.
- If `_locales/` exists but `default_locale` is missing in `manifest.json`, the build errors (browsers will reject the extension otherwise).
- All discovered `_locales/**/messages.json` are checked for valid JSON.

When any of the above is misconfigured, the build emits a compilation error so you can fix it before the browser runs.

## What it does

- Scans `_<locales>/<locale>/*` at the project root, next to your `manifest.json`, or inside `public/`. A `public/_locales` is shipped by the public copier, so this plugin emits nothing for it.
- Emits only `.json` files (e.g., `messages.json`) to the output bundle. Non‑JSON files in `_locales` are ignored.
- Adds discovered `.json` files to compilation file dependencies so changes are watched during `dev`.

## Usage

```ts
import {LocalesPlugin} from './feature-locales'

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
  readonly browser: DevOptions['browser']
  readonly includeList?: string[]

  constructor(options: {
    manifestPath: string
    browser?: DevOptions['browser']
    includeList?: string[]
  })
  apply(compiler: unknown): void
}
```

- **manifestPath**: Absolute path to your `manifest.json`.
- **browser**: Target browser whose manifest keys are resolved before validation. Defaults to `chrome`.
- **includeList**: Optional file path list to include. Non-`.json` files are skipped automatically.

## License

MIT (c) Cezar Augusto
