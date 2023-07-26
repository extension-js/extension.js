[action-image]: https://github.com/cezaraugusto/webpack-browser-extension-html-plugin/workflows/CI/badge.svg
[action-url]: https://github.com/cezaraugusto/webpack-browser-extension-html-plugin/actions?query=workflow%3ACI
[npm-image]: https://img.shields.io/npm/v/webpack-browser-extension-html-plugin.svg
[npm-url]: https://npmjs.org/package/webpack-browser-extension-html-plugin

> # This plugin is experimental and not ready for production yet.

# webpack-browser-extension-html-plugin [![workflow][action-image]][action-url] [![npm][npm-image]][npm-url]

> webpack plugin to handle HTML assets for browser extensions

Handle HTML assets for browser extensions by utilizing the HTML fields declared in the manifest.json file as the source for webpack. It treats each `<script>` tag declared in the HTML as an entry point, and all assets specified within the HTML scope through `src` and `href` attributes are output as static assets to the destination folder.

Additionally, if the project directory contains a `static/` folder, this plugin will copy all files from that folder and include them as static assets in a `/static/` folder within the output.

> **Note:** To enable Hot Module Replacement (HMR), you will need to use a reload plugin like [webpack-target-webextension](https://github.com/awesome-webextension/webpack-target-webextension). See [demo]([./demo](./demo).

## Supports

- Action page: refers to [`action.default_popup`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/action)
- Background page: refers to [`background.page`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- URL overrides: refers to [`chrome_url_overrides.bookmarks`, `chrome_url_overrides.history`, and `chrome_url_overrides.newtab`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/chrome_url_overrides)
- Browser Action: refers to [`browser_action.default_popup`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_action)
- Devtools page: refers to [`devtools_page`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/devtools_page)
- Options page: refers to [`options_ui.page]`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/options_ui)
- Page action: refers to [`page_action.default_popup`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/page_action)
- Settings page: refers to [`chrome_settings_overrides.homepage`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/chrome_settings_overrides)
- Sidebar page: refers to [`sidebar_action.default_panel`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action)

## Install

```
yarn add webpack-browser-extension-html-plugin
```

## Usage

Check the [demo](./demo/) folder for a list of possible scenarios.

```js
// webpack.config.js

const HtmlPlugin = require('webpack-browser-extension-html-plugin')

module.exports = {
  // ...other webpack config,
  plugins: [
    new HtmlPlugin({
      manifestPath: '<path-to-my-manifest-json-file>'
    })
  ]
}
```

## What this plugin do?

Given a manifest, grab all possible HTML fields and output them to your webpack output path accordingly, along with `<script>`, `<link>`, and other static assets.

```json5
// manifest.json (partial)
{
  browser_action: {
    default_icon: {
      '16': 'public/icon/test_16.png',
      '32': 'public/icon/test_32.png',
      '48': 'public/icon/test_48.png',
      '64': 'public/icon/test_64.png'
    },
    default_popup: 'my-popup-page.html',
    default_title: 'Popup Test'
  }
}
```

Consider a popup HTML file with the following config.

```js
// webpack.config.js

const HtmlPlugin = require('webpack-browser-extension-html-plugin')

module.exports = {
  // ...other webpack config,
  plugins: [
    new HtmlPlugin({
      manifestPath: '<path-to-my-manifest-json-file>',
      output: {
        action: 'popup_public_path'
        /* see #options below */
      }
    })
  ]
}
```

```html
<!-- my-popup-page.html -->
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>My Popup page</title>
    <link rel="stylesheet" href="popup_style.css" />
    <script src="popup_script_1.js"></script>
    <script src="popup_script_2.js"></script>
  </head>
  <body>
    Hello popup!
  </body>
</html>
```

After running the plugin, we generate a file `popup_public_path/action.my-popup-page.html` like:

```html
<!-- popup/index.html -->
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>My Popup page</title>
    <link rel="stylesheet" href="/popup_public_path/popup_style.css" />
    <!-- assets are now resolved -->
    <script src="/popup_public_path/popup_script_1.js"></script>
    <script src="/popup_public_path/popup_script_2.js"></script>
  </head>
  <body>
    Hello popup!
  </body>
</html>
```

And the output folder without hot-module-replacement, including icons declared along with the action object:

```
- my_extension_output/
  - popup_public_path/
    - action.popup_style.css
    - action.hmr-bundle.js
    - action.test_16.png
    - action.test_32.png
    - action.test_48.png
    - action.test_64.png
```

Output folder with hot-module-replacement:

```
- my_extension_output/
  - popup_public_path/
    - action.action.popup_style.css
    - action.popup_script_1.js
    - action.popup_script_2.js
    - action.test_16.png
    - action.test_32.png
    - action.test_48.png
    - action.test_64.png
```

### Automatic static/ path detection.

If you want to prevent webpack from compiling some files (usually static assets), create a "/static" folder in your project root and the plugin will copy its contents to the output path.

## Options

```js
new HtmlPlugin({
  // Manifest input file (required)
  manifestPath: '<path-to-my-manifest-json-file>'
})
```

## License

MIT (c) Cezar Augusto.
