# webpack-target-webextension

[![npm-version](https://img.shields.io/npm/v/webpack-target-webextension.svg)](https://www.npmjs.com/package/webpack-target-webextension)

This webpack 5 plugin (works on rspack!) provides reasonable presets and fixes things that don't work for a Web Extension.

If you are looking for webpack 4 support, please install 0.2.1. [Document for 0.2.1](https://github.com/awesome-webextension/webpack-target-webextension/tree/a738d2ce96795cd032eb0ad3d6b6be74376550db).

The list of things we fixed in this plugin:

- Code splitting (chunk loader)
- Hot Module Reload
- Public path

## A quick guide

If you are familiar with WebExtension and webpack, this is a quick guide on how to configure this plugin and your `manifest.json`.

> webpack.config.js

```js
module.exports = {
    context: __dirname,
    entry: {
        background: join(__dirname, './src/background/index.js'),
        content: join(__dirname, './src/content-script/index.js'),
        options: join(__dirname, './src/options-page/index.js'),
    },
    output: {
        path: join(__dirname, './dist'),
    },
    plugins: [
        new HtmlPlugin({ filename: 'options.html', chunks: ['options'] }),
        new WebExtension({
            background: { pageEntry: 'background' },
        }),
        new CopyPlugin({
            patterns: [{ from: 'manifest.json' }],
        }),
    ],
}
```

> manifest.json

```jsonc
{
  "manifest_version": 3,
  "name": "Your extension",
  "version": "1.0.0",
  "background": {
    "service_worker": "./background.js"
 },
  // ⚠ Those files can be accessed by normal websites too.
  "web_accessible_resources": [
 {
      "resources": ["/*.js"],
      "matches": ["<all_urls>"]
 },
    // only needed for development (hot module reload)
 {
      "resources": ["/hot/*.js", "/hot/*.json"],
      "matches": ["<all_urls>"]
 }
 ],
  "content_scripts": [
 {
      "matches": ["<all_urls>"],
      "js": ["./content.js"]
 }
 ],
  "permissions": ["scripting"],
  "host_permissions": ["<all_urls>"],
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
 }
}
```

You can also refer to [./examples/react-hmr](./examples/react-hmr) which is a working project.

## How to configure

### Code splitting

#### Content script

To load an async chunk in content scripts, you need to configure the chunk loader.

##### (default) dynamic `import()`

Compatibility: at least [Firefox 89](https://bugzilla.mozilla.org/show_bug.cgi?id=1536094) and Chrome 63.

To disable this loader, you can set [`output.environment.dynamicImport`](https://webpack.js.org/configuration/output/#outputenvironment) to `false`.

You MUST add your JS files to `web_accessible_resources` in the `manifest.json`, otherwise the `import()` call will fail.

> [!WARNING]
> Adding files to [`web_accessible_resources`](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources) allows normal websites to fetch them.

--------

#### [`chrome.tabs.executeScript`](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-executeScript) (Manifest V2 only)

This method requires [`options.background.pageEntry`](#optionsbackground) to be configured and [`options.background.classicLoader`](#optionsbackground) is not **false** (it defaults to **true**).

--------

#### [`chrome.scripting.executeScript`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript) (Manifest V3 only)

- This method will fall back to `chrome.tabs.executeScript` when there is no `chrome.scripting`.
- This method requires `"scripting"` permission in the `manifest.json`.
- This method requires [`options.background`](#optionsbackground) to be configured.
- This method requires [`options.background.classicLoader`](#optionsbackground) is not **false** (defaults to **true**).

#### [Main world](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ExecutionWorld) content script

You must configure the content script by dynamic `import()`. You also need to set [`output.publicPath`](https://webpack.js.org/configuration/output/#outputpublicpath) manually (like `chrome-extension://jknoiechepeohmcaoeehjaecapdplcia/`, the full URL is necessary).

#### Background worker (Manifest V3)

> [!WARNING]
> This plugin does not work with [`"background.type"`](https://developer.chrome.com/docs/extensions/reference/manifest/background) in `manifest.json` set to `"module"` (native ES Module service worker).
> Tracking issue: [#24](https://github.com/awesome-webextension/webpack-target-webextension/issues/24)

Code splitting is supported for background service workers, but it will **load all chunks** initially.
See <https://bugs.chromium.org/p/chromium/issues/detail?id=1198822>.

To turn off this fix, set [`options.background.eagerChunkLoading`](#optionsbackground) to **false**.
If you turn off this fix, loading an async chunk will be a runtime error.

### Hot Module Reload

> [!WARNING]
> It's not possible to support HMR for Manifest V3 background workers.
>
> You will see
>
>     "[HMR] Update check failed: NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'chrome-extension://...' failed to load."
>
> See <https://bugs.chromium.org/p/chromium/issues/detail?id=1198822>

> [!WARNING]
> The HMR WebSocket server might be blocked by the Content Security Policy, which prevents the reset of the code from being executed.
> Please disable HMR if you experience this problem.

This plugin fixes Hot Module Reload and provides reasonable defaults for DevServer.
Please set `devServer.hot` to `false` to disable HMR support.

To disable this fix, set [`options.hmrConfig`](#optionshmrconfig) to **false**.

You need to add `*.json` to your `web_accessible_resources` to make HMR work.

Example: Draw UI in the content scripts with React and get React HRM. [./examples/react-hmr](./examples/react-hmr)

### Source map

> [!WARNING]
> No `eval` based source map is available in Manifest v3.

> [!WARNING]
> DO NOT add `unsafe-eval` to your CSP in production mode!

To use source maps based on `eval`, you must use Manifest v2 and have `script-src 'self' 'unsafe-eval';` in your [CSP (content security policy)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_security_policy).

### Public path

This plugin fixes the public path whether the `output.path` is set or not.

## Options

### options.background

Example:

```ts
new WebExtensionPlugin({
  background: { pageEntry: 'background', serviceWorkerEntry: 'background-worker' },
})
```

```ts
export interface BackgroundOptions {
  noDynamicEntryWarning?: boolean
  /**
   * The entry point of the background page.
   */
  pageEntry?: string
  /**
   * The entry point of the service worker.
   */
  serviceWorkerEntry?: string
  /**
   * Only affects Manifest V3.
   *
   * Load all chunks at the beginning
   * to workaround the Chrome bug
   * https://bugs.chromium.org/p/chromium/issues/detail?id=1198822.
   *
   * NOT working for rspack.
   *
   * @defaultValue true
   */
  eagerChunkLoading?: boolean
  /**
   * Add the support code that uses
   * `chrome.scripting.executeScript` (MV3) or
   * `chrome.tabs.executeScript` (MV2) when
   * dynamic import does not work for chunk loading
   * in the content script.
   * @defaultValue true
   */
  classicLoader?: boolean
  /**
   * Add a try-catch wrapper around the entry file of serviceWorkerEntry
   * so if the initial code throws, you can still open the console of it.
   *
   * Does not work in rspack.
   *
   * @defaultValue true
   */
  tryCatchWrapper?: boolean
}
```

### options.hmrConfig

Default value: **true**

This option provides reasonable defaults for HMR and DevServer.

### options.weakRuntimeCheck

If you experienced a compatibility issue with any of the following plugins, please this option:

- [mini-css-extract-plugin](https://github.com/webpack-contrib/mini-css-extract-plugin)
- [HtmlWebpackPlugin](https://github.com/jantimon/html-webpack-plugin)

### options.experimental_output

**This is an experimental API. API might change at any time. Please provide feedback!**

#### TLDR: How to use this

##### string

If you don't strictly rely on [run_at](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts#run_at),
set it as the following

```js
export default {
  entry: {
    myContentScript: 'src/contentScript.ts',
  },
  // ...
  plugins: [
    // ...
    new WebExtensionPlugin({
      // ...
      experimental_output: {
        myContentScript: 'cs.js'
      },
    })
  ]
}
```

```jsonc
{
  // ...
  "content_scripts": [
    {
      "matches": ["..."],
      "js": ["cs.js"]
    }
  ]
}
```

##### function

If you cannot use asynchronous loading, set up like below.
This setup requires you to have a `manifest.json` being emitted.

```js
export default {
  entry: {
    myContentScript: 'src/contentScript.ts',
  },
  // ...
  plugins: [
    // ...
    new WebExtensionPlugin({
      // ...
      experimental_output: {
        myContentScript: (manifest, list) => {
          manifest.content_scripts[0].js = list
        }
      },
    })
  ]
}
```

##### object

```js
export default {
  entry: {
    background: 'src/background.ts',
  },
  // ...
  plugins: [
    // ...
    new WebExtensionPlugin({
      // ...
      experimental_output: {
        background: {
          file: 'sw.js',
          touch(manifest, file) {
            manifest.background.service_worker = file
          }
        },
      },
    })
  ]
}
```


#### Explanation

**This is an experimental API.**
**API might change at any time.**
**Please provide feedback!**

This option helps the initial chunk loading of content scripts/the background service worker,
usually needed when `optimization.runtimeChunk` or `optimization.splitChunks.chunks` is used.

This option accepts an object, where the keys are the entry name,
and the value is described below.

This option replaces the HTMLWebpackPlugin where the background service worker and content scripts
do not use HTML to load files.

If the value is a `string` (an output file name), for content scripts, it creates an extra
entry file to load all initial chunks **asynchronously** via dynamic import.
This asynchronous loading behavior is limited to the platform limit and **breaks**
[run_at](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts#run_at).

If the value is a `string` (an output file name), for the background service worker (specified
via `options.background.serviceWorkerEntry`), it creates an extra entry file to load all
initial chunks **synchronously**.

The file name specified MUST NOT be any existing file.

If the value is a `function` (`(manifest: any, chunks: string[]) => void`), it requires
a "manifest.json" in the emitted files and lets you edit it on the fly to include all
the initial chunks. This option does not apply to the background service worker because
`manifest.json` does not accept multiple files.

If the value is an `object` (`{ file: string; touch(manifest: any, file: string): void }`),
it generates a new file (see the behavior of `string` above) and provides a callback to
edit the `manifest.json` (see the behavior of `function` above).

If the value is `false`, it asserts that this entry does not have more than one initial file,
otherwise, it will be a compile error.

If the value is `undefined`, it silences the warning for the background service worker.

You can also change your configuration to avoid `optimization.runtimeChunk` or `optimization.splitChunks.chunks`,
in this case, webpack only generates 1 initial file so you don't need this option.

## Rspack support

Rspack support is provided as a best effort, please open an issue if you have encountered any problems.

Here are known issues:

- `experimental_output` is necessary for chunk splitting.
