[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-perf-budgets

> Size budgets per extension surface on a production build, in place of rspack's single `performance` limit.

### What it does

- **Production only**: The check runs when the compiler mode is `production`. In development, a `commands.dev.perfBudgets` block prints one notice that it has no effect.
- **One budget per surface**: Each emitted `.js`, `.mjs`, `.cjs`, `.css` or `.wasm` file is put in a category and checked against its budget. Source maps, hot updates and every other file type are not budgeted.

| Category         | Budget  | Which files                                                                                         |
| ---------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `content-script` | 512 KiB | a file the manifest names as a content script, or one under `content_scripts/`, `scripts/` or `user_scripts/` |
| `service-worker` | 512 KiB | a file the manifest names as the background, one under `background/`, or `service_worker.js` at the root |
| `shared`         | 512 KiB | a split chunk shared between entries                                                                |
| `page`           | 1 MiB   | any other file in a folder (popup, options, sidebar and other pages)                                |
| `public`         | 1 MiB   | a file copied from `public/`                                                                        |
| `runtime`        | 1 MiB   | a file at the output root, or a `.wasm` a content script or the background reaches                 |
| `wasm`           | 32 MiB  | a `.wasm` only pages and workers reach                                                              |

- **When the chunk graph cannot be read**: A `.wasm` file falls back to the `runtime` budget, the tighter one it could get.
- **Timing**: Sizes are read after the last asset stage, so a shim or byte order mark another plugin adds late is counted.
- **Overrun**: One warning lists the files over budget, largest first, at most 20, with the role of each and a remedy. With `onExceed: 'error'` the same text is a build error, so the build fails.

### Configuration

The `perfBudgets` key of `extension.config.js`, at the top level or under `commands.build`:

```js
export default {
  perfBudgets: {
    wasm: 48 * 1024 * 1024, // bytes, one key per category above
    ignore: ['assets/*.wasm'], // output paths, `*` within a folder, `**` across folders
    onExceed: 'error' // or 'warn', the default
  }
}
```

- A budget must be a finite number of bytes above 0, `ignore` an array of strings and `onExceed` `'warn'` or `'error'`. Anything else stops the build with `E_CONFIG_LOAD` and names the key.
- A key that is not a category, `ignore` or `onExceed` prints one notice that nothing reads it.

### API

```ts
export class PerfBudgetsPlugin {
  static readonly name: 'plugin-perf-budgets'
  constructor(options?: {enabled?: boolean; budgets?: PerfBudgetsConfig})
  apply(compiler: import('@rspack/core').Compiler): void
}
```

`enabled` overrides the production-only default. `resolvePerfBudgets` validates a `perfBudgets` block on its own, and `categorizeAsset` names the category of one output file.
