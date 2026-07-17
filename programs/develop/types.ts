// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {
  type LoaderContext as RspackLoaderContext,
  type RspackPluginInstance
} from '@rspack/core'

/**
 * Firefox-only `theme_experiment` manifest key.
 * Not present in `@types/chrome`; declared here so the manifest pipeline can
 * read it type-safely instead of casting `manifest as any`.
 * @see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/theme_experiment
 */
export interface ThemeExperiment {
  stylesheet?: string
  stylesheets?: string[]
  // Firefox also allows colors/images/properties maps; kept open for forward-compat.
  [key: string]: unknown
}

export type ChromeManifest = Partial<chrome.runtime.ManifestV2> &
  Partial<chrome.runtime.ManifestV3> & {
    browser_action?: {
      theme_icons?: ThemeIcon[]
    }
    // Extension.js augments the standard omnibox shape with a `default_icon`
    // (string path or per-size record), which `@types/chrome` does not model.
    omnibox?: {
      keyword?: string
      default_icon?: string | Record<string, string>
    }
    // Firefox-only theming key (absent from `@types/chrome`).
    theme_experiment?: ThemeExperiment
  }

export type Manifest = ChromeManifest

export interface ThemeIcon {
  light: string
  dark: string
  size?: number
}

export type PluginInterface = {
  manifestPath: string
  browser?: DevOptions['browser']
  includeList?: FilepathList
  transpilePackages?: string[]
}

export interface LoaderInterface extends RspackLoaderContext<LoaderInterface> {
  manifestPath: string
  includeList?: FilepathList
}

export type FilepathList = Record<string, string | string[] | undefined>

export type ResourceType =
  | 'script'
  | 'css'
  | 'html'
  | 'static'
  | 'staticSrc'
  | 'staticHref'
  | 'empty'

export interface LoaderContext {
  resourcePath: string
  emitFile: (name: string, content: string) => void
  emitWarning?: (error: Error | string) => void
  getOptions: () => {
    test: string
    manifestPath: string
    browser?: DevOptions['browser']
    includeList?: FilepathList
    mode: string
  }
}

export interface JsFramework {
  plugins: RspackPluginInstance[] | undefined
  loaders: Record<string, any>[] | undefined
  alias: Record<string, string> | undefined
}

