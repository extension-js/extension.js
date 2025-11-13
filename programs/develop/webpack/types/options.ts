import {Configuration} from '@rspack/core'

export type BrowserType =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium'
  | 'chromium-based'
  | 'gecko-based'

export interface BrowserOptionsBase {
  open?: boolean
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
  // Narrow down the options based on `browser`
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
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
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
  silent?: boolean
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
}

export interface FileConfig {
  browser?: {
    chrome?: BrowserConfig
    firefox?: BrowserConfig
    edge?: BrowserConfig
    'chromium-based'?: BrowserConfig
    'gecko-based'?: BrowserConfig
  }
  commands?: {
    dev?: Pick<
      DevOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'open'
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
      }

    start?: Pick<
      StartOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
      | 'polyfill'
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
    }

    preview?: Pick<
      PreviewOptions,
      | 'browser'
      | 'profile'
      | 'chromiumBinary'
      | 'geckoBinary'
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
    }

    build?: Pick<
      BuildOptions,
      'browser' | 'zipFilename' | 'zip' | 'zipSource' | 'polyfill'
    >
  }
  config?: (config: Configuration) => Configuration
}
