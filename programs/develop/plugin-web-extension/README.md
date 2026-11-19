[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-web-extension

> The Rspack-based engine for the Extension.js development commands.

Builds your extension into a shippable bundle. Pages get one script and optional CSS. Content scripts are isolated. Manifest paths are correct. Icons, assets, locales, and JSON are included. Watch mode surfaces structure changes early so what you run locally matches what you ship. Powered by [Rspack](https://rspack.dev).

### Feature overview

|                                                                            | Feature                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **HTML pages**<br/>Emits HTML pages, injects one JS and optional CSS per page, preserves public root URLs, and rewrites relative assets to stable public paths.     |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Scripts**<br/>Creates entries for background/service worker/content/user scripts, wraps content scripts for isolation and HMR, and ensures reliable public paths. |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Chunk loading**<br/>Loads lazy chunks the way each world of an extension allows: a native import in the isolated world, a bridge in the MAIN world.                    |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Manifest**<br/>Emits a normalized manifest, validates references, and rewrites paths so shipped files match what the store and runtime expect.                    |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Icons**<br/>Emits all icon sizes and variants into the correct folders and watches for changes during development.                                                |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Web resources**<br/>Collects assets imported by content scripts and adds them to `web_accessible_resources` so pages can safely access them.                      |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **JSON assets**<br/>Emits rulesets and other JSON files (e.g., DNR, managed schema) and keeps them in sync during development.                                      |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Locales**<br/>Discovers `_locales/**/messages.json` and ships them where browsers expect for localized UI.                                                        |

Feature-local architecture notes live next to each feature. For the scripts pipeline, see `feature-scripts/README.md`.

Chunk loading is the one feature `WebExtensionPlugin` does not apply itself. `feature-chunk-loading` exports `SetupChunkLoadingTarget`, which `rspack-config.ts` registers after this plugin. It applies the target once in every build. A dev session asks it for the message fallback through `shared/chunk-loading-target-extensions.ts`, and no part of this plugin asks whether a build is a reload session. See `feature-chunk-loading/README.md`, which also carries the notice for the code derived from `webpack-target-webextension`.

### Usage

```ts
import {WebExtensionPlugin} from './plugin-web-extension'

export default {
  plugins: [
    new WebExtensionPlugin({
      manifestPath: '/abs/path/to/manifest.json',
      browser: 'chrome'
    })
  ]
}
```

### API

```ts
export class WebExtensionPlugin {
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
    devSession?: boolean
    define?: Record<string, unknown>
  })
  apply(compiler: import('@rspack/core').Compiler): void
}
```

## License

MIT (c) Cezar Augusto
