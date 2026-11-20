[powered-image]: https://img.shields.io/badge/Empowering-Extension.js-0065e6
[powered-url]: https://extension.js.org
[pr-welcome-image]: https://img.shields.io/badge/pull--requests-welcome-2ecc40
[pr-welcome-url]: https://github.com/extension-js/extension.js/pulls

[![Empowering Extension.js][powered-image]][powered-url] [![Pull requests welcome][pr-welcome-image]][pr-welcome-url]

# plugin-compilation

> Compilation-level plugins for the develop bundler: environment files, zip packaging, watch helpers and the one-line compile summary.

### What it does

- **CompilationPlugin**: The entry rspack-config registers. It hides three known third-party "Critical dependency" warnings from `node_modules`, applies `CaseSensitivePathsPlugin`, `EnvPlugin` and `FileRequestsPlugin`, adds `ZipPlugin` when a zip is asked for on any command but `dev`, and adds `BoringPlugin`. It also adds `WatchProjectConfigPlugin`, `WatchRealProjectPathPlugin` and `WarmAncestorWatchersPlugin`, which act only once `compiler.watch()` runs, so a one-shot build passes them by. On `dev` and `preview` it also prints the raw errors and warnings, which `build` and `start` print through their own stats handler. `process.env.NODE_ENV` comes from rspack's own `optimization.nodeEnv`, which follows the mode.
- **EnvPlugin**: Reads every env file that exists for the running browser and mode and merges them key by key, weakest first: `.env.defaults`, `.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local`, then `.env.<browser>` and `.env.<browser>.<mode>` for each name of the browser family, ending with the exact browser name. A later file wins for a key both set, and the process environment wins over every file. The list and its order come from the config loader, so `extension.config.js` and the bundle see the same values. When the project has none of these files, the nearest folder with a `pnpm-workspace.yaml` is read the same way. `.env.example` is never read. Only `EXTENSION_PUBLIC_*` values reach JavaScript, through both `process.env` and `import.meta.env`, next to `EXTENSION_PUBLIC_BROWSER`, `EXTENSION_PUBLIC_MODE`, `EXTENSION_BROWSER`, `EXTENSION_MODE`, `BROWSER` and `MODE`. These are replaced as text in every module, dependencies included, so a package that reads `process.env.MODE` gets the build mode. The same replacement turns a `global` the code does not declare into `globalThis`, and `import.meta.dirname` and `import.meta.filename` into `undefined`. A bare `import.meta.url` reads the page or extension root URL at runtime, never a build machine path. A write to a replaced name, such as `process.env.EXTENSION_PUBLIC_X = 'v'`, is kept as a write to the runtime env object instead of becoming invalid code, and the build warns (`W_ENV_DEFINE_WRITTEN`) for project code, because dotted reads of that name keep the build value. In emitted `.json` and `.html` files, a `$EXTENSION_PUBLIC_*` placeholder is replaced with its value, escaped for where it lands, and so are `$EXTENSION_BROWSER` and `$EXTENSION_MODE`. Any other `$EXTENSION_*` placeholder is left as written, and the build warns when a variable of that name is set. An env file that sets `EXTENSION_PUBLIC_BROWSER`, `EXTENSION_PUBLIC_MODE`, `EXTENSION_BROWSER` or `EXTENSION_MODE` to anything but the build target earns a warning that names the variable and the file, because the build target always wins for those names. An env file that is a folder or cannot be read stops the build with `E_ENV_FILE_UNREADABLE`, naming the file. Under a watch run, `WatchEnvFilesPlugin` reports an edited env file.
- **`process` in a bundle**: A browser has no `process`, so a bundle that reads it gets a small object generated for that build, with `platform: 'browser'`, `nextTick`, `cwd()` and no-op event methods. Its `process.env` carries the same public keys as `import.meta.env`, so `process.env[name]` and `const {EXTENSION_PUBLIC_X} = process.env` read the same values as the dotted form. A dotted `process.env.EXTENSION_PUBLIC_X` read is still inlined as a literal, and a bundle that never reads `process` carries none of this.
- **ZipPlugin**: Writes `<name>-<version>-<browser>.zip` from the output folder and, with `zipSource`, `<name>-<version>-source.zip` from the project, beside the browser folder. What each zip leaves out:
  - **Source zip, silently**: `.git`, `node_modules`, `.extension-js`, env files other than `*.example`, the top-level `dist`, the output folder, the session folder and any zip beside it, companion extensions under `./extensions` (the folder that holds the project's own manifest is packed), `.DS_Store`, `Thumbs.db` and `desktop.ini`, the `.claude` and `.vercel` folders at any depth, and whatever the root `.gitignore` or a nested one ignores. `.vscode` and `.idea` are packed.
  - **Source zip, listed in a warning**: symlinks. Session folders: a `dist` at any depth that holds an `extension-js` folder is left out whole, and so is any other folder named `extension-js` unless it holds a `package.json` and no session files. Key files: `*.pem`, `*.crx`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.ppk`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, and a `*.key` file whose text holds a PEM private key header. Registry files: a `.npmrc`, `.yarnrc` or `.yarnrc.yml` in which `_authToken`, `_auth`, `_password`, `npmAuthToken` or `npmAuthIdent` has a value that is not an environment reference such as `${NPM_TOKEN}`. The warning names the file and never the value. Old archives: a `web-ext-artifacts` folder, any `*-source.zip`, and a zip named `<name>-<version>-<browser>.zip`. Build output: a folder named after a browser that holds a `manifest.json` and sits directly in a folder named `dist` or `build`.
  - **Source zip, packed**: `*.pub`, `*.crt` and `*.cer`, a registry file with no auth value of its own, any other `*.zip`, and a `dist` or `build` folder with no browser folder and no `extension-js` folder inside.
  - **Extension zip, silently**: source maps, `.DS_Store`, `Thumbs.db`, `desktop.ini` and the two archives of the same run.
  - **Extension zip, listed in a warning**: an `extension-js` folder that holds session files, env files other than `*.example`, any `*-source.zip` and a zip named `<name>-<version>-<browser>.zip`.

  File names are matched without regard to case. A file an ignore rule already covers is not listed. A source zip with no files in it is reported in a warning.
- **BoringPlugin**: Prints one line per compile, such as `My Extension compiled in 120 ms.`. Findings are counted: `compiled with 2 warnings in 120 ms.`, and a compile with errors reads `failed to compile with 1 error and 2 warnings in 120 ms.`. In `dev` the line comes after the diagnostics it counts. In `build` the caller prints them later, so the tap runs last in the `done` hook and a warning line ends with `, listed below.`. While a browser is launched, repeated startup passes print one line per severity until the first real change.

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

Only `EXTENSION_PUBLIC_*` values are inlined into JavaScript, and only they fill placeholders in emitted `.json` and `.html` files, whether the value comes from an env file or the shell. A placeholder that names a private variable, such as `$EXTENSION_SECRET_TOKEN`, stays as written and the build warns with the name and the file, never the value. The replacement runs over every emitted `.json` and `.html` file, copied `public/` files included, so a `$EXTENSION_PUBLIC_*` token in a copied file is filled as well. A file with no placeholder is never decoded and ships byte for byte, whatever its encoding. A file that holds a placeholder but is not UTF-8 ships byte for byte too, and the build warns (`W_ENV_ASSET_NOT_UTF8`). In HTML the value is escaped for the sink the placeholder sits in: entities in text, comments and attributes, a string, template or regular expression body inside a `<script>`, a JSON string body inside a JSON script, and a CSS string or `url()` body inside a `<style>`. A placeholder that stands as code in a script or a style sheet takes the value as written and only loses the power to close the element. A script that does not parse takes the string body that is inert in every quote. A value also cannot finish a terminator the authored text beside the placeholder began, such as `*` before an authored `/` in a comment or `/script` after an authored `<`, and an authored backslash right before a placeholder does not swallow the value's first character or the closing quote. In `_locales/<locale>/messages.json`, a token closed by a second `$`, such as `$EXTENSION_MODE$`, is the browser's own message placeholder and is left as written. A production build also warns when a public name looks like a secret.
