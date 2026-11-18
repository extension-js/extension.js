[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-compatibility

> The `browser` global on Chromium: an opt-in polyfill, and a warning when a build reads it without one.

This plugin does one of two things for a Chromium-based target, and nothing for Firefox or Safari:

- With `polyfill: true`, it provides the `browser` global using `webextension-polyfill`. It is off by default in `dev`, `start` and `build`. Firefox and Safari already ship a native promise-based `browser` namespace, so the polyfill is never injected for those families.
- With the polyfill off, it warns when the extension's own code reads `browser.*` and the manifest does not declare a Chromium version that has the namespace natively.

### Feature overview

|                                                                            | Feature                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **`browser` polyfill**<br/>Optionally maps the `browser` global via `webextension-polyfill` for Chromium.     |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **`browser` read warning**<br/>Warns when a build reads `browser.*` with the polyfill off.                    |

### Usage

```ts
import {CompatibilityPlugin} from './plugin-compatibility'

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
    devSession?: boolean
    command?: 'dev' | 'start' | 'build'
  })
  apply(compiler: import('@rspack/core').Compiler): void
}
```

### Notes

- The polyfill is resolved from the bundler context. Ensure `webextension-polyfill` is installed next to the bundler config if you enable it.
- Firefox and Safari natively support the promise-based `browser` global; we avoid injecting a polyfill for gecko and webkit targets (including `firefox`, `gecko-based`, `safari`, and `webkit-based`).
- Chromium has the `browser` namespace natively from version 148, and from 152 for an extension that declares a `devtools_page`. Below 152 such an extension has no `browser` in any of its scripts, not only in the DevTools page. The polyfill only matters for those older Chromium browsers, so no command bundles it unless `polyfill` is `true`. A production build that reads `browser.*` with the polyfill off warns about it, and stays quiet once `minimum_chrome_version` in the manifest is at least 148 (152 with a `devtools_page`). A dev session prints the same warning only for a `devtools_page`, since the browser it launches can still be below 152.

### License

MIT (c) Cezar Augusto
