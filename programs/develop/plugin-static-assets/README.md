[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-static-assets

> Asset rules for images, SVG, fonts and other files, with the `?url` and `?raw` import queries and `.wasm` resolution.

### What it does

- **Asset rules**: Images (`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `ico`, `bmp`), SVG, fonts (`woff`, `woff2`, `eot`, `ttf`, `otf`) and other files (`txt`, `md`, `csv`, `tsv`, `xml`, `pdf`, `docx`, `doc`, `xls`, `xlsx`, `ppt`, `pptx`, `zip`, `gz`, `gzip`, `tgz`) are `asset` modules. `new URL('./file', import.meta.url)` follows the same rules.
- **2 KB inline threshold**: A file of 2048 bytes or less becomes a `data:` URI in the bundle. A larger one is emitted and the import returns its URL. The threshold is the same for every kind above (rspack's own default is 8096 bytes).
- **Names**: Emitted files are named `assets/[name].[contenthash:8][ext]` in development and production. When the config sets no `output.assetModuleFilename`, the plugin sets it to the same pattern, so a file no rule claims (a `.mp4` reached by `new URL()`) lands under `assets/` too.
- **`?url`**: `import u from './logo.png?url'` always emits the file and returns its URL, whatever its size.
- **`?raw`**: `import text from './notes.md?raw'` returns the file's text as the default export, for any extension (`.ts`, `.js` and `.css` included, the compiling rules step aside).
- **Namespace imports**: `import * as t from './notes.txt'` read as a value (`String(t)`, `` `${t}` ``) is a build error named `NamespaceImportReadAsValue`, since it reaches the browser as `[object Module]`. `t.default`, `t?.default` and `typeof t` build fine. Imports from `node_modules` are not checked.
- **User rules**: A rule in `extension.config.js` with a RegExp `test` and a `type`, `use` or `loader` owns its extensions, and the defaults keep the rest (a `.png` rule leaves `.jpg` to them). A rule scoped by `resourceQuery` claims only that query (SVGR's `?react`). A rule scoped by `include`, `exclude`, `resource`, `issuer` or `issuerLayer`, or an asset-typed rule with a string, array or function `test`, claims only its scope. A user rule whose `resourceQuery` matches `?url` or `?raw` replaces that rule for every file type.
- **Not seen yet**: user rules nested in `oneOf` or `rules`, and a loader rule with a function or array `test`. The default rule still applies after them, and the last matching type wins.

### WebAssembly

- **Modules**: `import('./codec.wasm')` and a static import compile as async WebAssembly modules, which rspack turns on by default. Setting `experiments.asyncWebAssembly: false` from the `config` function in `extension.config.js` turns them off.
- **Resolution**: When the config lists `resolve.extensions`, `.wasm` is appended once and the entries already there are kept. A config with no list is left alone.
- **Bytes on request**: `import url from './codec.wasm?url'` emits the binary under `assets/` and returns its URL, for Emscripten-style loaders that fetch their own bytes.
- **No package aliases**: A runtime file of `@ffmpeg/core`, `@imagemagick/magick-wasm`, `tesseract-wasm` or any other package resolves like every package file. When the package's `exports` hides the file, the build fails with `Package subpath './dist/esm/ffmpeg-core.js' is not defined by "exports"`, and an alias from the `config` function reaches it: `config.resolve.alias['@ffmpeg/core/dist/esm/ffmpeg-core.js'] = path.resolve(__dirname, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js')`.
- **Budget**: The perf-budgets plugin budgets a `.wasm` binary only extension pages and workers reach as `wasm` (32 MiB), and one a content script or the service worker reaches as `runtime` (1 MiB). Raise `perfBudgets.wasm` or `perfBudgets.runtime`, or list the file under `perfBudgets.ignore` in `extension.config.js`.

### Usage

```ts
import {StaticAssetsPlugin} from './plugin-static-assets'

export default {
  plugins: [new StaticAssetsPlugin()]
}
```

### API

```ts
export class StaticAssetsPlugin {
  static readonly name: 'plugin-static-assets'
  // rspack-config.ts passes the shared plugin options. None is read.
  constructor(options?: {manifestPath: string; mode?: 'development' | 'production'})
  apply(compiler: import('@rspack/core').Compiler): void
}
```

`static-assets-lib/asset-output-name.ts` exports `bundledAssetOutputName`, which computes the name these rules give a file, so the HTML and web-accessible-resources steps can point at the same copy.
