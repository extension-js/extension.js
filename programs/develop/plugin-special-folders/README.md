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
- The scan reads `pages/` and `scripts/` only, never `public/`, which is the copier's to walk. One walk in `entry-folders.ts` answers both the scan and the dev watcher: every file at any depth but a `node_modules` folder, a page ending in `.html` and a script ending in exactly `.js`, `.mjs`, `.jsx`, `.mjsx`, `.ts`, `.mts`, `.tsx` or `.mtsx`. An upper-case extension is no entry. A link inside either folder is followed while it stays inside the project, as `walked-entries.ts` asks, and the dev watcher lists the same links, so one added mid-session asks for a restart like a plain file.
- `include` (from `extension.config.js`, layered top-level, per browser and per command) names extra files by output path. A missing source or an output path outside the extension root fails the compilation with a message naming the key. A source missing at start is still watched, and it ships on the compile after it appears.
- A `.js`, `.mjs` or `.cjs` file `include` copies is minified in a production build (a `.min.js` is left alone): names are shortened and comments dropped, no statement is rewritten, so the value `executeScript` reads off the file stays and a `/*!` banner stays in the file. `{from: 'vendor/lib.js', minify: false}` in place of the path ships that file as authored, and so does `--no-minify` for every file. Files under `public/` always ship as authored.
- The public folder is named `public/` in lowercase. A `Public/` or `PUBLIC/` folder is named in one warning (`PublicFolderCaseWarning`, `W_PROJECT_LAYOUT`) asking for the rename. On a disk that ignores letter case (the macOS default) it still ships, and the warning says another spelling stops working in the next major version. On a disk that keeps letter case nothing in it ships, and the warning says the folder is not read. The folder ships only when the disk answers `public` with it: the folder the build reads sits beside it and no `public` is written there. A `PUBLIC/` beside a real `public/` is a second folder, and it is reported as not read.
- `pages/` and `scripts/` are named in lowercase too. A `Pages/` or `Scripts/` folder is read on no disk, so a project builds the same on macOS, Windows and Linux, and one warning per folder (`EntryFolderCaseWarning`, `W_PROJECT_LAYOUT`) names it and the rename. `folders-config.ts` asks the folder's parent how the name is written, and the scan, the walk and the dev watcher all read that one answer.
- An entry is named by its path inside the folder without the extension, and a page named `index` stands for its folder, so `pages/a.html` and `pages/a/index.html` both claim `pages/a`, as `scripts/a.js` and `scripts/a.ts` both claim `scripts/a`. The file that sorts last is built (`a/index.html` over `a.html`, the TypeScript source over its compiled copy), and one warning (`EntryNameCollisionWarning`, `W_PROJECT_LAYOUT`) names each name, the file used and every file ignored. A linked file is settled the same way.
- A declaration file (`.d.ts`, `.d.mts`, `.d.cts`) in `scripts/` is never an entry.
- A `public/` file whose output path an entry already writes is not copied, the entry's file wins, and the build names the file in one warning (`PublicFileShadowedWarning`, `W_PROJECT_LAYOUT`), again in a watch session only when the list changes.
- A folder inside `pages/` or `scripts/` the build cannot read stops the scan with `E_FOLDER_UNREADABLE` (`SpecialFolderUnreadable`), naming the folder from the project root.
- `exclude` names files relative to the project root that a build leaves out: a page or script there gets no entry, and a file under `public/` is not copied. An entry with no file behind it is a warning that names the browser.
- For handling specific assets referenced in `manifest.json`, use the respective plugins (HTML, Icons, Scripts) with their `includeList` options.

## Companion extensions

With no `extensions` setting, every unpacked extension one level inside `./extensions` loads beside the project's own, and a subfolder named for a browser (`extensions/chrome/`) is that browser's set.

An entry the config or the CLI names is a store link or a folder. A named folder may sit anywhere inside the project (`my-ext`, `tools/my-ext`, `extensions/my-ext`), by a relative or an absolute path. A path that resolves outside the project is refused with `Companion extensions must be inside the project.`, and so is a link inside the project that leads out of it, since real paths are compared.

`extensions.dir`, the folder that is scanned, follows the same rule: any folder inside the project (`./vendor`, `tools/companions`, a folder under `node_modules`), by a relative or an absolute path, compared by real path. The project itself (`.`), a path outside it and a link that leads out are refused with `extensions.dir must be inside the project.`. A `dir` that does not exist scans nothing and is not reported. The scan follows links: an entry that is a link to a folder inside the project loads like any folder, and one that leads outside the project is not loaded while the other entries go on. A caller that launches a browser with the result passes `launchesBrowser`, and the entry left out is then said once under the warning code `W_COMPANION_EXTENSION_PATH`. A link to nothing, to a file or back to itself is skipped, and a folder reached under two names loads once.

