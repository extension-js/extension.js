[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-css

> Wires CSS handling into the Rspack build used by Extension.js. It:

- Adds stylesheet rules per surface: page sheets, content script sheets and CSS modules
- Compiles Sass and Less when the project depends on `sass` or `less`, and runs PostCSS when the project has a PostCSS config (a file or the `postcss` key in `package.json`) or depends on Tailwind
- Ships a sheet the CSS parser rejects as authored, with one warning, the way a browser error-recovers it
- Warns about a `url()` or an `@import` that points to no file instead of failing the build (`EXTENSION_STRICT_REFS=true` makes it an error). Both are `CssDeadRef` (`E_CSS_DEAD_REF`), and each is worded for the rule that names the file
- Outside a content script, `import href from './panel.css?url'` ships the compiled sheet as a file of its own under `assets/` and answers its URL. A relative `url()` or `@import` in that sheet cannot follow it, and a warning names each one
- Its rules come after the project's own, so a `type` a project rule sets for `.css`, `.scss`, `.sass` or `.less` files is not applied, and a warning says so
- A PostCSS config keeps its `parser`, `syntax`, `stringifier` and `map` beside its plugins, a named module resolved from the project

|                                                                            | Feature                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Content script CSS**<br/>A sheet a content script imports becomes a module that answers a `data:text/css` URL, with the rules of every project sheet it brings in with `@import` inside it, and the same goes for the style block of a Vue or Svelte component. A path comes in (a name that starts with `./`, `../` or `/`), and so does a name with no `./` ahead of it that ends in `.css`, when a file beside the sheet has exactly that name, letter case included. CSS reads every such name as a path, and the tools read it as a package, so the file wins only when it is there. `@import "reset"` is a package even with `reset.css` beside the sheet: no ending is guessed. Inside `url()` such a name is always a path. Any other such name is a package, left as written for a PostCSS plugin such as Tailwind. An `@import` that is still in the sheet once every tool ran, and is no address with a scheme, gets a warning that its rules will not load. A `url()` address, and a string inside `src()` or `image-set()`, that names a file is rewritten to a file the build bundles. One that names a file under a private name or outside the project and its workspace keeps its address and ships nothing, with the warning a file that is not there gets. The imported rules pass through the project's PostCSS plugins and, in a Vue block, its scoping. A sheet may sit in the project, in a `node_modules` folder of the project or of a folder above it, or in another package of its workspace. The workspace is the nearest folder above the project with a `pnpm-workspace.yaml` or a `package.json` whose `workspaces` is a list or holds `packages`, below the home folder: a marker in the home folder or above it is not read, and a project that is the home folder is its own root. A lockfile or a `.git` folder alone makes none. Inside another package, a path with a `node_modules` part or a part that starts with a dot, the file name included, stays out. A sheet anywhere else, a path with a private name along it (`.env`, `.git`, `.npmrc`, `.DS_Store` and the like) and a sheet that sets an `@namespace` stay out with a warning. A sheet the manifest lists under `content_scripts[].css` ships as a file. |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Page CSS**<br/>Native Rspack CSS for HTML pages, with CSS modules for `.module.*` files. The same goes for a sheet the manifest lists under `content_scripts[].css` and for the style block of a page's Vue or Svelte component. Every file such a sheet leads to, through `url()`, `image-set()`, `@import` or `composes`, is checked once aliases, packages and links are followed: a file under a private name or outside the project and its workspace keeps its address and ships nothing, with the warning a file that is not there gets. A bare name, with no `./`, `../` or `/` ahead of it, that no file beside the sheet or in `public/` holds is still given to the resolver, so an alias the project config sets or an installed package places it. The check runs for the sheets that ship as files. A sheet that becomes `asset/inline` and a sheet a content script imports have their own check, the one described above. |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Sass and Less (optional)**<br/>Enabled when the project depends on `sass` or `less`. Without them, `.scss` and `.less` files ship uncompiled with a warning.                |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **PostCSS and Tailwind (optional)**<br/>Reads the project's PostCSS config and resolves its plugins, Tailwind included, from the project. An edit to the config, or to a project file a CommonJS config requires however far down, rebuilds a running `dev` session with the new answer. Limits: a helper outside the project root is never read again, nor is a CommonJS helper an ESM config loads through `createRequire`, nor what an ESM config imports. Each new read of a config Node imports leaves one module record behind until the process ends.                                                         |

### Content script styles on a page with a strict style policy

In a content script, `import href from './panel.css'` and `new URL('./panel.css', import.meta.url)` both answer a `data:text/css` URL that holds the compiled sheet. What a page's Content Security Policy does with it depends on the world the script runs in. Measured on Chrome 151 and Firefox 160, in `dev` and in a production build, on a page that sends `style-src 'self'`:

| The script's own call                         | Isolated world | MAIN world                        |
| --------------------------------------------- | -------------- | --------------------------------- |
| `fetch(href)`                                 | answers        | answers                           |
| a `<style>` element holding the fetched text  | applies        | refused, `style-src-elem` inline  |
| `<link rel="stylesheet" href={href}>`         | applies        | refused, `style-src-elem` `data:` |
| a `<link>` to a web accessible extension file | applies        | applies                           |
| a constructed sheet in `adoptedStyleSheets`   | applies        | applies                           |

A `<style>` element inside a shadow root is refused the same way as one in the document. On a page that sends `default-src 'self'`, `fetch(href)` is refused as well (`connect-src`), in the MAIN world on both browsers and in the isolated world on Firefox.

The build cannot see the policy of a page the script will visit, and these are the script's own DOM calls, so it changes none of them and prints no warning. A MAIN world script that has to work under such a policy reads the sheet out of the URL, with no request, and adopts it:

```js
import href from './panel.css'

const sheet = new CSSStyleSheet()
sheet.replaceSync(decodeURIComponent(href.slice(href.indexOf(',') + 1)))
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
```

### Reading the addresses of a sheet

`rewriteCssUrls(css, rewrite, doubleQuoted?, escapedToo?)` in `lib/css/inline-css-imports.ts` passes each address of a sheet to `rewrite(request, place)` and replaces it with the answer. An answer of `undefined` keeps the address as written. A request that holds a backslash reaches `rewrite` only with `escapedToo`, as written. Text inside a string or a comment never does.

| Place        | What it is                                                        |
| ------------ | ----------------------------------------------------------------- |
| `import`     | The string of an `@import "x"`. A name with no `./` is a package. |
| `import-url` | The `url()` of an `@import url(x)`. It names a sheet, never a file to ship. |
| `url`        | Any other `url()`, quoted or not.                                 |
| `set`        | A string inside `src()`, `image-set()` or `-webkit-image-set()`.  |

### Usage

```ts
import {CssPlugin} from './plugin-css'

export default {
  plugins: [
    new CssPlugin({
      manifestPath: '/abs/path/to/manifest.json'
    })
  ]
}
```

### API

```ts
export class CssPlugin {
  static readonly name: 'plugin-css'
  constructor(options: {manifestPath: string; browser?: string})
  apply(compiler: import('@rspack/core').Compiler): Promise<void>
}
```
