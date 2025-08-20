# @/webpack/plugin-extension-data

> Utility helpers to read extension manifest fields and discover special folders for the Webpack Extension plugin.

This module provides data helpers used to:

- Parse a `manifest.json` and resolve file paths for HTML, icons, JSON, scripts, locales, and web accessible resources.
- Discover project "special folders" like `public/`, `pages/`, and `scripts/` and generate consistent entry maps.

These utilities are part of the Extension.js project and are intended for developers building browser extensions with a bundler.

## What it does

- HTML, icons, JSON, and scripts declared in the manifest are resolved to absolute file system paths, with public-root inputs normalized (e.g., `/foo`, `/public/foo`, `public/foo`).
- Browser-prefixed manifest keys are honored using the current target browser (e.g., `chromium:action` for Chrome vs `gecko:action` for Firefox/Gecko).
- `content_scripts` entries include both JS and CSS assets when present, preserving ordering.
- `web_accessible_resources` are passed through as-is for MV3, or strings for MV2.
- Locales under `_locales/*` are discovered if present.
- Special folders detection:
  - Case-insensitive detection of the `public/` folder (e.g., `Public/` works on macOS/Windows).
  - `pages/` returns only HTML file entries.
  - `scripts/` returns entries only for allowed script extensions: `.js, .mjs, .jsx, .mjsx, .ts, .mts, .tsx, .mtsx`.

## Usage

```ts
import {getManifestFieldsData} from '@/webpack/plugin-extension-data/manifest-fields'
import {getSpecialFoldersData} from '@/webpack/plugin-extension-data/special-folders'

// Resolve manifest field paths
const fields = getManifestFieldsData({
  manifestPath: '/abs/path/to/manifest.json'
})

// Discover entries from special folders
const entries = getSpecialFoldersData({
  manifestPath: '/abs/path/to/manifest.json'
})
```

## API

```ts
// manifest-fields
export interface ManifestFields {
  html: Record<string, any>
  icons: Record<string, any>
  json: Record<string, any>
  scripts: Record<string, any>
  web_accessible_resources: Record<string, any>
}

export function getManifestFieldsData(args: {
  manifestPath: string
  browser?: string
}): ManifestFields

// special-folders
export function getSpecialFoldersData(args: {manifestPath: string}): {
  public: Record<string, string>
  pages: Record<string, string>
  scripts: Record<string, string>
}
```

## License

MIT (c) Cezar Augusto
