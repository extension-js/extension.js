[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-html

> Parse, watch, and emit HTML-driven assets for Extension.js pages; consolidate JS/CSS entrypoints and rewrite static URLs.

This module is part of the [Extension.js](https://extension.js.org) project. It processes HTML pages declared by the extension manifest (and additional includes), discovers referenced assets, and emits a predictable, “pure HTML”-like output:

- Injects a single JS bundle per page (preserving public-root `<script src="/...">`).
- Injects a CSS bundle per page when applicable (preserving public-root `<link href="/...">`).
- Rewrites relative static assets to stable public paths and emits them.
- Preserves `?query`/`#hash` fragments in URLs.

- Emits HTML for pages declared in the manifest and via `includeList`.
- Consolidates local JS/CSS referenced by the HTML into page-level bundles.
- Preserves public-root absolute URLs (leading `/`) for scripts/styles and warns if missing under `public/`.
- Rewrites relative static assets (images/fonts/etc.) under `assets/<relative path>` while preserving directory structure and extensions.
- Tracks file dependencies to recompile on change, provides HMR hooks for local scripts during development, and warns if page entry lists change (restart required).

### Path resolution convention (consistent across @plugin-extension)

- Leading `/` means extension root (public root) relative to the directory containing `manifest.json`.
- Relative paths are resolved from the manifest directory.
- Absolute OS paths are used as-is.

### Public folder convention and early failure

- Public-root references are resolved to the project’s `public/` folder:
  - `/foo` → `<project>/public/foo`
  - `./public/foo` → `<project>/public/foo`
  - `public/foo` → `<project>/public/foo`
    Emitted output preserves the `public/` structure where applicable and keeps relative assets under `assets/`.
- Missing HTML entrypoints referenced by the manifest fail the compilation via the manifest feature checks and are printed to stderr before any browser launch.
- Missing static assets referenced from within HTML (that are not produced by other plugins) generate warnings during compilation so you can iterate without a hard stop.

### Output mapping

| Source                                    | Output path                         | Notes                                        |
| ----------------------------------------- | ----------------------------------- | -------------------------------------------- |
| Manifest/Include HTML (`<feature>`)       | `<feature>.html`                    | E.g., `pages/main` → `pages/main.html`       |
| Consolidated JS                           | `/<feature>.js`                     | E.g., `/pages/main.js`                       |
| Consolidated CSS                          | `/<feature>.css`                    | E.g., `/pages/main.css`                      |
| Relative static assets referenced by HTML | `/assets/<relative path from HTML>` | Preserves directory structure and extensions |
| Public-root assets in HTML (leading `/`)  | preserved as-is                     | E.g., `<img src="/img/logo.png">`            |

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

Typical usage:

```ts
import {HtmlPlugin} from '@/webpack/plugin-extension/feature-html'

export default {
  plugins: [
    new HtmlPlugin({
      manifestPath: '/abs/path/to/manifest.json'
    })
  ]
}
```

Standalone (manual lists):

```ts
import * as path from 'path'
import {HtmlPlugin} from '@/webpack/plugin-extension/feature-html'

type FilepathList = Record<string, string | string[]>

const includeList: FilepathList = {
  // feature name → absolute path to HTML entry
  'pages/main': path.resolve(__dirname, 'pages/main.html')
}

const excludeList: FilepathList = {
  // exclude public-root html/css/js/img paths from rewriting/emission
  html: [path.resolve(__dirname, 'html/file.html')],
  css: [path.resolve(__dirname, 'css/file.css')],
  js: [path.resolve(__dirname, 'js/file.js')],
  img: [path.resolve(__dirname, 'img/icon.png')]
}

export default {
  plugins: [
    new HtmlPlugin({
      manifestPath: path.resolve(__dirname, 'manifest.json'),
      includeList,
      excludeList,
      browser: 'chrome'
    })
  ]
}
```

## Include/Exclude semantics

- `includeList`: map of feature names to absolute HTML file paths. Each entry becomes a page. The feature name dictates output paths: `feature.html`, `/feature.js`, `/feature.css`.
- `excludeList`: map of paths or subpaths to skip. If a resource (HTML/CSS/JS/static) matches a value in `excludeList`, the plugin preserves it (for public-root) or avoids re-emitting it.

## Compatibility

- Typed against `@rspack/core` and tested with Rspack.
- Webpack 5: might work but not officially supported here.

## Links

- Extension.js: https://extension.js.org

## License

MIT (c) Cezar Augusto
