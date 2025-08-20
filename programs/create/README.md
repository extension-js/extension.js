[npm-version-image]: https://img.shields.io/npm/v/extension-create.svg?color=0971fe
[npm-version-url]: https://www.npmjs.com/package/extension-create
[downloads-image]: https://img.shields.io/npm/dm/extension-create.svg?color=2ecc40
[downloads-url]: https://npmjs.org/package/extension-create
[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org

[![Empowering][empowering-image]][empowering-url] [![Version][npm-version-image]][npm-version-url] [![Downloads][downloads-image]][downloads-url]

# extension-create

> Scaffold a new [Extension.js](https://extension.js.org) project from a template.

This package implements the logic Extension.js uses to scaffold a new extension project from a selected template.
It performs, in order:

- Create or reuse the target directory (and fail on conflicting files)
- Import the selected template (local in dev, remote via Git in prod)
- Write `package.json` metadata and add Extension.js scripts
- Write `manifest.json` metadata
- Initialize a Git repository
- Write a `.gitignore`
- Remove template-only test files
- If the template is TypeScript-based, generate `extension-env.d.ts`

## Installation

```
pnpm add extension-create
```

## Usage

```js
import {extensionCreate} from 'extension-create'

async function createNewExtension () {
  await extensionCreate(
    projectName: /* string (required) */,
    {
      template: 'init', // or any template name (see /examples)
      install: false,   // optionally run the package manager install step
      cliVersion: '2.x' // used to pin the CLI when not in dev mode
    }
  )
}

createNewExtension()
```

## License

MIT (c) Cezar Augusto.
