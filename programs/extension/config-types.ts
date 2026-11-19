//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// The published types for extension.config.js, and the source of the
// `import('extension').FileConfig` annotation. The engine has its own.

// Kept apart from the engine's so a project that annotates its config loads
// no bundler types. A spec compares the two key by key.

/** A browser target accepted by Extension.js commands. */
export type BrowserType =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium'
  | 'brave'
  | 'opera'
  | 'vivaldi'
  | 'yandex'
  | 'waterfox'
  | 'librewolf'
  | 'zen'
  | 'floorp'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'
  | 'safari'
  | 'webkit-based'
  | 'chromium-emulator'

/**
 * Companion extensions are "load-only" unpacked extension directories loaded
 * alongside the user extension in `dev`/`preview`/`start` (and `build` for
 * packaging scenarios). Each directory must be an unpacked extension root
 * containing a `manifest.json`.
 */
export type CompanionExtensionsConfig =
  | string[]
  | {
      /** Folder to scan one level deep for subfolders containing a manifest.json. */
      dir?: string
      /** Explicit extension directories to load (absolute or relative to the project root). */
      paths?: string[]
    }

/** Unified-logger output options shared by the long-running commands. */
interface UnifiedLoggerConfig {
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'all'
  logContexts?: (
    | 'background'
    | 'content'
    | 'page'
    | 'sidebar'
    | 'popup'
    | 'options'
    | 'devtools'
    | 'newtab'
    | 'history'
    | 'bookmarks'
  )[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

/**
 * Where the special folders live, relative to the project root. `false` skips
 * one entirely.
 */
export interface SpecialFoldersConfig {
  scripts?: string | false
  pages?: string | false
  public?: string | false
}

/**
 * One `include` source in its long form. `minify: false` ships a script as
 * authored where a production build would minify it.
 */
export interface IncludeFileEntry {
  /** The source path, relative to the project root. */
  from: string
  /**
   * Minify a `.js`, `.mjs` or `.cjs` source in a production build. Names
   * are shortened and comments dropped, and no statement is rewritten.
   * Defaults to `true`.
   */
  minify?: boolean
}

/**
 * Extra files for the build output. Each key is the output path, relative
 * to the extension root, and each value the source path, relative to the
 * project root, or `{from, minify}`. A folder source copies its tree under
 * the output path. A production build minifies the scripts among them.
 */
export type IncludeFilesConfig = Record<string, string | IncludeFileEntry>

/**
 * Files the build leaves out, each relative to the project root. A page or
 * script in a special folder named here gets no entry, a public file named
 * here is not copied. The lists of every config layer add up.
 */
export type ExcludeFilesConfig = string[]

/** Browser launch options shared across commands and per-browser overrides. */
interface BrowserLaunchConfig {
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  preferences?: Record<string, unknown>
  persistProfile?: boolean
  extensions?: CompanionExtensionsConfig
  transpilePackages?: string[]
}

/**
 * Safari app identity and packaging, read for `safari` and `webkit-based`
 * targets. A CLI flag of the same name wins over these.
 */
export interface SafariConfig {
  /** Safari binary to open after packaging. */
  safariBinary?: string
  /** Override the Safari app name. Defaults to the manifest `name`. */
  appName?: string
  /** Reverse-DNS bundle identifier. Defaults to a `dev.extensionjs.*` id. */
  bundleId?: string
  /** Apple Developer team id to sign with. Unset, the app is ad-hoc signed. */
  developmentTeam?: string
  /** Generate a macOS-only Xcode project. Defaults to `true`. */
  macOsOnly?: boolean
  /**
   * A square PNG, ideally 1024 px, used as is for the Safari app icon,
   * relative to the project. Unset, the manifest icon on a white plate.
   */
  appIcon?: string
  /** Regenerate the Xcode project even when it is up to date. */
  forceRegenerate?: boolean
}

/**
 * Per-browser configuration, keyed by {@link BrowserType} under
 * {@link FileConfig.browser}.
 */
export interface BrowserConfig extends BrowserLaunchConfig, SafariConfig {
  /**
   * The browser target. Optional here because it is implied by the key of the
   * {@link FileConfig.browser} map.
   */
  browser?: BrowserType
  profile?: string | false
  keepProfileChanges?: boolean
  copyFromProfile?: string
  startingUrl?: string
  noOpen?: boolean
  chromiumBinary?: string
  geckoBinary?: string
  firefoxBinary?: string
  /** Where the special folders live for this browser, or `false` to skip one. */
  folders?: SpecialFoldersConfig
  /** Extra files for this browser's output, added to the top-level `include`. */
  include?: IncludeFilesConfig
  /** Files this browser's build leaves out, added to the top-level `exclude`. */
  exclude?: ExcludeFilesConfig
  /** Compile-time constants for this browser, over the top-level map. */
  define?: Record<string, unknown>
  /** Asset budgets for this browser, over the top-level budgets. */
  perfBudgets?: PerfBudgetsConfig
}

/**
 * Asset categories the perf-budgets plugin recognizes. `shared` is the chunk
 * every page that imports a framework or a common module loads. `public` is
 * a file copied from the public folder as authored. `wasm` is a WebAssembly
 * file only extension pages and workers fetch when they run it, such as an
 * onnxruntime or ffmpeg core, which cannot be split and gets 32 MiB by
 * default. `runtime` covers a WebAssembly file a content script or the
 * service worker reaches, and root-level runtime helpers emitted outside a
 * surface folder, 1 MiB by default.
 */
export type PerfBudgetCategory =
  | 'content-script'
  | 'service-worker'
  | 'page'
  | 'shared'
  | 'public'
  | 'runtime'
  | 'wasm'
  | 'ignored'

/**
 * Per-category asset size budgets (bytes) for compiling commands, plus
 * `ignore`, the output paths no budget applies to: exact paths as the
 * warning prints them, or globs where `*` stays inside one folder and `**`
 * spans folders. Set at the top level, under `browser.<vendor>.perfBudgets`
 * or under `commands.build.perfBudgets`. Only a production build checks them.
 *
 * @example
 * export default {
 *   perfBudgets: {
 *     wasm: 48 * 1024 * 1024,
 *     ignore: ['assets/ort-wasm-simd-threaded.asyncify.wasm']
 *   }
 * }
 */
export type PerfBudgetsConfig = Partial<
  Record<Exclude<PerfBudgetCategory, 'ignored'>, number>
> & {
  ignore?: string[]
  /** `'warn'` (default) reports an overrun, `'error'` fails the build. */
  onExceed?: 'warn' | 'error'
}

/** `commands.dev` overrides. */
export interface DevCommandConfig
  extends BrowserLaunchConfig,
    UnifiedLoggerConfig,
    SafariConfig {
  browser?: BrowserType
  profile?: string | false
  chromiumBinary?: string
  geckoBinary?: string
  noOpen?: boolean
  noBrowser?: boolean
  polyfill?: boolean
  hashContentScripts?: boolean
  perfBudgets?: PerfBudgetsConfig
  /**
   * Compile-time constants inlined into this command's bundles. Overrides the
   * top-level `define` for the keys it declares.
   */
  define?: Record<string, unknown>
  /**
   * Where the special folders live for this command, or `false` to skip one.
   * Replaces the top-level and per-browser `folders`.
   */
  folders?: SpecialFoldersConfig
  /**
   * Extra files for this command's output. Adds to the top-level and
   * per-browser `include` key by key.
   */
  include?: IncludeFilesConfig
  /**
   * Files this command's build leaves out. Adds to the top-level and
   * per-browser `exclude`.
   */
  exclude?: ExcludeFilesConfig
}

/** Shared `commands.start` / `commands.preview` overrides. */
export interface ServeCommandConfig
  extends BrowserLaunchConfig,
    UnifiedLoggerConfig {
  browser?: BrowserType
  profile?: string | false
  chromiumBinary?: string
  geckoBinary?: string
  noOpen?: boolean
  startingUrl?: string
  noBrowser?: boolean
  polyfill?: boolean
  port?: string | number
  host?: string
  /** Accepted for parity with `commands.dev`. These commands serve nothing. */
  publicHost?: string
  /**
   * Compile-time constants inlined into this command's bundles. Overrides the
   * top-level `define` for the keys it declares.
   */
  define?: Record<string, unknown>
  /**
   * Where the special folders live for this command, or `false` to skip one.
   * Replaces the top-level and per-browser `folders`.
   */
  folders?: SpecialFoldersConfig
  /**
   * Extra files for this command's output. Adds to the top-level and
   * per-browser `include` key by key.
   */
  include?: IncludeFilesConfig
  /**
   * Files this command's build leaves out. Adds to the top-level and
   * per-browser `exclude`.
   */
  exclude?: ExcludeFilesConfig
}

/** `commands.start` overrides. */
export interface StartCommandConfig extends ServeCommandConfig {
  /** Asset budgets for the build `start` runs. */
  perfBudgets?: PerfBudgetsConfig
}

/**
 * `commands.preview` overrides. Preview serves a build that already exists,
 * so the keys that shape a build do nothing here.
 */
export interface PreviewCommandConfig extends ServeCommandConfig {
  /** @deprecated Preview serves an existing build and ignores it. */
  polyfill?: boolean
  /** @deprecated Preview serves an existing build and ignores it. */
  transpilePackages?: string[]
  /** @deprecated Preview serves an existing build and ignores it. */
  define?: Record<string, unknown>
  /** @deprecated Preview serves an existing build and ignores it. */
  include?: IncludeFilesConfig
  /** @deprecated Preview serves an existing build and ignores it. */
  exclude?: ExcludeFilesConfig
}

/** `commands.build` overrides. */
export interface BuildCommandConfig extends SafariConfig {
  browser?: BrowserType
  /**
   * Base folder for the build output, relative to the project root. The
   * build writes `<outDir>/<browser>` instead of `dist/<browser>`, zip
   * included, so it can run beside a dev session that serves `dist`.
   */
  outDir?: string
  polyfill?: boolean
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
  /**
   * Folder the archives are written to, relative to the project root or
   * absolute. Defaults to the folder that holds the browser output, `dist`.
   * The file name and its browser suffix stay as `zipFilename` sets them.
   */
  zipDir?: string
  /**
   * Write a `.map` file beside each script and stylesheet of a production
   * build. The maps stay out of the zip. Defaults to `false`.
   */
  sourceMaps?: boolean
  silent?: boolean
  /**
   * Run addons-linter over Firefox production builds and print its findings
   * as warnings. Needs `addons-linter` installed. Defaults to `true`.
   */
  addonLint?: boolean
  /**
   * Minify first-party code in production builds. Defaults to `true` for
   * every target but `opera`, whose store reviews readable source only.
   */
  minify?: boolean
  extensions?: CompanionExtensionsConfig
  transpilePackages?: string[]
  perfBudgets?: PerfBudgetsConfig
  /**
   * Compile-time constants inlined into this command's bundles. Overrides the
   * top-level `define` for the keys it declares.
   */
  define?: Record<string, unknown>
  /**
   * Where the special folders live for this command, or `false` to skip one.
   * Replaces the top-level and per-browser `folders`.
   */
  folders?: SpecialFoldersConfig
  /**
   * Extra files for this command's output. Adds to the top-level and
   * per-browser `include` key by key.
   */
  include?: IncludeFilesConfig
  /**
   * Files this command's build leaves out. Adds to the top-level and
   * per-browser `exclude`.
   */
  exclude?: ExcludeFilesConfig
}

/**
 * The shape of `extension.config.js`.
 *
 * @example
 * ```js
 * // extension.config.js
 * \/** @type {import('extension').FileConfig} *\/
 * export default {
 *   browser: {
 *     chrome: {startingUrl: 'https://example.com'}
 *   }
 * }
 * ```
 */
export interface FileConfig {
  /** Per-browser configuration keyed by browser target. */
  browser?: {
    [K in BrowserType]?: BrowserConfig
  }
  /** Per-command overrides. */
  commands?: {
    dev?: DevCommandConfig
    start?: StartCommandConfig
    preview?: PreviewCommandConfig
    build?: BuildCommandConfig
  }
  /**
   * Companion extensions (load-only) applied to all commands unless overridden
   * per-command.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Default transpile allowlist for all commands. Per-command
   * `commands.<name>.transpilePackages` overrides this value.
   */
  transpilePackages?: string[]
  /**
   * Default per-category asset budgets, checked on a production build only.
   * `browser.<vendor>.perfBudgets` overrides them key by key, and
   * `commands.build.perfBudgets` overrides both.
   */
  perfBudgets?: PerfBudgetsConfig
  /**
   * Compile-time constants inlined into every bundle. Each key also gets an
   * ambient declaration generated into the project's `extension-env.d.ts`.
   */
  define?: Record<string, unknown>
  /** Where the special folders live, or `false` to skip one. */
  folders?: SpecialFoldersConfig
  /**
   * Extra files copied into the output, keyed by their output path, for
   * example `{'models/x.onnx': './models/x.onnx'}`. `browser.<vendor>.include`
   * and `commands.<name>.include` add to it key by key.
   */
  include?: IncludeFilesConfig
  /**
   * Files the build leaves out, each relative to the project root, for
   * example `['pages/offscreen.html']`. A page or script named here gets no
   * entry and emits nothing, a public file named here is not copied.
   * `browser.<vendor>.exclude` and `commands.<name>.exclude` add to it.
   */
  exclude?: ExcludeFilesConfig
  /**
   * Escape hatch to customize the underlying Rspack/webpack-compatible
   * configuration. Receives and returns a bundler `Configuration` object.
   * Typed loosely to avoid requiring bundler types in consumer projects.
   * The second argument names the target browser, the bundler mode and
   * the command.
   */
  // biome-ignore lint/suspicious/noExplicitAny: public config API stays loose so user projects need no bundler types
  config?: (config: any, context: ConfigHookContext) => any
  /**
   * Runs once the bundler config is final, right before the first build, with
   * every loader rule attached. It can change `module`, `resolve`,
   * `resolveLoader`, `node`, `optimization.minimize`, `optimization.minimizer`
   * and the `output` options read at build time, such as file names and
   * `environment`. Every other key is fixed by then (`entry`, `plugins`,
   * `mode`, `devtool`, `target`, `externals`, `output.path`, the rest of
   * `optimization`): a change is ignored with a warning, use `config`.
   * The second argument is the same context `config` receives.
   */
  configResolved?: (
    // biome-ignore lint/suspicious/noExplicitAny: public config API stays loose so user projects need no bundler types
    config: any,
    context: ConfigHookContext
    // biome-ignore lint/suspicious/noExplicitAny: public config API stays loose so user projects need no bundler types
  ) => any
}

/** What the `config` and `configResolved` hooks are told about the run. */
export interface ConfigHookContext {
  /** The browser the command targets, as `--browser` names it. */
  browser: BrowserType
  /** The bundler mode of the run. */
  mode: 'development' | 'production' | 'none'
  /** The command that started the run. */
  command: 'dev' | 'build' | 'start' | 'preview'
  /**
   * The bundler this run compiles with, the same object `@rspack/core`
   * exports as `rspack`. Read plugin classes from it, for example
   * `new rspack.ProvidePlugin({...})`, instead of importing a bundler the
   * project may not have or may have in another version.
   */
  // biome-ignore lint/suspicious/noExplicitAny: public config API stays loose so user projects need no bundler types
  rspack: any
}
