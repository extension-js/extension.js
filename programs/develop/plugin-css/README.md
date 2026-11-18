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
- Warns about a `url()` that points to no file instead of failing the build (`EXTENSION_STRICT_REFS=true` makes it an error)

|                                                                            | Feature                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Content script CSS**<br/>A sheet a content script imports becomes a module that answers a `data:text/css` URL, with the rules of every project sheet it brings in with `@import` inside it. A sheet the manifest lists under `content_scripts[].css` ships as a file. |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Page CSS**<br/>Native Rspack CSS for HTML pages, with CSS modules for `.module.*` files.                                                                                     |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Sass and Less (optional)**<br/>Enabled when the project depends on `sass` or `less`. Without them, `.scss` and `.less` files ship uncompiled with a warning.                |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **PostCSS and Tailwind (optional)**<br/>Reads the project's PostCSS config and resolves its plugins, Tailwind included, from the project. An edit to the config applies to the next build of a running `dev` session.                                                         |

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
