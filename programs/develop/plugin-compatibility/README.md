[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-compatibility

> Cross‑browser compatibility helpers for extension `manifest.json` and the `browser` global.

This plugin bundles two features that make an extension project portable across browsers:

- Browser‑specific manifest fields are normalized so you can author once and target Chrome/Edge/Firefox/Safari via namespaced keys.
- Optionally provides the `browser` global using `webextension-polyfill` for Chromium‑based browsers when `polyfill: true`.

### Feature overview

|                                                                            | Feature                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Browser‑specific manifest fields**<br/>Normalize namespaced keys (e.g. `chrome:action`) into vendor output. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **`browser` polyfill**<br/>Optionally maps the `browser` global via `webextension-polyfill` for Chromium.     |

### Usage

```ts
import {CompatibilityPlugin} from '@/webpack/plugin-compatibility'

export default {
  plugins: [
    new CompatibilityPlugin({
      manifestPath: '/abs/path/to/manifest.json',
      browser: 'chrome',
      polyfill: true
    })
  ]
}
```

### API

```ts
export class CompatibilityPlugin {
  constructor(options: {
    manifestPath: string
    browser?:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'safari'
      | 'chromium-based'
      | 'gecko-based'
    polyfill?: boolean
  })
  apply(compiler: import('@rspack/core').Compiler): Promise<void>
}
```

### Notes

- The polyfill is resolved from the bundler context. Ensure `webextension-polyfill` is installed next to the bundler config if you enable it.
- Firefox natively supports the `browser` global; we avoid injecting a polyfill for it.

### License

MIT (c) Cezar Augusto
