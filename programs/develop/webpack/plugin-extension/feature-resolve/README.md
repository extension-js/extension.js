[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-resolve

> Make Extension API paths just work.

Rewrites static, developer-authored paths passed to common Extension APIs so they point to emitted files, matching the same rules as `@feature-manifest/` and Special Folders. Part of the [Extension.js](https://extension.js.org) toolchain.

## Usage

```ts
import type {Configuration} from '@rspack/core'
import {ResolvePlugin} from '@/webpack/plugin-extension/feature-resolve'

const config: Configuration = {
  plugins: [
    new ResolvePlugin({
      manifestPath: require('path').resolve(process.cwd(), 'manifest.json')
    })
  ]
}

export default config
```

## Options

- manifestPath: absolute path to `manifest.json`.
- sourceMaps: `'auto' | boolean` (default `'auto'`). Mirrors devtool via loader `this.sourceMap` when `'auto'`.
- browser: target browser; neutral here.
- debug: boolean (default `false`). When true, prints minimal debug logs in development.

### What it does

- Scans JS/TS/JSX/TSX under the manifest directory (excluding `node_modules` and anything under `public/`).
- Parses with `@swc/core` and rewrites static string-like arguments in supported APIs.
- For unresolved canonical paths (e.g., `/public/...`, `pages/...`, `scripts/...`) or nested `pages/`/`scripts/`, emits a warning.
- For missing public assets after rewrite, emits a warning.
- All warnings follow the MESSAGE-GUIDE format: guidance → optional hint → blank line → final PATH/NOT FOUND line, with file context set.

#### Before/After (selected)

```
chrome.tabs.update({ url: '/public/a.html' })
// → { url: 'a.html' }

chrome.scripting.registerContentScripts([{ js: ['/public/a.js', 'scripts/cs.ts'] }])
// → { js: ['a.js', 'scripts/cs.js'] }

chrome.action.setIcon({ path: { 16: '/public/i16.png', 32: '/public/i32.png' } })
// → { path: { 16: 'i16.png', 32: 'i32.png' } }

new chrome.declarativeContent.SetIcon({ path: '/public/i.png' })
// → { path: 'i.png' }
```

### Supported APIs

- runtime.getURL (and extension.getURL)
- action.setIcon, action.setPopup (MV3); browserAction._, pageAction._ (MV2)
- devtools.panels.create(title, iconPath?, pagePath?)
- tabs.create({url}), windows.create({url}), tabs.update({url})
- scripting.registerContentScripts({js, css}), scripting.executeScript({files}), scripting.insertCSS({files})
- tabs.executeScript({file}), tabs.insertCSS({file}) (MV2)
- sidePanel.setOptions({path|panel|page}), sidebarAction.setPanel({panel})
- notifications.create/update({iconUrl,imageUrl})

Additionally, a conservative generic handler runs for any `chrome.*`/`browser.*` call and rewrites path-like keys in object arguments when present: `url`, `file`, `files`, `path`, `popup`, `panel`, `page`, `iconUrl`, `imageUrl`, `default_icon`, `default_popup`, `default_panel`.

### Path mapping rules

- `/public/...`, `public/...`, `/...` → resolves to `...`
- `pages/...` and `scripts/...` (including with a leading `./`) → mapped via `getFilename(key, abs, {})` relative to the `package.json` root.
  - Must be at project root. Nested forms like `src/pages/...` or `components/scripts/...` are not supported and will warn.

### Reliability

- Static string literals, static template literals, and simple `+` concatenations of static strings are rewritten.
- HTTP/Data/Chrome/moz-extension URLs and glob patterns are ignored.
- Transform is printer-driven and produces sourcemaps.

### Diagnostics (examples)

Unresolved nested path under src/:

```
Check the path used in your extension API call.

NOT FOUND /abs/project/src/pages/welcome.html
```

Missing public asset after rewrite:

```
Check the path used in your extension API call.
Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.

NOT FOUND /abs/project/.../public/icon.png
```

### Performance

- Fast pre-scan: skips parsing when no eligible patterns (`chrome.`, `browser.`, `getURL(`, `/public/`, `pages/`, `scripts/`).
- Per-file memoization to avoid repeated literal resolution during a single transform.
- Files under `public/` are skipped early.

### Limitations

- Only static cases are rewritten; dynamic expressions are ignored.
- Root-level `pages/` and `scripts/` are mandatory. Nested forms warn and are not rewritten.

### API

```ts
export type FilepathList = Record<string, string | string[]>

export class ResolvePlugin {
  constructor(options: {
    manifestPath: string
    sourceMaps?: 'auto' | boolean
    browser?:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'safari'
      | 'chromium-based'
      | 'gecko-based'
  })
  apply(compiler: import('@rspack/core').Compiler): void
}

// Loader options type (when using loader directly)
export type ResolvePathsOptions = {
  manifestPath: string
  sourceMaps?: 'auto' | boolean
  debug?: boolean
}
```

### Compatibility

- Typed against `@rspack/core` and tested with Rspack.
- Webpack 5 may work but isn’t officially supported here.

### Tests

```bash
# Focused suites
pnpm -C programs/develop test -- webpack/plugin-extension/feature-resolve/__spec__/handlers.spec.ts
pnpm -C programs/develop test -- webpack/plugin-extension/feature-resolve/__spec__/loader-stress.spec.ts

# Run full feature-resolve suite
pnpm -C programs/develop test -- webpack/plugin-extension/feature-resolve/__spec__/*.spec.ts
```

### License

MIT (c) Cezar Augusto
