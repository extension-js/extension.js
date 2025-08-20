[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-manifest

> Emit, validate, and patch your extension's `manifest.json` during build.

This module handles `manifest.json` in browser extension projects by emitting a normalized manifest, validating referenced files, patching paths to reflect final output locations, adding the manifest to file dependencies for watch mode, and guarding against runtime entrypoint changes that require a restart.

Emits and validates your `manifest.json`, normalizes paths, and rewrites outputs so the final bundle contains correct file locations. It:

- Emits a cleaned `manifest.json` (without `$schema`).
- Rewrites paths for fields like `action`, `background`, `content_scripts`, `devtools_page`, `icons`, `options_*`, `sandbox`, `storage.managed_schema`, `theme`, `user_scripts`, `web_accessible_resources`, and more (see tables below).
- Merges/normalizes groups where needed (e.g., MV3 `web_accessible_resources`).
- Adds the manifest to file dependencies for watch mode.
- Detects runtime entrypoint changes and triggers a dev-server restart when needed.

## Usage

Standalone (manual include/exclude lists):

```ts
import * as path from 'path'
import {ManifestPlugin} from '@/webpack/plugin-extension/feature-manifest'

export default {
  // ...your (R)Webpack configuration
  plugins: [
    new ManifestPlugin({
      manifestPath: path.resolve(__dirname, 'manifest.json'),
      browser: 'chrome',
      includeList: {
        // Map of feature keys to absolute file paths (string or string[])
        // e.g. 'content_scripts/content-0': ['/abs/project/content/script.ts']
      },
      excludeList: {
        // Prevent specific files from being rewritten or validated
        // e.g. 'icons/icon16.png': '/abs/project/public/icon16.png'
      }
    })
  ]
}
```

## API

```ts
export type FilepathList = Record<string, string | string[] | undefined>

export interface PluginInterface {
  manifestPath: string
  includeList?: FilepathList
  excludeList?: FilepathList
  browser?: 'chrome' | 'firefox' | 'edge' | 'chromium' | string
}

export class ManifestPlugin {
  constructor(options: PluginInterface & {browser: PluginInterface['browser']})
  apply(compiler: import('@rspack/core').Compiler): void
}
```

### What gets patched

- Common fields: `background.page`, `chrome_url_overrides`, `content_scripts`, `devtools_page`, `icons`, `options_page`, `options_ui.page`, `sandbox.pages`, `storage.managed_schema`, `theme.images`, `user_scripts.api_script`, `web_accessible_resources`, `omnibox`, `commands`, `permissions`.
- MV2 fields: `background.scripts`, `browser_action`, `page_action`, `sidebar_action`, `chrome_settings_overrides`, `theme_experiment`.
- MV3 fields: `action`, `background.service_worker`, `declarative_net_request`, `host_permissions`, `side_panel`.

Paths are normalized and rewritten to match the final output structure. Files in `excludeList` are left untouched.

### Development behavior

- If a `content_scripts` entry contains only CSS in development mode, a small JS stub is added to enable HMR of styles.
- When entrypoints (HTML or script lists) change at runtime, the plugin warns and asks the dev server to restart to avoid inconsistent incremental rebuilds.
- Public folder convention: files referenced from `public/` (or `/...` which maps to `public/...`) are copied to the output root by the special-folders plugin. Manifest paths declared as `public/foo.png` are rewritten to `foo.png` in the emitted manifest so browsers can load them from the root. To preserve a path exactly, pass it via `excludeList`.
- Early failure: manifest-referenced files (icons, JSON, scripts, HTML) are validated during compilation. Missing files cause compilation errors and are logged to stderr before any browser launch.

## Include/Exclude semantics

- includeList: map of feature keys to absolute file paths (string or string[]). Keys follow the output structure, for example:
  - `action/default_popup`
  - `content_scripts/content-0`
  - `options_ui/page`
  - `background/service_worker`
    Values are absolute file paths. When provided, the plugin uses these lists to validate and, when applicable, rewrite paths.
- excludeList: prevents matching absolute file paths from being rewritten/validated. When a path is in excludeList, it is preserved as-is in the final manifest.

Example:

```ts
import * as path from 'path'
import {ManifestPlugin} from '@/webpack/plugin-extension/feature-manifest'

new ManifestPlugin({
  manifestPath: path.resolve(__dirname, 'manifest.json'),
  includeList: {
    // map output keys to absolute source files
    'content_scripts/content-0': path.resolve(__dirname, 'content/scripts.ts'),
    'options_ui/page': path.resolve(__dirname, 'options.html')
  },
  excludeList: {
    // keep this icon path untouched (e.g., copied from public/)
    'icons/icon16.png': path.resolve(__dirname, 'public/icon16.png')
  }
})
```

## Output mapping (representative)

| Manifest field                     | Example input                      | Output path example                                |
| ---------------------------------- | ---------------------------------- | -------------------------------------------------- |
| action.default_popup               | popup.html                         | action/default_popup.html                          |
| action.default_icon                | icons/icon.png                     | icons/icon.png (folder preserved under `icons/`)   |
| background.service_worker (MV3)    | service-worker.ts                  | background/service_worker.js                       |
| background.page (MV2/common)       | background.html                    | background.html                                    |
| content_scripts[].js/css           | content/scripts.ts                 | content_scripts/content-<index>.js / .css          |
| devtools_page                      | devtools.html                      | devtools_page/devtools_page.html                   |
| options_ui.page                    | options.html                       | options_ui/page.html                               |
| page_action.default_popup (MV2)    | popup.html                         | page_action/default_popup.html                     |
| sandbox.pages[]                    | sandbox.html                       | sandbox/page-<index>.html                          |
| side_panel.default_path (MV3)      | panel.html                         | side_panel/default_path.html                       |
| side_panel.default_icon (MV3)      | icons/icon16.png                   | icons/icon16.png                                   |
| sidebar_action.default_panel (MV2) | sidebar.html                       | sidebar_action/default_panel.html                  |
| storage.managed_schema             | schema.json                        | storage/managed_schema.json                        |
| theme.images.theme_frame           | images/theme_frame.png             | theme/images/theme_frame.png                       |
| user_scripts.api_script            | api.js                             | user_scripts/api_script.js                         |
| web_accessible_resources (MV3)     | assets imported by content scripts | grouped and merged per matches; deterministic sort |
| web_accessible_resources (MV2)     | assets imported by content scripts | flat array; de-duplicated and sorted               |

Notes:

- Files in excludeList are not rewritten.
- JavaScript and CSS extensions are normalized to .js/.css in output.

### Folder conventions

- icons/\* → `icons/`
- action/default_icon → `icons/` (the icon file path remains under `icons/`)
- browser_action/theme_icons → `browser_action/`
- page_action/default_popup → `page_action/`
- options_ui/page → `options_ui/`

## Development server restart guard

When manifest.json changes during watch mode and the effective list of HTML or script entrypoints changes (e.g., a content_scripts item is added/removed), the plugin logs a restart notice and terminates the process to trigger a clean recompile. Look for console messages indicating the affected file and the restart reason.

## Compatibility

- Built and typed against `@rspack/core`.
- Webpack 5: interface is similar and may work, but it is not officially supported by this package.

## License

MIT (c) Cezar Augusto
