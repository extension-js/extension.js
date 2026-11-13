[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-css

> Automatically wires CSS handling into the Rspack build used by Extension.js. It:

- Detects CSS entries and applies targeted pipelines for HTML and content scripts
- Adds optional SASS/LESS support and PostCSS when present
- Integrates Stylelint when a config exists

|                                                                            | Feature                                                                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Content script CSS**<br/>Emits CSS as assets and wires HMR; plays nicely with Shadow DOM wrappers. |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **HTML CSS**<br/>Standard CSS handling for HTML entries.                                             |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **SASS/LESS (optional)**<br/>Auto‑enables when dependencies exist; emits as assets for scripts.      |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **Stylelint (optional)**<br/>Enables style linting if installed/configured.                          |
| <img src="https://media.extension.land/track/extension-js.png" width="56" /> | **PostCSS (optional)**<br/>Auto‑enables for Tailwind/PostCSS config.                                 |

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
  constructor(options: {manifestPath: string})
  apply(compiler: import('@rspack/core').Compiler): Promise<void>
}
```
