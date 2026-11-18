[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-compilation

> Compilation-level plugins for the develop bundler: environment files, zip packaging, watch helpers and the one-line compile summary.

### What it does

- **CompilationPlugin**: The entry rspack-config registers. It hides three known third-party "Critical dependency" warnings from `node_modules`, applies `CaseSensitivePathsPlugin`, `EnvPlugin` and `FileRequestsPlugin`, adds `ZipPlugin` when a zip is asked for on any command but `dev`, and adds `BoringPlugin`. Under a watch run it also adds `WatchProjectConfigPlugin`, `WatchRealProjectPathPlugin` and `WarmAncestorWatchersPlugin`. On `dev` and `preview` it also prints the raw errors and warnings, which `build` and `start` print through their own stats handler. `process.env.NODE_ENV` comes from rspack's own `optimization.nodeEnv`, which follows the mode.
- **EnvPlugin**: Picks the first env file that exists, in this order: `.env.<browser>.<mode>`, `.env.<browser>`, the same two for each name of the browser family, `.env.<mode>`, `.env.local`, `.env`. It merges that file over `.env.defaults`, and the process environment wins over both. When the project has neither, the nearest folder with a `pnpm-workspace.yaml` is searched the same way. `.env.example` is never read. Only `EXTENSION_PUBLIC_*` values reach JavaScript, through both `process.env` and `import.meta.env`, next to `EXTENSION_PUBLIC_BROWSER`, `EXTENSION_PUBLIC_MODE`, `EXTENSION_BROWSER`, `EXTENSION_MODE`, `BROWSER` and `MODE`. In emitted `.json` and `.html` files, every `$EXTENSION_*` placeholder is replaced, escaped for where it lands. Under a watch run, `WatchEnvFilesPlugin` reports an edited env file.
- **`process` in a bundle**: A browser has no `process`, so a bundle that reads it gets a small object generated for that build, with `platform: 'browser'`, `nextTick`, `cwd()` and no-op event methods. Its `process.env` carries the same public keys as `import.meta.env`, so `process.env[name]` and `const {EXTENSION_PUBLIC_X} = process.env` read the same values as the dotted form. A dotted `process.env.EXTENSION_PUBLIC_X` read is still inlined as a literal, and a bundle that never reads `process` carries none of this.
- **ZipPlugin**: Writes `<name>-<version>-<browser>.zip` from the output folder and, with `zipSource`, `<name>-<version>-source.zip` from the project, beside the browser folder.
- **BoringPlugin**: Prints one line per compile, such as `My Extension compiled in 120 ms.`. While a browser is launched, repeated startup passes print one line per severity until the first real change.

### Usage

```ts
new CompilationPlugin({
  manifestPath,
  browser, // e.g. 'chrome' | 'firefox'
  command: 'build',
  zip: true
})
```

### API

```ts
export class CompilationPlugin {
  static readonly name: 'plugin-compilation'
  constructor(options: {
    manifestPath: string
    browser?: DevOptions['browser'] // 'chrome' when unset
    define?: Record<string, unknown> // extension.config.js constants, JSON-serialized
    zip?: boolean
    zipSource?: boolean
    zipFilename?: string
    zipDir?: string // absolute, the output folder's parent when unset
    port?: number
    command?: 'dev' | 'start' | 'preview' | 'build'
  })
  apply(compiler: import('@rspack/core').Compiler): void
}
```

### Security note

Only `EXTENSION_PUBLIC_*` values are inlined into JavaScript. Placeholder replacement in emitted `.json` and `.html` reads every `EXTENSION_*` variable, including ones set only in the shell, so keep secrets out of those placeholders.
