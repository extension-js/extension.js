# @extension-create/create

> The **create** part of [extension-create](https://github.com/cezaraugusto/extension-create). Available as a standalone package.

This package stores all logic needed by `extension-create` to create new projects.

## Installation

```
yarn add @extension-create/create
```

## Usage

```js
import createExtension from '@extension-create/create'

async function createNewExtension () {
  await createExtension(
    projectName: /* string (required) */,
    workingDir /* string (defaults to process.cwd) */,
    template /* string - defaults to 'web' */
  )
}

createNewExtension()
```

## License

MIT (c) Cezar Augusto.
