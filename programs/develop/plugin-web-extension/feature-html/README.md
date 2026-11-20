[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# feature-html

> Parse, watch, and emit HTML-driven assets for Extension.js pages; consolidate JS/CSS entrypoints and rewrite static URLs.

This module is part of the [Extension.js](https://extension.js.org) project. It processes HTML pages declared by the extension manifest (and additional includes), discovers referenced assets, and emits a predictable, “pure HTML”-like output:

- Injects a single JS bundle per page. A script whose `src` starts with `/` is not bundled and keeps its URL as written.
- Injects a CSS bundle per page when applicable. A stylesheet whose `href` starts with `/` is not bundled and keeps its URL as written.
- Rewrites relative static assets to stable public paths and emits them.
- Preserves `?query`/`#hash` fragments in URLs.

- Emits HTML for pages declared in the manifest and via `includeList`.
- Consolidates local JS/CSS referenced by the HTML into page-level bundles.
- Extension-root URLs (leading `/`) for scripts, styles and static assets stay as written in the page. The file ships at that path from the project or from `public/`, which the special‑folders plugin copies.
- Rewrites relative static assets (images/fonts/etc.) to `assets/<name>.<contenthash>.<ext>`, the name the bundler gives the same file from a stylesheet or an import, so one build ships one copy of it. A nested HTML page keeps `assets/<relative path>`. The script, stylesheet and static files a nested page names are copied as they are under that same hashed name, and the nested page's references point at the copies.
- Tracks every local file a page or a nested page names as a file dependency (a missing one as a missing dependency, a file the build leaves out not at all), and keeps watching while the build has an error, so a save recompiles. In a watch session a copy whose source was edited, deleted or dropped from the page is removed from the output.
- Tells every extension registered through `shared/html-page-extensions.ts` which pages it declared: the entry, the page file and the script files the page names. The plugin adds nothing to a page for a development build by itself. What a dev session adds comes from `plugin-reload`.
- Asks for a dev server restart when the list of scripts or stylesheets of a page changes, and when a script or stylesheet that was missing at startup is created. A live session restarts by itself.
- Gives a Chromium `options_ui` page that opens in the embedded dialog (`open_in_tab` not `true`) a `<link rel="stylesheet" href="/options/dialog-floor.css" data-extension-js="options-dialog-floor">` first in `<head>`, and ships `options/dialog-floor.css` holding `html{min-height:32px}`. It is a file and not a `<style>` tag because an extension policy of `style-src 'self'` blocks an inline style, and the dialog would then never open. Chrome opens that dialog on the page's first non-empty layout and stops drawing a guest shorter than 8px, so a page that paints empty until data arrives would never open it, and a 1px first paint would open it and never grow. Author styles come later and win. Pages that open in a tab, the legacy `options_page`, Gecko and Safari builds are left untouched.

### Path resolution convention (consistent across plugin-web-extension)

- Leading `/` means extension root (public root) relative to the directory containing `manifest.json`.
- Relative paths are resolved from the manifest directory.
- Absolute OS paths are used as-is.

### Public folder convention and early failure

- A reference into the project’s `public/` folder is never emitted here. The special‑folders plugin copies that folder onto the output root, and the page ends up naming the copy by its root URL:
  - `/foo` stays `/foo`
  - a relative reference that lands inside `public/`, such as `./public/foo` from a page at the project root, becomes `/foo`
    This plugin only emits non‑public assets (under `assets/`), and a root URL that names a project file outside `public/`, at that same path.
- A missing popup, options, devtools or background page named by the manifest fails the compilation, since the browser refuses to load such an extension. A missing sandbox or sidebar page warns. A missing page of the `pages/` folder and a missing page that only a script opens, such as a devtools panel, warn by file name, and fail under `EXTENSION_STRICT_REFS=true`.
- A page script or stylesheet with no file warns and is left out of the page, the same way in a production build, at dev startup and when the file is deleted while the session runs. `EXTENSION_STRICT_REFS=true` makes it an error.
- Missing static assets referenced from within HTML (that are not produced by other plugins) generate warnings during compilation so you can iterate without a hard stop.
- The hint “A path starting with '/' resolves from the extension root, so the file must sit at that path in your project or in public/.” is shown only when the original HTML attribute used an extension‑root absolute path (leading '/'). Relative paths and absolute filesystem paths do not show this hint. A nested page (an `.html` file another page links to) gets the same warning, with the missing file named, once per page.

### Output mapping

| Source                                      | Output path                         | Notes                                                  |
| ------------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| Manifest/Include HTML (`<feature>`)         | `<feature>.html`                    | E.g., `pages/main` → `pages/main.html`                 |
| Consolidated JS                             | `<feature>.js`                      | E.g., `pages/main.js`                                  |
| Consolidated CSS                            | `<feature>.css`                     | E.g., `pages/main.css`                                 |
| Relative static assets referenced by HTML   | `assets/<name>.<contenthash>.<ext>` | One copy, shared with stylesheets and imports          |
| Extension-root assets in HTML (leading `/`) | the same path, URL kept as written  | E.g., `<img src="/img/logo.png">` ships `img/logo.png` |

### Page encoding

Every page is written as UTF-8. A page saved in another encoding is decoded from the charset it declares, by a byte order mark or a `<meta charset>` in its first 1024 bytes, and the built page declares `utf-8`. The build warns with `W_HTML_NOT_UTF8` and names the file. A page that is not UTF-8 and declares no charset the runtime can decode ships with a replacement character for each byte that is not UTF-8, under the same warning. Saving the file as UTF-8 ends the warning.

## Supported pages/fields

| Feature                            | Output folder/page            | Description                                 |
| ---------------------------------- | ----------------------------- | ------------------------------------------- |
| `action.default_popup`             | `action/index.html`           | Popup HTML (MV2/3, unified).                |
| `page_action.default_popup`        | `action/index.html`           | Popup HTML (MV2, unified).                  |
| `sidebar_action.default_panel`     | `sidebar/index.html`          | Sidebar (MV2/Firefox, unified).             |
| `side_panel.default_path`          | `sidebar/index.html`          | Side panel (MV3, unified).                  |
| `options_ui.page` / `options_page` | `options/index.html`          | Options UI/page (MV2/3, unified).           |
| `devtools_page`                    | `devtools/index.html`         | DevTools extension page.                    |
| `sandbox.page`                     | `sandbox/page-<n>.html`       | Sandboxed HTML pages.                       |
| `background.page`                  | `background/index.html`       | Background HTML page (MV2).                 |
| `chrome_url_overrides.*`           | `chrome_url_overrides/*.html` | Override New Tab/Bookmarks/History.         |
| Include list entries               | `pages/<route>.html`          | Nested paths preserved; `/index` collapses. |

### pages/ routing and output mapping

- The `pages/` special folder supports nested routes similar to Next.js conventions.
- Mapping rules:
  - `pages/foo.html` → `pages/foo.html`
  - `pages/blog/post.html` → `pages/blog/post.html`
  - `pages/welcome/index.html` → `pages/welcome.html`
  - `pages/index.html` → `pages/index.html`
- This allows authors to structure pages predictably without manifest entries.

## Usage

The plugin compiles the pages of its `includeList` and reads no page from the manifest by itself. Inside Extension.js the list comes from `plugin-web-extension`, which collects the manifest pages, the `pages/` folder and the pages a script opens.

```ts
import * as path from 'path'
import {HtmlPlugin} from './feature-html'

type FilepathList = Record<string, string | string[]>

const includeList: FilepathList = {
  // feature name → absolute path to HTML entry
  'pages/main': path.resolve(__dirname, 'pages/main.html')
}

export default {
  plugins: [
    new HtmlPlugin({
      manifestPath: path.resolve(__dirname, 'manifest.json'),
      includeList,
      browser: 'chrome'
    })
  ]
}
```

## Include semantics

- `includeList`: map of feature names to absolute HTML file paths. Each entry becomes a page. The feature name dictates output paths: `feature.html`, `feature.js`, `feature.css`.

## Compatibility

- Typed against `@rspack/core` and tested with Rspack.
- Webpack 5: might work but not officially supported here.

## Links

- Extension.js: https://extension.js.org

## License

MIT (c) Cezar Augusto
