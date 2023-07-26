[npm-image]: https://img.shields.io/npm/v/extension-manifest-assets.svg
[npm-url]: https://npmjs.org/package/extension-manifest-assets

# browser-extension-manifest-fields [![npm][npm-image]][npm-url]

> Output file paths from fields declared in a browser extension manifest file.

Get all your HTML, JS and CSS (content_scripts) assets from your manifest, including scripts and CSS declared in HTML files.

## Installation

```
npm i --save-dev browser-extension-manifest-fields
```

## Usage

```js
const manifestFields = require('browser-extension-manifest-fields')

// Sample manifest with workable fields
const manifestSample = {
  author: 'Cezar Augusto',
  background: {
    persistent: false,
    page: 'background/background.html' // Declares background.js via <script>
  },
  browser_action: {
    default_popup: 'popup/popup.html', // Declares popup.js via <script> and popup.css via <link>
    default_title: 'Test'
  },
  chrome_url_overrides: {
    newtab: 'overrides/newtab/newtab.html' // Declares newtab.js via <script> and newtab.css via <link>
  },
  content_scripts: [
    {
      css: ['content/content.css', 'content/content2.css'],
      js: ['content/content.js', 'content/content2.js']
    }
  ],
  devtools_page: 'devtools/devtools.html', // Declares devtools.js via <script> and devtools.css via <link>
  options_ui: {
    chrome_style: true,
    page: 'options/options.html' // Declares options.js via <script> and options.css via <link>
  }
}

console.log(manifestAssets)
```

## Output

```js
{
  html: [], // Array<[string, string]>;
  icons: [], // Array[any, string | string[] | { light: string; dark: string;}]>;
  locale: [], // string[];
  scripts: [], // Array<string, string | { js: string[]; css: string[]; }]>;
  webResources: [] // Array<string, (string | string[])[]]>;
}
```

## License

MIT (c) Cezar Augusto.
