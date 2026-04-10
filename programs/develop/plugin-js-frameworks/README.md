[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-js-frameworks

Automatically wires JS frameworks and TypeScript into the Rspack build used by Extension.js. It:

- Detects frameworks in your `package.json` (React, Preact, Vue, Svelte) and TypeScript
- Configures SWC parsing (JS/TS, JSX/TSX) based on detected dependencies
- Adds framework loaders/plugins and safe aliases to avoid duplicate renderer instances
- Sets `tsconfig` resolution when TypeScript is present
- Defers heavy configuration to `beforeRun` in production

### Feature overview

|                                                                            | Framework                                                                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **React**<br/>Auto‑installs fast refresh (when missing), applies ReactRefresh plugin, and aliases React/DOM/runtime.  |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Preact**<br/>Auto‑installs Prefresh, applies PreactRefresh, and aliases React imports to `preact/compat`.           |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Vue**<br/>Adds `vue-loader` + `VueLoaderPlugin`; supports optional `vue.loader.(js                                  | mjs)` with custom options. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Svelte**<br/>Adds `svelte-loader` rules (including `.svelte.ts`) with dev/HMR defaults; supports `svelte.loader.*`. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **TypeScript**<br/>Ensures `tsconfig.json` exists/loaded, configures SWC parser for TS/TSX when React/Preact present. |

### Usage

```ts
import {JsFrameworksPlugin} from '@/webpack/plugin-js-frameworks'

export default {
  plugins: [
    new JsFrameworksPlugin({
      manifestPath: '/abs/path/to/manifest.json',
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'development'
    })
  ]
}
```

### What the tests cover

- Ensures aliases, SWC rule, framework loaders/plugins, and `tsconfig` are applied in development
- Ensures configuration happens on `beforeRun` in production
- Validates individual detectors for React, Vue, Svelte, and TypeScript

### API

```ts
export class JsFrameworksPlugin {
  static readonly name: 'plugin-js-frameworks'
  constructor(options: {
    manifestPath: string
    mode: 'development' | 'production'
  })
  apply(compiler: import('@rspack/core').Compiler): Promise<void>
}
```
