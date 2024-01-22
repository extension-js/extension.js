[action-image]: https://github.com/cezaraugusto/webpack-browser-extension-scripts-plugin/workflows/CI/badge.svg
[action-url]: https://github.com/cezaraugusto/webpack-browser-extension-scripts-plugin/actions?query=workflow%3ACI
[npm-image]: https://img.shields.io/npm/v/webpack-browser-extension-scripts-plugin.svg
[npm-url]: https://npmjs.org/package/webpack-browser-extension-scripts-plugin

# webpack-browser-extension-scripts-plugin [![workflow][action-image]][action-url] [![npm][npm-image]][npm-url]

> webpack plugin to handle manifest script assets (content_scripts, background.scripts, service_worker, user_scripts) from browser extensions

Properly output script files based on the manifest fields declared in the manifest file.

## Supports

- **Background scripts:** refers to [`background.scripts`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- **Content scripts:** refers to [`content_scripts`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts)
- **Service Worker script (V3):** refers to [`background.service_worker`](https://developer.chrome.com/docs/extensions/mv3/service_workers/)
- **User scripts:** refers to [`user_scripts`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/user_scripts)

## Install

```
npm i webpack-browser-extension-scripts-plugin --save-dev
```

## Usage

Check the [demo](./demo/) folder for a list of samples using a HMR plugin.

```js
// webpack.config.js

const ScriptsPlugin = require('webpack-browser-extension-scripts-plugin')

module.exports = {
  // ...other webpack config,
  plugins: [
    new ScriptsPlugin({
      manifestPath: '<path-to-my-manifest-json-file>',
      exclude: ['<path_to_excluded_folder>']
    })
  ]
}
```

## What this plugin do?

Given a manifest file, grab all possible JavaScript fields and add them as [webpack entry points](https://webpack.js.org/concepts/entry-points/#root).

```json
// myproject/manifest.json
{
  "manifest_version": 2,
  "version": "0.1",
  "name": "myextension",
  "author": "Cezar Augusto",
  "background": {
    "scripts": ["background1.js", "background2.js"]
  }
}
```

```js
// myproject/webpack.config.js
const path = require('path')
const ScriptsPlugin =
  require('webpack-browser-extension-scripts-plugin').default

const manifestPath = path.join(__dirname, 'manifest.json')
const outputPath = path.resolve(__dirname, './dist')

module.exports = {
  mode: 'development',
  entry: {},
  output: {
    path: outputPath,
    clean: true
  },
  plugins: [
    new ScriptsPlugin({
      manifestPath
    })
  ]
}
```

**Output:**

```
- myproject/
  - background/index.js
```

## License

MIT (c) Cezar Augusto.