import {Configuration} from '@rspack/core'
import type {CompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/types'

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

export interface BrowserOptionsBase {
  noOpen?: boolean
  profile?: string | false
  /**
   * Opt-in persistent managed profile for development.
   * Defaults to false (ephemeral temp profiles are used).
   */
  persistProfile?: boolean
  /**
   * Keep the managed profile and its changes across runs (persistent `dev`
   * profile, skipped by cleanup). Seeded once when combined with
   * `copyFromProfile`.
   */
  keepProfileChanges?: boolean
  /**
   * Seed the managed profile as a copy of this profile directory on first
   * creation.
   */
  copyFromProfile?: string
  startingUrl?: string
  browser: BrowserType
}

export interface ChromiumOptions extends BrowserOptionsBase {
  browser: 'chromium-based'
  chromiumBinary?: string
}

export interface GeckoOptions extends BrowserOptionsBase {
  browser: 'gecko-based'
  geckoBinary?: string
}

export interface SafariOptions extends BrowserOptionsBase {
  browser: 'webkit-based'
  safariBinary?: string
  /** Override the Safari app name (defaults to the manifest name). */
  appName?: string
  /** User-owned bundle identifier (defaults to a dev.extensionjs.* id). */
  bundleId?: string
  /** Generate the macOS-only Xcode project (default true). */
  macOsOnly?: boolean
}

/**
 * Safari identity/packaging options resolved by develop (CLI flags merged
 * with extension.config.js `browser.safari`) and forwarded to the packager
 * the CLI injects.
 */
export interface SafariPackagerOverrides {
  appName?: string
  bundleId?: string
  macOsOnly?: boolean
  forceRegenerate?: boolean
  safariBinary?: string
}

export interface NonBinaryOptions extends BrowserOptionsBase {
  browser: Exclude<
    BrowserType,
    'chromium-based' | 'gecko-based' | 'webkit-based'
  >
}

export interface DevOptions extends BrowserOptionsBase {
  mode: 'development' | 'production' | 'none'
  polyfill?: boolean
  port?: string | number | undefined
  /**
   * Host to bind the dev server to.
   * Use '0.0.0.0' for Docker/devcontainer environments.
   * Defaults to '127.0.0.1'.
   */
  host?: string
  /**
   * Connectable host the browser (HMR client + control-bridge producer) dials,
   * when it differs from the bind `host` (e.g. a remote/devcontainer). Defaults
   * to the bind host, or 127.0.0.1 when bound to a wildcard like '0.0.0.0'.
   */
  publicHost?: string
  install?: boolean
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Skip launching the browser (dev server still starts).
   */
  noBrowser?: boolean
  // Browser flags and preferences forwarded to the browser launcher
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  // Narrow down the options based on `browser`
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  safariBinary?: SafariOptions['safariBinary']
  // Packaging options (used when mode === 'production')
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
  // Unified logger CLI output options
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
  hashContentScripts?: boolean
  // Safari identity/packaging inputs (safari/webkit-based targets only)
  appName?: SafariOptions['appName']
  bundleId?: SafariOptions['bundleId']
  macOsOnly?: SafariOptions['macOsOnly']
  forceRegenerate?: boolean
  safariPackager?: (
    distPath: string,
    mode: 'full' | 'resync',
    overrides?: SafariPackagerOverrides
  ) => Promise<void>
}

export interface BuildOptions {
  browser: BrowserOptionsBase['browser']
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  safariBinary?: SafariOptions['safariBinary']
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
  silent?: boolean
  /**
   * Override the bundler mode (and NODE_ENV). Defaults to 'production' to
   * preserve historical behavior. Setting 'development' is useful for
   * staging/QA dists that should still pass through the bundler's debug
   * pipeline (sourcemaps, looser minification). Mirrors `vite build --mode`
   * and `webpack --mode`.
   */
  mode?: 'development' | 'production' | 'none'
  /**
   * [internal] Auto-install project dependencies when missing.
   */
  install?: boolean
  // When true, treat warnings as build failures
  failOnWarning?: boolean
  // When true, a failed build calls process.exit(1) after the clean error
  // line — the CLI wrapper passes this. Defaults to false: as a library
  // import, a failed build is a rejected promise, never a dead host process.
  exitOnError?: boolean
  /**
   * Internal: the command stamped into ready.json/events.ndjson. Defaults to
   * 'build'; `extension start` passes 'start' for its build phase so the
   * receipt names the command the user actually ran.
   */
  metadataCommand?: 'dev' | 'start' | 'preview' | 'build'
  // Safari identity/packaging inputs (safari/webkit-based targets only)
  appName?: SafariOptions['appName']
  bundleId?: SafariOptions['bundleId']
  macOsOnly?: SafariOptions['macOsOnly']
  forceRegenerate?: boolean
  safariPackager?: (
    distPath: string,
    mode: 'full' | 'resync',
    overrides?: SafariPackagerOverrides
  ) => Promise<void>
}

export interface PreviewOptions extends BrowserOptionsBase {
  mode: 'production'
  outputPath?: string
  /**
   * Internal metadata command override used by start->preview delegation.
   * (Full command union so the WebpackConfigOptions intersection with
   * BuildOptions.metadataCommand doesn't narrow the field.)
   */
  metadataCommand?: 'dev' | 'start' | 'preview' | 'build'
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Skip launching the browser (no preview window).
   */
  noBrowser?: boolean
  /**
   * Internal auto-generated instance ID, not user-configurable.
   */
  instanceId?: string
  /**
   * Dry run mode (no browser launch) for diagnostics.
   */
  dryRun?: boolean
  // Port forwarding to browser runner (e.g., debugging/logging server)
  port?: string | number
  /**
   * Host to bind the dev server to.
   * Use '0.0.0.0' for Docker/devcontainer environments.
   * Defaults to '127.0.0.1'.
   */
  host?: string
  /**
   * Connectable host the browser (HMR client + control-bridge producer) dials,
   * when it differs from the bind `host` (e.g. a remote/devcontainer). Defaults
   * to the bind host, or 127.0.0.1 when bound to a wildcard like '0.0.0.0'.
   */
  publicHost?: string
  // Unified logger CLI output options (parity with DevOptions)
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

export interface StartOptions extends BrowserOptionsBase {
  mode: 'production'
  polyfill?: boolean
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * [internal] Auto-install project dependencies when missing.
   */
  install?: boolean
  /**
   * Skip launching the browser (build still runs).
   */
  noBrowser?: boolean
  // Port forwarding to browser runner (e.g., debugging/logging server)
  port?: string | number
  /**
   * Host to bind the dev server to.
   * Use '0.0.0.0' for Docker/devcontainer environments.
   * Defaults to '127.0.0.1'.
   */
  host?: string
  /**
   * Connectable host the browser (HMR client + control-bridge producer) dials,
   * when it differs from the bind `host` (e.g. a remote/devcontainer). Defaults
   * to the bind host, or 127.0.0.1 when bound to a wildcard like '0.0.0.0'.
   */
  publicHost?: string
  // Unified logger CLI output options (parity with DevOptions)
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

export interface BrowserConfig extends BrowserOptionsBase {
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  preferences?: Record<string, unknown>
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  safariBinary?: SafariOptions['safariBinary']
  // Safari identity/packaging inputs (browser.safari config)
  appName?: SafariOptions['appName']
  bundleId?: SafariOptions['bundleId']
  macOsOnly?: SafariOptions['macOsOnly']
  /**
   * Companion extensions (load-only) scoped to a browser config.
   * Useful for per-browser store URLs or local unpacked extensions.
   */
  extensions?: CompanionExtensionsConfig
}

// Shared output shape consumed by webpack-config
export type OutputConfig = {
  clean: boolean
  path: string
}

// Minimal common options webpack-config depends on, shared across commands
export interface CommonWebpackOptions {
  output: OutputConfig
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  /**
   * Workspace/dependency packages that should be transpiled from source.
   * Useful for monorepos where package exports point to TS/TSX files.
   */
  transpilePackages?: string[]
  perfBudgets?: Partial<
    Record<import('./plugin-perf-budgets').AssetCategory, number>
  >
  /**
   * Companion extensions (load-only). Each entry must be an unpacked extension root
   * containing a manifest.json. These are loaded alongside the user extension in
   * dev/preview/start (and can also be applied to build for packaging scenarios).
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Internal auto-generated instance ID, not user-configurable
   */
  instanceId?: string
  /**
   * Agent-bridge control channel (Slice 1). Injected by dev-server so the
   * PlaywrightPlugin can advertise them in ready.json (agent bridge).
   * Not user-configurable.
   */
  controlPort?: number | null
  controlPath?: string
  logsPath?: string
}

/**
 * Canonical options type for webpack-config consumers.
 * Accepts any of the command option fields (dev/preview/start/build),
 * while requiring browser and mode, and the common output settings.
 *
 * `mode` is omitted from the partial intersection because PreviewOptions
 * and StartOptions narrow it to `'production'`. Without the omit the
 * outer override below becomes ineffective: TypeScript intersects the
 * outer `'development' | 'production' | 'none'` with the inner
 * `'production'` and the input is locked back to `'production'`.
 */
export type WebpackConfigOptions = CommonWebpackOptions &
  Omit<
    Partial<DevOptions & PreviewOptions & StartOptions & BuildOptions>,
    'mode'
  > & {
    browser: BrowserType
    mode: 'development' | 'production' | 'none'
    // Injected by command-dev: the browser-runner plugin (Chromium/Firefox
    // launcher or the Safari packager). Both implement RunnerPlugin.
    browsersPlugin?: import('./plugin-browsers').RunnerPlugin
  }

export interface FileConfig {
  browser?: {
    // Allow configuration by any supported browser key
    // (kept wide to align with BrowserType and runtime mapping)
    [K in BrowserType]?: BrowserConfig
  }
  commands?: {
    dev?: Pick<
      DevOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'noOpen'
      | 'noBrowser'
      | 'polyfill'
    > &
      Pick<
        DevOptions,
        | 'logLevel'
        | 'logContexts'
        | 'logFormat'
        | 'logTimestamps'
        | 'logColor'
        | 'logUrl'
        | 'logTab'
        | 'hashContentScripts'
      > & {
        browserFlags?: string[]
        excludeBrowserFlags?: string[]
        preferences?: Record<string, unknown>
        persistProfile?: boolean
        extensions?: CompanionExtensionsConfig
        transpilePackages?: string[]
      }

    start?: Pick<
      StartOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'polyfill'
      | 'noBrowser'
      | 'port'
      | 'host'
      | 'publicHost'
      | 'logLevel'
      | 'logContexts'
      | 'logFormat'
      | 'logTimestamps'
      | 'logColor'
      | 'logUrl'
      | 'logTab'
    > & {
      browserFlags?: string[]
      excludeBrowserFlags?: string[]
      preferences?: Record<string, unknown>
      persistProfile?: boolean
      extensions?: CompanionExtensionsConfig
      transpilePackages?: string[]
    }

    preview?: Pick<
      PreviewOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'noBrowser'
      | 'port'
      | 'host'
      | 'publicHost'
      | 'logLevel'
      | 'logContexts'
      | 'logFormat'
      | 'logTimestamps'
      | 'logColor'
      | 'logUrl'
      | 'logTab'
    > & {
      browserFlags?: string[]
      excludeBrowserFlags?: string[]
      preferences?: Record<string, unknown>
      persistProfile?: boolean
      extensions?: CompanionExtensionsConfig
      transpilePackages?: string[]
    }

    build?: Pick<
      BuildOptions,
      'browser' | 'zipFilename' | 'zip' | 'zipSource' | 'polyfill'
    > & {
      extensions?: CompanionExtensionsConfig
      transpilePackages?: string[]
    }
  }
  /**
   * Companion extensions (load-only) applied to commands unless overridden per-command.
   * This is merged into `commands.dev|start|preview|build` by the config loader.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Default transpile allowlist for all commands.
   * Per-command `commands.<name>.transpilePackages` overrides this value.
   */
  transpilePackages?: string[]
  config?: (config: Configuration) => Configuration
}
