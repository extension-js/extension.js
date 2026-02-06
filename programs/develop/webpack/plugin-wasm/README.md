[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-wasm

> WebAssembly defaults for Extension.js builds: async wasm, `.wasm` resolution, and runtime asset aliases.

### What it does

- **Async wasm**: Enables `experiments.asyncWebAssembly` for the updated wasm spec.
- **Resolution**: Ensures `.wasm` is resolvable by default.
- **Runtime aliases**: Injects stable aliases for wasm runtime assets (ffmpeg, tesseract, imagemagick).
- **Alias safety**: Preserves existing user aliases and only fills missing defaults.

### Feature overview

|                                                                            | Feature                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Async WebAssembly**<br/>Enables async wasm modules required by libs.  |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **.wasm resolution**<br/>Ensures `resolve.extensions` includes `.wasm`. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Runtime aliases**<br/>Stable aliasing for wasm-related assets.        |

### Usage

```ts
import {WasmPlugin} from '@/webpack/plugin-wasm'

export default {
  plugins: [
    new WasmPlugin({
      manifestPath: '/abs/path/to/manifest.json',
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'development'
    })
  ]
}
```

### API

```ts
export class WasmPlugin {
  static readonly name: 'plugin-wasm'
  constructor(options: {
    manifestPath: string
    mode: 'development' | 'production'
  })
  apply(compiler: import('@rspack/core').Compiler): void
}
```
