# extension-create

> The **create** part of [Extension.js](https://github.com/cezaraugusto/extension). Available as a standalone package.

This package stores all logic needed by Extension.js to create new projects.

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
      /* string - Template name or URL. Defaults to 'init' */
      template
    }
  )
}

createNewExtension()
```

## License

MIT (c) Cezar Augusto.
