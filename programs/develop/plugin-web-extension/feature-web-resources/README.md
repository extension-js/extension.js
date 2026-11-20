[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# feature-web-resources

> Adds assets imported by content scripts to `web_accessible_resources` in `manifest.json`.

Emits and registers assets imported by `content_scripts` so pages can access them at runtime. During the build, it scans content script entries and collects auxiliary assets they import (for example images and styles). It then patches `manifest.json` to include those assets under `web_accessible_resources`, grouped by each content script’s `matches`. This module is part of the [Extension.js](https://extension.js.org) project.

`WebResourcesPlugin` collects the imports. The patch itself is `steps/patch-war.ts`, which the manifest plugin places in its own pipeline, after its update and before its warnings, so every later manifest step reads the patched key.

### Output mapping

| Input (source)                                   | Output (dist)           | Notes                                                                                                          |
| ------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| content script imports of images/fonts/etc.      | `assets/*`              | Imported static assets are emitted under `assets/` and added to the relevant `web_accessible_resources` group. |
| content script CSS (if emitted as separate file) | `content_scripts/*.css` | Some setups inject CSS instead of emitting a file; injected CSS will not appear in `web_accessible_resources`. |
| JavaScript and source maps                       | n/a                     | `.js` and `.map` are intentionally excluded from `web_accessible_resources`.                                   |

## Supported manifest fields

| Feature                    | Description                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `content_scripts`          | Reads `matches` and `js` to associate imported assets with the correct content script.                |
| `web_accessible_resources` | Writes/merges groups for MV3 or appends to array for MV2 with assets discovered from content scripts. |

> Note: Fields like `icons`, `action.default_icon`, `browser_action.default_icon`, `browser_action.theme_icons`, `page_action.default_icon`, and `sidebar_action.default_icon` are handled by the Icons feature module (`feature-icons`), not by Web Resources.

## Usage

Standalone (manual lists):

```ts
import * as path from 'path'
import {WebResourcesPlugin} from './feature-web-resources'

export default {
  // ...your rspack/webpack configuration
  plugins: [
    new WebResourcesPlugin({
      manifestPath: path.resolve(__dirname, 'manifest.json'),
      includeList: {
        // Tell the plugin which content script entries to associate
        // The key is the logical entry name; the value(s) are absolute file paths
        'content_scripts:content/scripts': [
          path.resolve(__dirname, 'content/scripts.js')
        ]
      }
    })
  ]
}
```

## Include semantics

- **includeList**: a map of feature keys to absolute file paths (string or string[]). For this plugin, keys typically reference content script entries (e.g., `content_scripts:content/scripts`). It determines which entries are scanned for imported assets.

## Output path mapping (summary)

- Imported static assets from content scripts → `assets/`
- If the build emits content script CSS as files → `content_scripts/*.css`
- `.js` and `.map` are excluded

## Compatibility

- Typed against `@rspack/core` and tested with Rspack.
- Webpack 5 may be compatible (similar compiler interfaces), but is not officially supported here.

## API

```ts
export interface PluginInterface {
  manifestPath: string
  includeList?: Record<string, string | string[]>
}

export class WebResourcesPlugin {
  constructor(options: PluginInterface)
}
```

- Manifest v3: resources are grouped by the exact `matches` set (normalized), merged per group, and sorted deterministically.
- Manifest v2: resources are appended to a flat array, de-duplicated and sorted.
- Source maps (`.map`) and JavaScript outputs (`.js`) are excluded.

## Early‑fail validation (break before the browser)

This feature performs path validation at compile time and surfaces clear messages if a referenced standalone file is missing. When a path begins with `/`, the hint explains that it resolves from the extension output root (served from `public/`), not your source directory. The goal is to fail fast in development so the browser never shows confusing runtime alerts.

## User-declared WAR behavior

- Relative files are validated and emitted as assets (development: `assets/[name][ext]`, production: `assets/[name].[contenthash:8][ext]`). When a relative path refers to a file that already exists under the project `public/` folder or in the emitted output root, it is treated as valid and normalized, without a “file not found” warning.
- Public-root-like paths (`/foo.png`, `public/foo.png`, `./public/foo.png`) are preserved as `foo.png`. If the referenced file is missing under the project `public/` folder and has not been emitted to the output root, the entry is left out of the manifest. A build and a dev session both warn with the entry as written, name `public/foo.png` as not found and explain that paths starting with `/` resolve from the extension output root (served from `public/`). A copy an earlier build left in the output folder does not count: an entry is present by its source or by a file the current build emits.
- Glob patterns (e.g., `assets/*.svg`, `/*.json`) are preserved as-is. A pattern with a parent segment (`../assets/*`) is reported and left out of the output manifest, since no browser exposes a file for it.
- When a resource is both user-declared and auto-discovered from a content script, it is de-duplicated.

## Files a declared resource never ships

Every file in the build output is readable by anyone who installs the extension, so a declared resource is copied only when it is project content. The rule is `sourceFileMayShip` in `plugin-special-folders/public-private-files.ts`, the same one the root-absolute fallback of pages and stylesheets applies. Nothing is copied for:

- a private name anywhere along the path, in any letter case (`.env`, `.env.local`, `.envrc`, `.npmrc`, `.git/config`, the full table is in the `plugin-special-folders` README),
- a folder entry or a pattern under `node_modules` (a file of an installed package named by its path ships),
- a path that climbs out of the project to a file its workspace does not share (`../outside.txt`, `sub/../../outside.txt`),
- a root path that climbs out of the extension root (`/../outside.txt`, `/%2e%2e/outside.txt`), which a page refuses too,
- a link that resolves outside the project root, into `node_modules` or onto a private name, a workspace folder a package links included.

Each of those gets the warning a missing file gets (`Can't find the file <entry> listed in web_accessible_resources.`), which names the path and never what the file holds. The output manifest does not list the entry, the same as a missing file, and a group or a list left with no resource is left out with it. The warning names the path from the project root.

A folder entry (`icons/`) and a pattern under a folder (`images/*`) apply the same rule to every file they reach. An env file inside one is reported by its own path. OS metadata and repository files (`.DS_Store`, `.gitkeep`) are left out without a word, the way the `public/` copy leaves them out. A pattern with no folder before its first `*` (`*.json`, `/*`, `**/*`) names the built output and copies no source file.

Template env files (`.env.example`), `.well-known/` and every other dot-file ship as authored, and a link that stays inside the project is followed.

## License

MIT (c) Cezar Augusto
