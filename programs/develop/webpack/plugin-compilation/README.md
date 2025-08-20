[empowering-image]: https://img.shields.io/badge/Empowering-Extension.js-0971fe
[empowering-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls
[extensionjs-image]: https://img.shields.io/badge/Extension.js-0971fe

[![Empowering][empowering-image]][empowering-url] [![pull-requests][pr-welcome-image]][pr-welcome-url]

### @/webpack/plugin-compilation

> Compilation-level utilities for the develop bundler: environment handling, optional dist cleaning, and a compact compilation summary.

### What it does

- **EnvPlugin**: Loads environment files by priority (.env.<browser>.<mode> → .env.<browser> → .env.<mode> → .env.local → .env → .env.example); exposes `EXTENSION_PUBLIC_*` to both `process.env` and `import.meta.env`; defines `EXTENSION_PUBLIC_BROWSER`, `EXTENSION_PUBLIC_MODE`, `EXTENSION_BROWSER`, `EXTENSION_MODE`; replaces `$EXTENSION_PUBLIC_*` and `$EXTENSION__*` in emitted .json/.html.
- **CleanDistFolderPlugin**: Optionally deletes `dist/<browser>` at the start of a compilation to avoid stale hot-update files.
- **CompilationPlugin**: Applies CaseSensitivePathsPlugin; wires Env/Clean plugins; prints a single-line, de-duplicated compilation summary with `(Nx)` repetition.

### Feature overview

|                                                                            | Feature                                                                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Environment handling**<br/>Loads env files by priority, injects EXTENSION*PUBLIC*\* to process/import.meta, and templating. |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Clean dist**<br/>Optionally removes `dist/<browser>` at the start of a compilation.                                         |
| <img src="https://avatars.githubusercontent.com/u/172809806" width="56" /> | **Compilation summary**<br/>Single-line, de-duplicated summary shown at the end of builds.                                    |

### Usage

```ts
new CompilationPlugin({
  manifestPath,
  browser, // e.g. 'chrome' | 'firefox'
  clean: true // whether to remove dist/<browser> at start
})
```

### API

```ts
export class CompilationPlugin {
  static readonly name: 'plugin-compilation'
  constructor(options: {
    manifestPath: string
    browser?:
      | 'chrome'
      | 'edge'
      | 'firefox'
      | 'safari'
      | 'chromium-based'
      | 'gecko-based'
    clean?: boolean
  })
  apply(compiler: import('@rspack/core').Compiler): void
}
```

### Security note

Only variables prefixed with EXTENSION*PUBLIC* are injected into client code via DefinePlugin. Template replacement in .json/.html uses the merged environment; avoid embedding secrets in those files.
