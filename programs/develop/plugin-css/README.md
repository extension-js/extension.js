[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-css

> Automatically wires CSS handling into the Rspack build used by Extension.js. It:

- Detects CSS entries and applies targeted pipelines for HTML and content scripts
- Adds optional SASS/LESS support and PostCSS when present
- Integrates Stylelint when a config exists

|                                                                            | Feature                                                                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Content script CSS**<br/>Emits CSS as assets and wires HMR; plays nicely with Shadow DOM wrappers. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **HTML CSS**<br/>Standard CSS handling for HTML entries.                                             |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **SASS/LESS (optional)**<br/>Auto‑enables when dependencies exist; emits as assets for scripts.      |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Stylelint (optional)**<br/>Enables style linting if installed/configured.                          |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **PostCSS (optional)**<br/>Auto‑enables for Tailwind/PostCSS config.                                 |

### Usage

```ts
import {CssPlugin} from '@/webpack/plugin-css'

export default {
  plugins: [
    new CssPlugin({
      manifestPath: '/abs/path/to/manifest.json'
    })
  ]
}
```

### API

```ts
export class CssPlugin {
  static readonly name: 'plugin-css'
  constructor(options: {manifestPath: string})
  apply(compiler: import('@rspack/core').Compiler): Promise<void>
}
```
