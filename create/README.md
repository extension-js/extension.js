# @extension-create/create

> The `create` part of `extension-create` available as a standalone package.

This package stores all logic needed by `extension-create` to create new projects.

## Installation

```
npm i @extension-create/create
```

## Usage

There are two ways of using it:

### Standalone Executable

```
# Will create a new directory named `my-extension-hello`.
npx @extension-create/create my-extension-hello
```

### Imported CLI

Alternatively, if you're using [commander](https://github.com/tj/commander.js), you can use `@extension-create/create` to extend you CLI. This is what `extension-create` does.

```js
const {program} = require('commander')
const createExtensionCLI = require('@extension-create/create')

const yourCreateProgram = program

yourCreateProgram
  .version(packageJson.version)

createExtensionCLI(yourCreateProgram)

yourCreateProgram
  .parse(process.argv)
```

## Program options table

| Flag             | Argument                                                 | What it does |
|------------------|----------------------------------------------------------|--------------|
| -t, --template   | Path to the template used to bootstrap your extension    | Bootstrap your extension using a template |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT (c) Cezar Augusto.
