# @extension-create/develop

> The `start` part of `extension-create` available as a standalone package.

This package stores all logic needed by `extension-create` to start new projects.

## Installation

```
npm i @extension-create/develop
```

## Usage

There are two ways of using it:

### Standalone Executable

```
# Will start a new browser instance with my-extension-hello loaded.
npx @extension-create/start my-extension-hello
```

### Imported CLI

Alternatively, if you're using [commander](https://github.com/tj/commander.js), you can use `@extension-create/start` to extend you CLI. This is what `extension-create` does.

```js
const {program} = require('commander')
const startExtensionCLI = require('@extension-create/start')

const yourCreateProgram = program

yourCreateProgram
  .version(packageJson.version)

startExtensionCLI(yourCreateProgram)

yourCreateProgram
  .parse(process.argv)
```

## Program options table

| Flag             | Argument                                                 | What it does |
|------------------|----------------------------------------------------------|--------------|
| -m, --manifest   | file path | Specify a custom path for your extensions's manifest file |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT (c) Cezar Augusto.
