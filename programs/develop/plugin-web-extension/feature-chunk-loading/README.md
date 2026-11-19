# `feature-chunk-loading`

`feature-chunk-loading` is the chunk loading target of `plugin-web-extension`.

The bundler loads a lazy chunk by appending a `<script>` to the host page. That script runs in the page's MAIN world, so a content script in the isolated world never receives its chunk. This feature replaces that loader with one each world of an extension can use.

It is responsible for:

- loading an isolated world chunk through a native `import()` of a `chrome.runtime.getURL()` address
- loading a MAIN world chunk by URL, with the isolated world bridge as its fallback (on Gecko a failed import has no fallback, so no fallback names the extension)
- exposing the extension API of the current world to the runtime under one name, with a stand-in where no API exists
- rejecting an output file whose name starts with `_`, which a browser refuses to load (`_locales/` and `_metadata/` pass)

Reload and HMR are NOT part of this feature. They live in `programs/develop/plugin-reload`, which reaches this feature only through `shared/chunk-loading-target-extensions.ts`. Nothing in this folder imports from `plugin-reload` or asks whether a build is a reload session.

## Entry point

`index.ts` exports `SetupChunkLoadingTarget`. `rspack-config.ts` applies it after `WebExtensionPlugin`, because the output name check must tap `processAssets` after the steps that emit locales, JSON and icons.

`SetupChunkLoadingTarget` is the one owner of the target and installs it once in every build. A plugin applied before it may ask for the message fallback through `extendChunkLoadingTarget` in `shared/chunk-loading-target-extensions.ts`, and names the background that answers it. `plugin-reload` asks in a live dev session, with the background it generated when the manifest names none:

| Build | Message fallback | Public path module |
| --- | --- | --- |
| Production | off | `steps/add-public-path-runtime-module.ts` |
| Development build with no session (`extension build --mode development`) | off | `steps/add-public-path-runtime-module.ts` |
| Dev session with reload turned off (`EXTENSION_NO_RELOAD=true`) | off | `steps/add-public-path-runtime-module.ts` |
| Dev session | on, asked for by `plugin-reload` | `runtime-modules/public-path.ts` |

A development build compiles a MAIN world content script apart with its imports inlined, so that file has no chunk to load and carries no loader in either kind of development build.

## Important files

- `chunk-loading-target.ts`
  `ChunkLoadingTarget` validates the options, applies the two steps, turns on `output.environment.dynamicImport` unless it is set to `false`, and adds the browser runtime module to every chunk that asks for it.

- `options.ts`
  The options of the target and the shape of the content script metadata.

- `background-entry-name.ts`
  `getBackgroundEntryName` names the entry the authored background runs from, matched against the entries `feature-scripts` creates: `background/service_worker`, `background/scripts` (a page on Gecko and MV2, a worker for MV3 on Chromium) or `background/index` for a background page. It names none when the manifest declares no background that becomes one of those. The message fallback is added to the background the extension point returns, which gets this name first.

- `content-scripts-meta.ts`
  `buildContentScriptsMeta` maps each content script bundle to its world, and pairs a MAIN world bundle with its bridge.

- `steps/chunk-loader.ts`
  `ChunkLoaderRuntime` answers the bundler's request for a script loader and for a public path, and adds the message fallback to the background entry when it is on.

- `steps/no-danger-name.ts`
  `NoDangerNamePlugin`, the output name check.

- `runtime-modules/load-script.ts`
  The loader itself, written per world from the content script metadata.

- `runtime-modules/public-path.ts`
  Sets the public path from `runtime.getURL()`, or from the base the bridge wrote where no runtime exists, and polls for a base the bridge writes later.

- `steps/add-public-path-runtime-module.ts`
  `AddPublicPathRuntimeModule`, the public path module of every build that asks for no message fallback. A worker keeps the configured path.

- `runtime-modules/browser-runtime.ts`
  Finds `browser` or `chrome` and stores it for the other runtime modules.

- `runtime-modules/chunk-loader-fallback.ts`
  The background side of the message fallback. A content script that could not import a chunk sends `WTW_INJECT`, and the background injects the file into the tab and frame that asked.

- `runtime-modules/template-fn.ts`
  Writes a function in the syntax the output environment accepts.

## Options

| Option | Meaning |
| --- | --- |
| `background.pageEntry` | The entry of the background page. |
| `background.serviceWorkerEntry` | The entry of the service worker. It must differ from `pageEntry`. |
| `background.classicLoader` | Adds the message fallback. On unless set to `false`. `SetupChunkLoadingTarget` turns it off unless the fallback was asked for, because a production background can have no bundler runtime to hold the listener. |
| `weakRuntimeCheck` | Accepts a runtime with no extension API, for code a build step evaluates outside a browser. |
| `contentScriptsMeta` | The world of each content script bundle, by output file name. |
| `gecko` | The build targets a Gecko browser. |
| `baseAttribute` | The attribute the bridge of this extension writes the extension base under. |
| `baseScheme` | The one URL scheme the engine of this build serves an extension under. |

## Public path

Two modules can answer the bundler's request for the public path, and both are applied by `SetupChunkLoadingTarget`. The request is answered by the first module that takes it, and no bundle carries both:

- With no message fallback asked for, `steps/add-public-path-runtime-module.ts` is registered ahead of the target and answers. The target's own module never runs.
- With the fallback asked for, that step is not registered, so `runtime-modules/public-path.ts` answers.

The base URI has one writer, `feature-scripts/steps/add-base-uri-runtime-module.ts`, in every build. Both are kept as they are. `chunk-loading-runtime.spec.ts` pins which one writes each value in each world.

## Tests

- `__spec__/setup-chunk-loading-target.spec.ts`, that the target installs once in every build, what asking for the fallback changes, and what a compile emits per world
- `__spec__/get-background-entry-name.spec.ts`, the entry name per manifest shape
- `__spec__/content-scripts-meta.spec.ts`, the world and bridge of each content script
- `__spec__/no-danger-name.spec.ts`, the output name check in a real compile
- `__spec__/chunk-loading-runtime.spec.ts`, which code sets the public path, the base URI and the chunk loader in each world, and that each kind of build installs the target once, read off builds made with the whole plugin list

## Attribution

`chunk-loading-target.ts`, `steps/` and `runtime-modules/` derive from [`webpack-target-webextension`](https://github.com/awesome-webextension/webpack-target-webextension), adapted to Rspack and to the MAIN world. That package is released under the MIT License:

```
Copyright 2020 CRIMX <straybugs@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
