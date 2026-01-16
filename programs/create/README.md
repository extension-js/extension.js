[ci-url]: https://github.com/extension-js/create/actions/workflows/ci.yml

# extension-create [🛠️ CI][ci-url]

The standalone extension creation engine for [Extension.js](https://github.com/extension-js/extension.js).

## Install

```bash
npm install extension-create
```

## Usage

Create a new extension with a single function call:

```javascript
import {extensionCreate} from 'extension-create'

// Create a basic extension
await extensionCreate('my-extension', {
  template: 'init'
})

// Create a React extension and install its dependencies
await extensionCreate('my-react-extension', {
  template: 'react',
  install: true
})
```

## API Reference

### `extensionCreate(projectName, options)`

Creates a new extension project with the specified configuration.

#### Parameters

- `projectName` (string, required) - The name of your extension project
- `options` (object) - Configuration options
  - `template` (string, optional) - Template name or URL. Defaults to `'init'`
  - `install` (boolean, optional) - Whether to install dependencies. Defaults to `true`
  - `cliVersion` (string, optional) - CLI version for package.json

## Templates

Templates are sourced from the public Examples repository. See the catalog at `https://github.com/extension-js/examples` and reference templates by name (for example, `content`, `content-react`, `content-vue`).

## License

MIT (c) Cezar Augusto.
