# Changelog

## 2.1.3

- Fix experimental_output stack overflow

## 2.1.2

- Fix experimental_output with HMR chunks
- Fix experimental_output stack overflow

## 2.1.1

- Now rspack can use chunk splitting by `experimental_output`.

## 2.1.0

- Add a try-catch wrapper around the entry file of serviceWorkerEntry so if the initial code throws, you can still open the console of it.
  **Enabled by default**, set option `tryCatchWrapper` to `false` to disable it.
- Add `experimental_output` to support service worker/content scripts used with [`splitChunks.chunks`](https://webpack.js.org/plugins/split-chunks-plugin/#splitchunkschunks) or [`optimization.runtimeChunk`](https://webpack.js.org/configuration/optimization/#optimizationruntimechunk).

## 2.0.1

- Fix ServiceWorkerPlugin does not add eager chunks correctly in watch mode.
- Fix `splitChunks: { chunks: 'all', minSize: 1 }` crashes rspack.

## 2.0.0

- Works on rspack now
- (Breaking) Minimal Node.js requirement changed from 14.17.16 to 18.20.5
- (Breaking) Deprecated option `BackgroundOptions.entry` is removed. Use `pageEntry` and/or `serviceWorkerEntry` instead.
- (Breaking) Deprecated option `BackgroundOptions.manifest` is removed.
- (Breaking) Option `noWarningDynamicEntry` has been renamed to `noDynamicEntryWarning`.
- (Breaking) `background.pageEntry` cannot be the same as `background.serviceWorkerEntry`.
- Now `devServer.hot` is set to `only` by default.
- Now `output.environment.dynamicImport` is set to `true` by default.
- Now `output.hotUpdateChunkFilename` is set to `hot/[id].[fullhash].js` by default.
- Now `output.hotUpdateMainFilename` is set to `hot/[runtime].[fullhash].json` by default.

## 1.1.2

- Support main world content script to be bundled. Also added a guide and example for this.

## 1.1.1

- Add [a workaround](https://github.com/awesome-webextension/webpack-target-webextension/pull/42) for [a Chrome bug of loading content script in a sandboxed iframe](https://github.com/awesome-webextension/webpack-target-webextension/issues/41).
- Fix [compatibility with mini-css-extract-plugin in Manifest v3](https://github.com/awesome-webextension/webpack-target-webextension/issues/43)
- Add a warning if `background.pageEntry` and `background.serviceWorkerEntry` are the same.

  The only chunk loading method `serviceWorkerEntry` supports is  `importScripts` ([ES Module is not supported yet](https://github.com/awesome-webextension/webpack-target-webextension/issues/24)) and `pageEntry` only supports `<script>` or `import()`.

  The chunk loading methods they supported have no intersection, therefore this config is impossible to work. This will be a hard error in the next version.

## 1.1.0

- Deprecate `background.entry` and `background.manifest` in the config.
- Add `background.pageEntry` and `background.serviceWorkerEntry` in the config. Now you can build for both [limited event page](https://github.com/w3c/webextensions/issues/134) (used by [Firefox](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts) and Safari) and background service worker (Chrome) in a single webpack build.

### Migrations

If you have

- `background.manifest = 3`,
  1. remove `background.manifest`
  2. change `background.entry` to `background.serviceWorkerEntry`
- `background.manifest = 2` (or `undefined`),
  1. remove `background.manifest`
  2. change `background.entry` to `background.pageEntry`

## 1.0.5

Fix [frameId is missing when injecting content script (#36)](https://github.com/awesome-webextension/webpack-target-webextension/pull/36).

## 1.0.4

Fix [`__webpack_require__.e` is not a function in MV3 (#33)](https://github.com/awesome-webextension/webpack-target-webextension/issues/33).

## 1.0.3

Add `weakRuntimeCheck` option to support using with `mini-css-extract-plugin`.

## 1.0.2

Fix [false positive of `browser` when a dom id is browser (#28)](https://github.com/awesome-webextension/webpack-target-webextension/issues/28).

## 1.0.1

Fix chunk loading in MV3 background worker.

## 1.0.0

We made a big write to support Manifest V3.

### Breaking changes and migration

- Drop Webpack 4 support.
  1. Stay at `v0.2.1` if you cannot upgrade to webpack 5.
     (Webpack 4 support from `0.3.0` to `0.4.4` was broken).
  1. Upgrade to Webpack 5.
  1. Replace `target: WebExtensionTarget({...})` with `target: ["web", "ES2015"]`.
  1. Node polyfills are not supported in webpack 5.
     Please follow the webpack 5 migration guide to shim Node libraries.
  1. Add `new WebExtensionTarget()` to your plugins.
  1. Reconfigure this plugin.
- Drop Node 14- support.
- `webpack-target-webextension/lib/background` has been removed.
  - Remove `import 'webpack-target-webextension/lib/background'` from your project.
  - Configure `background` as in the README documented.
  - If you don't want it anymore, set `background.chunkLoaderFallback` to **false**.
- If you configured your `devServer` as pre-1.0.0 document suggested,
  you can try to remove them. `1.0.0` provides out-of-box auto configure to enable HMR.
  - Set `hmrConfig` to **false** to disable this feature.

## 0.4.4 - 2021-07-25

[Add dynamic import for webpack5. (#20)](https://github.com/awesome-webextension/webpack-target-webextension/pull/20)

## 0.4.3 - 2021-06-12

[Add support for injection in iframe. (#17)](https://github.com/awesome-webextension/webpack-target-webextension/pull/17)
