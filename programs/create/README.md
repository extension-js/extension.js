[npm-version-image]: https://img.shields.io/npm/v/extension-create.svg?color=0971fe
[npm-version-url]: https://www.npmjs.com/package/extension-create
[npm-downloads-image]: https://img.shields.io/npm/dm/extension-create.svg?color=0971fe
[npm-downloads-url]: https://www.npmjs.com/package/extension-create
[action-image]: https://github.com/extension-js/create/actions/workflows/ci.yml/badge.svg?branch=main
[action-url]: https://github.com/extension-js/create/actions/workflows/ci.yml

[![Version][npm-version-image]][npm-version-url] [![Downloads][npm-downloads-image]][npm-downloads-url] [![CI][action-image]][action-url]

# extension-create

The standalone extension creation engine for Extension.js.
Use it to scaffold a new extension project from a template.

## Install

```bash
npm install extension-create
```

## Usage

Create a new extension with a single function call:

```javascript
import {extensionCreate} from 'extension-create'

// Create a basic extension (default template: javascript)
await extensionCreate('my-extension', {})

// Create a React extension and install its dependencies
// (dependency install is opt-in — users normally run their own
// `npm install` so output is what they expect)
await extensionCreate('my-react-extension', {
  template: 'react',
  install: true
})
```

## API reference

### `extensionCreate(projectName, options)`

Creates a new extension project with the specified configuration.

#### Parameters

- `projectName` (string, required) - The name of your extension project
- `options` (object) - Configuration options
  - `template` (string, optional) - Template name or URL. Defaults to `'javascript'` (`init` is an alias)
  - `install` (boolean, optional) - Whether to install dependencies after scaffolding. Defaults to `false` so project creation is fast and users see the familiar `npm install` output on their own.
  - `cliVersion` (string, optional) - CLI version for package.json

## Templates

Templates are sourced from the public examples repository. Browse the catalog in the [Extension.js examples](https://github.com/extension-js/examples) and reference templates by name (for example, `content`, `content-react`, `content-vue`).

## License

MIT (c) Cezar Augusto.
