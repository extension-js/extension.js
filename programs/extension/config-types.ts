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
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'
  | 'safari'
  | 'webkit-based'

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
  )[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

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
}

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
  publicHost?: string
}

/** `commands.build` overrides. */
export interface BuildCommandConfig {
  browser?: BrowserType
  polyfill?: boolean
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
  extensions?: CompanionExtensionsConfig
  transpilePackages?: string[]
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
   * Escape hatch to customize the underlying Rspack/webpack-compatible
   * configuration. Receives and returns a bundler `Configuration` object.
   * Typed loosely to avoid requiring bundler types in consumer projects.
   */
  // biome-ignore lint/suspicious/noExplicitAny: public config API stays loose so user projects need no bundler types
  config?: (config: any) => any
}