Both refusals carry the code `E_COMPANION_EXTENSION_PATH`. So do the refusals of an entry that is neither a store link nor a folder: a web link that is no store link (`CompanionLinkNotAStoreLink`), a bare store id (`CompanionEntryLooksLikeStoreId`) and any other name (`CompanionEntryNotLinkOrFolder`). `isCompanionStoreLink` in `folder-extensions/resolve-config.ts` is the one answer to which links are store links. A store download that leaves no unpacked extension behind stops with `E_PROJECT_DOWNLOAD_EMPTY` (`CompanionStoreDownloadEmpty`), naming the folder from the project root.

A named folder with no `manifest.json` loads nothing and is not reported.

## Files public/ never ships

Every file in the build output is readable by anyone who installs the extension, so a few names are left out of the copy wherever they sit under `public/`, in any letter case. A folder with one of these names is left out with everything inside it.

| Kind | Names | Said in the build |
| ---- | ----- | ----------------- |
| OS metadata | `.DS_Store`, `Thumbs.db`, `desktop.ini` | Nothing. |
| Env files | `.env`, `.env.*` (all but the templates below), `.envrc` | One warning per build that names the files, never what they hold. A watch session says it again only when the list changes. |
| Repository and editor files | `.git`, `.gitignore`, `.gitattributes`, `.gitmodules`, `.gitkeep`, `.npmrc`, `.yarnrc.yml`, `.*.swp`, `.*.swo`, `.*.swn`, `*~` | Nothing. |

A template env file holds no real value by convention, so a `.env.*` name that ends in `.example`, `.sample` or `.template` ships: `.env.example`, `.env.sample`, `.env.template`, `.env.local.example`, `.env.production.sample`. A name that only starts like one (`.env.example.local`) is an env file.

Every other dot-file ships as authored: `.well-known/`, `.nojekyll`, `.htaccess` and any dot-folder of the project's own. The list is by name on purpose, since a dot-file can be content a page fetches.

A link under `public/` is copied as the file or folder it leads to while that place stays inside the project and outside `node_modules`. A link that leads anywhere else is left out, a folder it names is never walked, and the build names each such link in one warning, never what it holds. A watch session reads the links when it starts.

A page or a stylesheet that names one of them by a root-absolute path (`/.env`) gets the missing-file warning of that surface, whether or not `public/` holds the file.

## Root-absolute paths outside public/

A root-absolute path (`/data/config.json`) in a page or in a stylesheet that ships as authored names a file in `public/` first. When `public/` has none, the file at that path beside the manifest is copied, or compiled when the browser cannot run it as written. That fallback never ships:

- a name from the table above, anywhere along the path,
- a path that climbs out of the extension root (`/../x`, `/%2e%2e/x`),
- a link that resolves outside the project and its workspace, as below, or onto one of those names.

Each of those is reported as a missing file, in the words the surface uses for one, and nothing is copied. A link that stays inside the project, or leads to a file the workspace may share, is followed.

A file of an installed package ships when its path is named (`/node_modules/pkg/worker.js`), a vendored worker, wasm file or stylesheet for example. It ships through a package manager's link too: the place the link leads to has to stay inside a `node_modules` folder of the project or of a folder above it, which is where a workspace keeps its store. A name from the table above is refused inside a package as well, and so is a `node_modules` link that leads anywhere else.

A file the author names may also come from the workspace the project belongs to, by its path (`../../shared/logo.png`) or through a link inside the project. The workspace root is the nearest folder at or above the project that holds a `pnpm-workspace.yaml`, or a `package.json` whose `workspaces` is a list or an object with a `packages` list. A lockfile, a `.git` folder, `lerna.json`, `nx.json` or `turbo.json` alone marks nothing. The walk up never reaches the home folder, so a marker there or above it is ignored, and a project with no marker is its own workspace root. Inside the workspace and outside the project, a path through a folder or a file whose name starts with a dot (`.git`, `.cache`, `.turbo`) or through the `node_modules` of another package is refused, and so is anything outside the workspace root, reported as it is outside the project. The project does not have to be listed as a member of the workspace. Companion extensions and `extensions.dir` stay inside the project.

The decision is one function, `sourceFileMayShip(sourcePath, projectRoots, ask)` in `lib/public-private-files.ts`, and `workspaceRootOf(projectRoot)` beside it answers the workspace root. `ask` is `'named'` when the author wrote the path of that one file, which is the default, and `'walked'` when a folder entry or a pattern reached it. A walk never enters `node_modules` and never leaves the project. The `web_accessible_resources` step, the JSON fields of the manifest, custom manifest keys and the file names found in code all ask it. A custom key and a file name found in code are read the way a URL is, so they never climb above the extension root and reach the workspace only through a link. A `web_accessible_resources` entry or a JSON field spelled from the root that climbs out of it (`/../x`, `/%2e%2e/x`) is refused as a page refuses it, while the same path without the leading slash reaches the workspace.

## Path resolution convention (consistent across plugin-web-extension)

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
