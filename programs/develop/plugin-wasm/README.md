[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-wasm

> WebAssembly defaults for Extension.js builds: `.wasm` resolution.

### What it does

- **Async wasm**: Leaves `experiments.asyncWebAssembly` to rspack, which turns it on by default. Setting `experiments.asyncWebAssembly: false` from the `config` function in `extension.config.js` turns wasm modules off.
- **Resolution**: Appends `.wasm` to `resolve.extensions` and keeps the entries already there.
- **No aliases**: A runtime file of a package such as `@ffmpeg/core`, `@imagemagick/magick-wasm` or `tesseract-wasm` resolves like any other package file. When the package's `exports` hides the file, set `resolve.alias` for it from the `config` function in `extension.config.js`.
- **Bytes on request**: `import url from './x.wasm?url'` emits the binary under `assets/` and returns its URL, for Emscripten-style loaders that fetch their own bytes (handled by the static-assets `?url` rule).
- **Budget**: a `.wasm` binary only extension pages and workers reach is budgeted as `wasm` (32 MiB) by the perf-budgets plugin, so a vendor runtime such as onnxruntime or ffmpeg builds without a warning. One a content script or the service worker reaches keeps the `runtime` budget (1 MiB). Raise `perfBudgets.wasm` for the first case and `perfBudgets.runtime` for the second, or list a file under `perfBudgets.ignore` in `extension.config.js`.

### Feature overview

|                                                                            | Feature                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **.wasm resolution**<br/>Ensures `resolve.extensions` includes `.wasm`. |

### Usage

```ts
import {WasmPlugin} from './plugin-wasm'

export default {
  plugins: [
    new WasmPlugin()
  ]
}
```

### API

```ts
export class WasmPlugin {
  static readonly name: 'plugin-wasm'
  // rspack-config.ts passes the shared plugin options. None is read.
  constructor(options?: {manifestPath: string; mode?: 'development' | 'production'})
  apply(compiler: import('@rspack/core').Compiler): void
}
```
