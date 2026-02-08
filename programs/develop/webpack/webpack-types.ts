// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {
  type RspackPluginInstance,
  type LoaderContext as RspackLoaderContext
} from '@rspack/core'

export type ChromeManifest = Partial<chrome.runtime.ManifestV2> &
  Partial<chrome.runtime.ManifestV3> & {
    browser_action?: {
      theme_icons?: ThemeIcon[]
    }
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

export type HtmlFilepathList = Record<
  string,
  | {
      html: string
      js: string[]
      css: string[]
      static: string[]
    }
  | undefined
>

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
import type {CompanionExtensionsConfig} from './feature-special-folders/folder-extensions/types'

export type BrowserType =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'

export interface BrowserOptionsBase {
  noOpen?: boolean
  profile?: string | false
  /**
   * Opt-in persistent managed profile for development.
   * Defaults to false (ephemeral temp profiles are used).
   */
  persistProfile?: boolean
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

export interface NonBinaryOptions extends BrowserOptionsBase {
  browser: Exclude<BrowserType, 'chromium-based' | 'gecko-based'>
}

export type ExtendedBrowserOptions =
  | ChromiumOptions
  | GeckoOptions
  | NonBinaryOptions

export interface DevOptions extends BrowserOptionsBase {
  mode: 'development' | 'production' | 'none'
  polyfill?: boolean
  port?: string | number | undefined
  install?: boolean
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Skip launching the browser runner (dev server still starts).
   */
  noRunner?: boolean
  // Narrow down the options based on `browser`
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  // Packaging options (used when mode === 'production')
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
  // Source inspection options
  source?: string
  watchSource?: boolean
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
  logFormat?: 'pretty' | 'json'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

export interface BuildOptions {
  browser: BrowserOptionsBase['browser']
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
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
   * [internal] Auto-install project dependencies when missing.
   */
  install?: boolean
  // When true, treat warnings as build failures
  failOnWarning?: boolean
  // When false, extensionBuild rejects on error instead of exiting the process.
  // Defaults to true for CLI usage.
  exitOnError?: boolean
}

export interface PreviewOptions extends BrowserOptionsBase {
  mode: 'production'
  outputPath?: string
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  firefoxBinary?: GeckoOptions['geckoBinary']
  /**
   * Companion extensions (load-only) for this command.
   */
  extensions?: CompanionExtensionsConfig
  /**
   * Skip launching the browser runner (no preview window).
   */
  noRunner?: boolean
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
  // Source inspection options (parity with DevOptions)
  source?: string
  watchSource?: boolean
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
  logFormat?: 'pretty' | 'json'
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
   * Skip launching the browser runner (build still runs).
   */
  noRunner?: boolean
  // Port forwarding to browser runner (e.g., debugging/logging server)
  port?: string | number
  // Source inspection options (parity with DevOptions)
  source?: string
  watchSource?: boolean
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
  logFormat?: 'pretty' | 'json'
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
}

/**
 * Canonical options type for webpack-config consumers.
 * Accepts any of the command option fields (dev/preview/start/build),
 * while requiring browser and mode, and the common output settings.
 */
export type WebpackConfigOptions = CommonWebpackOptions &
  Partial<DevOptions & PreviewOptions & StartOptions & BuildOptions> & {
    browser: BrowserType
    mode: 'development' | 'production' | 'none'
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
      | 'noRunner'
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
      > & {
        browserFlags?: string[]
        excludeBrowserFlags?: string[]
        preferences?: Record<string, unknown>
        persistProfile?: boolean
        extensions?: CompanionExtensionsConfig
      }

    start?: Pick<
      StartOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'polyfill'
      | 'noRunner'
      | 'port'
      | 'source'
      | 'watchSource'
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
    }

    preview?: Pick<
      PreviewOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'noRunner'
      | 'port'
      | 'source'
      | 'watchSource'
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
    }

    build?: Pick<
      BuildOptions,
      'browser' | 'zipFilename' | 'zip' | 'zipSource' | 'polyfill'
    > & {
      extensions?: CompanionExtensionsConfig
    }
  }
  /**
   * Companion extensions (load-only) applied to commands unless overridden per-command.
   * This is merged into `commands.dev|start|preview|build` by the config loader.
   */
  extensions?: CompanionExtensionsConfig
  config?: (config: Configuration) => Configuration
}
