[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

# @/webpack/plugin-extension/feature-json

> Emit and watch JSON assets referenced by your extension manifest.

Handles JSON assets declared in `manifest.json` for browser extensions. It emits these files into the final build and adds them to file dependencies so changes are watched during development. This module supports features like `declarative_net_request` rulesets and `storage.managed_schema`.

This module is part of the Extension.js project. It emits JSON assets referenced by supported manifest fields into your final build and adds them as file dependencies so rebuilds are triggered on changes.

## Usage

```ts
import type {Configuration} from '@rspack/core'
import {JsonPlugin} from '@/webpack/plugin-extension/feature-json'

const config: Configuration = {
  plugins: [
    new JsonPlugin({
      manifestPath: require('path').resolve(process.cwd(), 'manifest.json'),
      // Optionally restrict or extend what JSON files are handled
      includeList: {
        // Keys become output paths (without .json), values are absolute file paths
        // 'declarative_net_request/ruleset_1': '/abs/path/to/ruleset_1.json'
      },
      excludeList: {
        // Exclude specific files from being emitted/watched
        // 'public/public_ruleset': '/abs/path/to/public_ruleset.json'
      }
    })
  ]
}

export default config
```

Most users will not need to add this plugin directly when using an orchestrated setup. Use it standalone only if you need fine‑grained control over JSON handling.

## API

```ts
export type FilepathList = Record<string, string | string[] | undefined>

export interface PluginInterface {
  manifestPath: string
  includeList?: FilepathList
  excludeList?: FilepathList
}

export class JsonPlugin {
  constructor(options: PluginInterface)
  apply(compiler: import('@rspack/core').Compiler): void
}
```

- Handles JSON referenced by manifest fields like:
  - **declarative_net_request.rule_resources** → emitted as `declarative_net_request/<id>.json`
  - **storage.managed_schema** → emitted as `storage/managed_schema.json`
- Adds emitted files to compilation dependencies so updates trigger rebuilds
- Respects `excludeList` to skip specific files

### Output mapping

| Manifest field                             | Example input path                       | Output path example                      |
| ------------------------------------------ | ---------------------------------------- | ---------------------------------------- |
| `declarative_net_request.rule_resources[]` | `declarative_net_request/ruleset_1.json` | `declarative_net_request/ruleset_1.json` |
| `storage.managed_schema`                   | `storage/managed_schema.json`            | `storage/managed_schema.json`            |

Notes:

- Keys in `includeList` map directly to output paths (without the `.json` suffix in the key; the plugin appends `.json`).
- Files under `public/` are typically excluded by `excludeList` and will not be emitted.

### includeList / excludeList semantics

```ts
new JsonPlugin({
  manifestPath: '/abs/manifest.json',
  includeList: {
    'features/ruleset': '/abs/path/ruleset.json',
    'features/multiple': ['/abs/a.json', '/abs/b.json']
  },
  excludeList: {
    'public/ruleset': '/abs/project/public/ruleset.json'
  }
})
```

- `includeList` accepts a string or an array of strings as values. The key becomes the output path (plugin appends `.json`).
- `excludeList` prevents matching absolute file paths from being emitted or added to dependencies.
- When `includeList` value is an array, the plugin emits a single output named after the key and the content from the last file in the array wins (subsequent entries overwrite previous ones for the same output).
- Missing files referenced in `includeList` are skipped and reported as warnings; the build continues without emitting that asset.
- JSON files under `public/` (or otherwise listed in `excludeList`) are not emitted or watched.

### Supported fields (context)

This plugin focuses on JSON assets. Icon-related fields below are handled by `IconsPlugin`, but listed here for clarity of overall extension asset handling:

| Feature                       | Description                                         |
| ----------------------------- | --------------------------------------------------- |
| `icons`                       | Handled by IconsPlugin; emits to `icons/`.          |
| `action.default_icon`         | Handled by IconsPlugin; emits to `icons/`.          |
| `browser_action.default_icon` | Handled by IconsPlugin; emits to `icons/`.          |
| `browser_action.theme_icons`  | Handled by IconsPlugin; emits to `browser_action/`. |
| `page_action.default_icon`    | Handled by IconsPlugin; emits to `icons/`.          |
| `sidebar_action.default_icon` | Handled by IconsPlugin; emits to `icons/`.          |

Icon fields map to folders like `icons/` (for default_icon) and `browser_action/` (for theme_icons) and are emitted by the Icons feature.

### Compatibility

- Built and typed against `@rspack/core`.
- Webpack compatibility is not guaranteed.

### Learn more

- Extension.js website: `https://extension.js.org`
- Source repo: `https://github.com/extension-js/extension.js`

## License

MIT (c) Cezar Augusto
