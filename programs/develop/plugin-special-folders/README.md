[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# @/plugin-special-folders

> Handle extension "special folders" (public, pages, scripts, extensions) during builds and development.

This module adds support for special folders in a browser extension project and is part of the [Extension.js](https://extension.js.org) project. It uses Rspack's `CopyRspackPlugin` to emit static assets under `public/` (for proper watch/incremental behavior). In development watch mode, adding or removing an HTML file in `pages/` or a script in `scripts/` changes the entrypoints, so a live dev session restarts itself to pick the change up. It also defines a conventional `extensions/` folder for load-only companion extensions.

- Emits the exact `public/` directory into the build output root, preserving the folder structure, via `CopyRspackPlugin`. Files that are not extension content stay out (see "Files public/ never ships").
- In development with watch enabled, monitors `pages/` and `scripts/`:
  - Adding or removing a supported file restarts the live dev session, and a rename asks for one restart that names both paths.
  - With no session to restart, an addition is a warning and a removal is a compilation error that asks for a restart.

Output mapping overview:

| Source pattern  | Output behavior                                                                   |
| --------------- | --------------------------------------------------------------------------------- |
| `public/**`     | Emitted 1:1 into output root (e.g., `public/img/icon.png` → `dist/img/icon.png`). |
| `pages/**`      | Surfaced via HTML feature; nested routes preserved and `/index` collapses.        |
| `scripts/**`    | Surfaced via Scripts feature; not copied by this plugin.                          |
| `*.dev.*`       | A page or script named `.dev.` is a development-only entry: compiled in development, left out of production. |
| `include`       | Files the config declares are copied to their output path (`{'models/x.onnx': './models/x.onnx'}`), a folder source copies its tree. |
| `extensions/**` | Load-only companion extensions; scanned when no CLI/config `extensions` provided. |

## Usage

```ts
import {SpecialFoldersPlugin} from '@/plugin-special-folders'

export default {
  // ... your Rspack/Webpack config
  plugins: [
    new SpecialFoldersPlugin({
      // Absolute path to your manifest.json
      manifestPath: '/absolute/path/to/manifest.json'
    })
  ]
}
```

## Include semantics

- This plugin takes no glob lists. It always emits from `public/` and watches `pages/` and `scripts` (dev-only) based on the `manifestPath` project root. It also exposes a default `extensions/` scan when no CLI/config `extensions` are provided.
- `include` (from `extension.config.js`, layered top-level, per browser and per command) names extra files by output path. A missing source or an output path outside the extension root fails the compilation with a message naming the key.
- A `.js`, `.mjs` or `.cjs` file `include` copies is minified in a production build (a `.min.js` is left alone): names are shortened and comments dropped, no statement is rewritten, so the value `executeScript` reads off the file stays and a `/*!` banner stays in the file. `{from: 'vendor/lib.js', minify: false}` in place of the path ships that file as authored, and so does `--no-minify` for every file. Files under `public/` always ship as authored.
- `exclude` names files relative to the project root that a build leaves out: a page or script there gets no entry, and a file under `public/` is not copied. An entry with no file behind it is a warning that names the browser.
- For handling specific assets referenced in `manifest.json`, use the respective plugins (HTML, Icons, Scripts) with their `includeList` options.

## Files public/ never ships

Every file in the build output is readable by anyone who installs the extension, so a few names are left out of the copy wherever they sit under `public/`, in any letter case. A folder with one of these names is left out with everything inside it.

| Kind | Names | Said in the build |
| ---- | ----- | ----------------- |
| OS metadata | `.DS_Store`, `Thumbs.db`, `desktop.ini` | Nothing. |
| Env files | `.env`, `.env.*` (all but `.env.example`), `.envrc` | One warning per build that names the files, never what they hold. A watch session says it again only when the list changes. |
| Repository and editor files | `.git`, `.gitignore`, `.gitattributes`, `.gitmodules`, `.gitkeep`, `.npmrc`, `.yarnrc.yml`, `.*.swp`, `.*.swo`, `.*.swn`, `*~` | Nothing. |

Every other dot-file ships as authored: `.well-known/`, `.nojekyll`, `.htaccess`, `.env.example` and any dot-folder of the project's own. The list is by name on purpose, since a dot-file can be content a page fetches.

A page or a stylesheet that names one of them by a root-absolute path (`/.env`) gets the missing-file warning of that surface, whether or not `public/` holds the file.

## Root-absolute paths outside public/

A root-absolute path (`/data/config.json`) in a page or in a stylesheet that ships as authored names a file in `public/` first. When `public/` has none, the file at that path beside the manifest is copied, or compiled when the browser cannot run it as written. That fallback never ships:

- a name from the table above, anywhere along the path,
- anything under `node_modules`,
- a path that climbs out of the extension root (`/../x`, `/%2e%2e/x`),
- a link that resolves outside the project or onto one of those names.

Each of those is reported as a missing file, in the words the surface uses for one, and nothing is copied. A link that stays inside the project is followed.

## Path resolution convention (consistent across @plugin-extension)

- Leading `/` means extension root (public root) relative to the directory containing `manifest.json`.
- Relative paths are resolved from the manifest directory.
- Absolute OS paths are used as-is.

This plugin mirrors that convention by emitting `public/` into the output root so assets addressed as `/foo.png` in manifests/HTML resolve correctly at runtime.

## Compatibility

- Typed against `@rspack/core` and tested with Rspack.
- Webpack 5 may work but isn’t officially supported here.

## API

```ts
interface SpecialFoldersPluginOptions {
  manifestPath: string
  browser?: DevOptions['browser']
  folders?: SpecialFoldersConfig
  include?: Record<string, string | {from: string; minify?: boolean}>
  exclude?: string[]
}

export class SpecialFoldersPlugin {
  static readonly name: string
  constructor(options: SpecialFoldersPluginOptions)
}
```

## Examples

- Basic copy from `public/`:
  - `public/css/file.css` → `dist/css/file.css`
  - `public/img/icon.png` → `dist/img/icon.png`
  - `public/logo.svg` → `dist/logo.svg`
- Dev watch behavior:
  - Add `pages/foo.html` → the live session restarts with the new page.
  - Remove `scripts/content.js` → the live session restarts without that entry.

## Tested behaviors

- Copies `public/**` into output root during builds and mirrors add/change/unlink in development watch.
- Leaves OS metadata, env files and repository files out of the copy in a build and in a watch session, and names the env files in one warning.
- In dev watch, adding or removing HTML under `pages/` or supported scripts under `scripts/` restarts the live session. Without one, an addition warns and a removal is an error.

## License

MIT (c) Cezar Augusto
