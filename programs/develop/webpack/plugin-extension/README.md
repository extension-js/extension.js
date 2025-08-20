[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension

> The Rspack-based engine for the Extension.js development commands.

Builds your extension into a clean, shippable bundle. Pages get one script and optional CSS. Content scripts are isolated. Manifest paths are correct. Icons, assets, locales, and JSON are included. Watch mode surfaces structure changes early so what you run locally matches what you ship. This is the real deal that empowers [Extension.js](https://extension.js.org). Powered by [Rspack](https://rspack.dev).

### Feature overview

|                                                                            | Feature                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **HTML pages**<br/>Emits HTML pages, injects one JS and optional CSS per page, preserves public root URLs, and rewrites relative assets to stable public paths.     |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Scripts**<br/>Creates entries for background/service worker/content/user scripts, wraps content scripts for isolation and HMR, and ensures reliable public paths. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Manifest**<br/>Emits a normalized manifest, validates references, and rewrites paths so shipped files match what the store and runtime expect.                    |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Icons**<br/>Emits all icon sizes and variants into the correct folders and watches for changes during development.                                                |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Web resources**<br/>Collects assets imported by content scripts and adds them to `web_accessible_resources` so pages can safely access them.                      |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **JSON assets**<br/>Emits rulesets and other JSON files (e.g., DNR, managed schema) and keeps them in sync during development.                                      |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Locales**<br/>Discovers `_locales/**/messages.json` and ships them where browsers expect for localized UI.                                                        |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Special folders**<br/>Copies `public/` as is; recognizes `pages/` and `scripts/`; surfaces structure changes early in development.                                |

### Usage

```ts
import {ExtensionPlugin} from '@/webpack/plugin-extension'

export default {
  plugins: [
    new ExtensionPlugin({
      manifestPath: '/abs/path/to/manifest.json',
      browser: 'chrome'
    })
  ]
}
```

### API

```ts
export class ExtensionPlugin {
  static readonly name: 'plugin-extension'
  constructor(options: {
    manifestPath: string
    browser?:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'safari'
      | 'chromium-based'
      | 'gecko-based'
  })
  apply(compiler: import('@rspack/core').Compiler): void
}
```

## License

MIT (c) Cezar Augusto
