//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Public type surface for `extension.config.js`.
//
// This file is published with the `extension` package and is the source of the
// `import('extension').FileConfig` type used to annotate `extension.config.js`.
//
// It is intentionally self-contained: the full internal definition lives in
// `extension-develop` (programs/develop/types.ts), but that package does not
// publish declaration files, and its `FileConfig` pulls in `@rspack/core`
// types via the `config` hook, which consumers of `extension` should not be
// required to install. Keep the shape here in sync with the internal
// `FileConfig` when the config contract changes.

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
 * Extra files for the build output. Each key is the output path, relative
 * to the extension root, and each value the source path, relative to the
 * project root. A folder source copies its tree under the output path.
 */
export type IncludeFilesConfig = Record<string, string>

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
 * Per-browser configuration, keyed by {@link BrowserType} under
 * {@link FileConfig.browser}.
 */
export interface BrowserConfig extends BrowserLaunchConfig {
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
}

/**
 * Asset categories the perf-budgets plugin recognizes. `shared` is the chunk
 * every page that imports a framework or a common module loads. `public` is
 * a file copied from the public folder as authored. `runtime` covers wasm
 * cores and root-level runtime helpers emitted outside a surface folder.
 */
export type PerfBudgetCategory =
  | 'content-script'
  | 'service-worker'
  | 'page'
  | 'shared'
  | 'public'
  | 'runtime'
  | 'ignored'

/**
 * Per-category asset size budgets (bytes) for compiling commands.
 * Set at the top level, or per command via `commands.dev|build.perfBudgets`.
 */
export type PerfBudgetsConfig = Partial<Record<PerfBudgetCategory, number>>

/** `commands.dev` overrides. */
export interface DevCommandConfig
  extends BrowserLaunchConfig,
    UnifiedLoggerConfig {
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
}

/** Shared `commands.start` / `commands.preview` overrides. */
export interface ServeCommandConfig
  extends BrowserLaunchConfig,
    UnifiedLoggerConfig {
  browser?: BrowserType
  profile?: string | false
  chromiumBinary?: string
  geckoBinary?: string
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
}

/** `commands.build` overrides. */
export interface BuildCommandConfig {
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
    start?: ServeCommandConfig
    preview?: ServeCommandConfig
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
   * Default per-category asset budgets for all commands. Per-command
   * `commands.dev|build.perfBudgets` overrides this value.
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
}
