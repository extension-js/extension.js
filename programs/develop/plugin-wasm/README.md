[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-wasm

> WebAssembly defaults for Extension.js builds: `.wasm` resolution and runtime asset aliases.

### What it does

- **Async wasm**: Leaves `experiments.asyncWebAssembly` to rspack, which turns it on by default. Setting `experiments.asyncWebAssembly: false` from the `config` function in `extension.config.js` turns wasm modules off.
- **Resolution**: Appends `.wasm` to `resolve.extensions` and keeps the entries already there.
- **Runtime aliases**: For eight known runtime files of `@ffmpeg/core`, `@ffmpeg/core-mt`, `@imagemagick/magick-wasm` and `tesseract-wasm`, adds an alias to the first copy found in a `node_modules` folder above the project, then above the process folder. The alias bypasses the package's `exports`, finds a copy installed only above the process folder, and makes every importer use that one copy.
- **Alias safety**: Preserves existing user aliases and only fills missing defaults.
- **Bytes on request**: `import url from './x.wasm?url'` emits the binary under `assets/` and returns its URL, for Emscripten-style loaders that fetch their own bytes (handled by the static-assets `?url` rule).
- **Budget**: a `.wasm` binary only extension pages and workers reach is budgeted as `wasm` (32 MiB) by the perf-budgets plugin, so a vendor runtime such as onnxruntime or ffmpeg builds without a warning. One a content script or the service worker reaches keeps the `runtime` budget (1 MiB). Raise `perfBudgets.wasm` or list a file under `perfBudgets.ignore` in `extension.config.js` to change that.

### Feature overview

|                                                                            | Feature                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **.wasm resolution**<br/>Ensures `resolve.extensions` includes `.wasm`. |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Runtime aliases**<br/>Stable aliasing for wasm-related assets.        |

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
  // rspack calls apply(compiler). `cwd` is the second folder the alias walk starts from.
  apply(compiler: import('@rspack/core').Compiler, cwd?: string): void
}
```
