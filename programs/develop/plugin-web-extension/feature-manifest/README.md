[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# feature-manifest

> Emit, validate, and patch your extension's `manifest.json` during build.

This module handles `manifest.json` in browser extension projects by emitting a normalized manifest, validating referenced files, patching paths to reflect final output locations, adding the manifest to file dependencies for watch mode, and guarding against runtime entrypoint changes that require a restart.

Emits and validates your `manifest.json`, normalizes paths, and rewrites outputs so the final bundle contains correct file locations. It:

- Emits a cleaned `manifest.json` (without `$schema`).
- Rewrites paths for fields like `action`, `background`, `content_scripts`, `devtools_page`, `icons`, `options_*`, `sandbox`, `storage.managed_schema`, `theme`, `user_scripts`, `web_accessible_resources`, and more (see tables below).
- Merges/normalizes groups where needed (e.g., MV3 `web_accessible_resources`).
- Adds the manifest to file dependencies for watch mode.
- Detects runtime entrypoint changes and triggers a dev-server restart when needed.

## Usage

Standalone:

```ts
import * as path from 'path'
import {ManifestPlugin} from './feature-manifest'

export default {
  // ...your (R)Webpack configuration
  plugins: [
    new ManifestPlugin({
      manifestPath: path.resolve(__dirname, 'manifest.json'),
      browser: 'chrome'
    })
  ]
}
```

## API

```ts
export interface PluginInterface {
  manifestPath: string
  browser?: 'chrome' | 'firefox' | 'edge' | 'chromium' | string
}

export class ManifestPlugin {
  constructor(options: PluginInterface & {browser: PluginInterface['browser']})
  apply(compiler: import('@rspack/core').Compiler): void
}
```

### What gets patched

- Common fields: `background.page`, `chrome_url_overrides`, `content_scripts`, `devtools_page`, `icons`, `options_page`, `options_ui.page`, `sandbox.pages`, `storage.managed_schema`, `theme.images`, `user_scripts.api_script`, `web_accessible_resources`, `omnibox`.
- MV2 fields: `background.scripts`, `browser_action`, `page_action`, `sidebar_action`, `chrome_settings_overrides`, `theme_experiment`.
- MV3 fields: `action`, `background.service_worker`, `declarative_net_request`, `side_panel`.

Paths are normalized and rewritten to match the final output structure.

### Development behavior

- If a `content_scripts` entry contains only CSS in development mode, a small JS stub is added to enable HMR of styles.
- When entrypoints (HTML or script lists) change at runtime, the plugin warns and asks the dev server to restart to avoid inconsistent incremental rebuilds.
- Public folder convention: files referenced from `public/` (or `/...` which maps to the extension root) are copied to the output root by the special-folders plugin. Manifest paths declared as `public/foo.png` are rewritten to `foo.png` in the emitted manifest so browsers can load them from the root. For background and sidebar HTML/script entries, Extension.js always emits canonical output paths (see table below), even when the source uses `public/`.
- Leading `/` in manifest paths is treated as extension root (relative to the directory containing `manifest.json`), not the OS filesystem root. This matches industry expectations where `/` denotes public root in web bundles.
- Early failure: manifest-referenced files (icons, JSON, scripts, HTML) are validated during compilation. Missing files cause compilation errors and are logged to stderr before any browser start.
- **Manifest writer order:** `EmitManifest` emits the `manifest.json` asset at `PROCESS_ASSETS_STAGE_PRE_PROCESS`, the `$EXTENSION_*` values are filled in at `PROCESS_ASSETS_STAGE_SUMMARIZE`, and path resolution runs in `UpdateManifest` at `PROCESS_ASSETS_STAGE_SUMMARIZE + 1`. Any other step that reads and rewrites `manifest.json` (the dev defaults, `web_accessible_resources`) must run at a **later** stage (`REPORT` or after) so it reads the manifest with resolved paths and does not overwrite them with source paths. Otherwise the browser can fail with errors like "Side panel file path must exist".
- **One copy of the manifest:** every step reads the `manifest.json` asset of the compilation and writes its result back to that asset. The manifest written to disk is the asset as it stands once every `processAssets` stage is over, in development and in production. A plugin of the project that edits the asset with `compilation.updateAsset('manifest.json', ...)` at any stage therefore has its edit in the output. An edit made before `SUMMARIZE + 1` goes through path resolution like an authored field, and one made at `REPORT` or later is written as is.
- **Checks on authored fields** (deprecated paths, ignored host patterns, content script host access, theme values) read the manifest as the author wrote it, which `EmitManifest` keeps per compilation. The description length check reads the asset at `REPORT`, so it measures the text after the `$EXTENSION_*` values are filled in.

## Output mapping (representative)

| Manifest field                     | Example input                      | Output path example                                |
| ---------------------------------- | ---------------------------------- | -------------------------------------------------- |
| action.default_popup               | popup.html                         | action/index.html                                  |
| action.default_icon                | icons/icon.png                     | icons/icon.png (folder preserved under `icons/`)   |
| background.service_worker (MV3)    | service-worker.ts                  | background/service_worker.js (canonical output)    |
| background.page (MV2/common)       | background.html                    | background/index.html (canonical output)           |
| content_scripts[].js/css           | content/scripts.ts                 | content_scripts/content-<index>.js / .css          |
| devtools_page                      | devtools.html                      | devtools/index.html                                |
| options_ui.page                    | options.html                       | options/index.html                                 |
| page_action.default_popup (MV2)    | popup.html                         | action/index.html                                  |
| sandbox.pages[]                    | sandbox.html                       | sandbox/page-<index>.html                          |
| side_panel.default_path (MV3)      | panel.html                         | sidebar/index.html (canonical output)              |
| side_panel.default_icon (MV3)      | icons/icon16.png                   | icons/icon16.png                                   |
| sidebar_action.default_panel (MV2) | sidebar.html                       | sidebar/index.html (canonical output)              |
| storage.managed_schema             | schema.json                        | storage/managed_schema.json                        |
| theme.images.theme_frame           | images/theme_frame.png             | theme/images/images/theme_frame.png (path kept)    |
| user_scripts.api_script            | api.js                             | user_scripts/api_script.js                         |
| web_accessible_resources (MV3)     | assets imported by content scripts | grouped and merged per matches; deterministic sort |
| web_accessible_resources (MV2)     | assets imported by content scripts | flat array; de-duplicated and sorted               |

Notes:

- JavaScript and CSS extensions are normalized to .js/.css in output.
- A page keeps its authored path when a script of the extension holds that path as a string, for example a background that compares `sender.url` with `/ui/popup/index.html`. The compiled page then ships at the authored path as well as the canonical one, the built manifest opens it at the authored path, and the build prints one line that names the page and the file that holds the string. `background.page` is not kept this way.

### Folder conventions

- icons/\* → `icons/`
- action/default_icon → `icons/` (the icon file path remains under `icons/`)
- browser_action/theme_icons → `browser_action/<path from the manifest>` (a light/dark pair that shares a basename stays two files)
- theme/images → `theme/images/<path from the manifest>`
- html static assets → `assets/<path from the manifest>` (two pages naming their own `./logo.png` stay two files)
- page_action/default_popup → `page_action/`
- options_ui/page → `options_ui/`

## Development server restart guard

When manifest.json changes during watch mode and the effective list of HTML or script entrypoints changes (e.g., a content_scripts item is added/removed), the plugin logs a restart notice and terminates the process to trigger a clean recompile. Look for console messages indicating the affected file and the restart reason.

## Compatibility

- Built and typed against `@rspack/core`.
- Webpack 5: interface is similar and may work, but it is not officially supported by this package.

## License

MIT (c) Cezar Augusto
