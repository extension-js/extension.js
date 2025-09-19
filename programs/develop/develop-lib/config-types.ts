import {Configuration} from '@rspack/core'

export type BrowserType =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium-based'
  | 'gecko-based'

export interface BrowserOptionsBase {
  open?: boolean
  profile?: string | false
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
  // Source inspection options
  source?: string
  watchSource?: boolean
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
}

export interface StartOptions extends BrowserOptionsBase {
  mode: 'production'
  polyfill?: boolean
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
}

export interface BrowserConfig extends BrowserOptionsBase {
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  preferences?: Record<string, unknown>
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
  // When true, reuse a stable profile directory across runs when safe.
  // When concurrent runs of the same project+browser are detected or a lock is present,
  // fallback to per-instance profiles to avoid conflicts.
  reuseProfile?: boolean
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
    > & {
      browserFlags?: string[]
      excludeBrowserFlags?: string[]
      preferences?: Record<string, unknown>
    }

    start?: Pick<
      StartOptions,
      'browser' | 'profile' | 'chromiumBinary' | 'geckoBinary' | 'polyfill'
    > & {
      browserFlags?: string[]
      excludeBrowserFlags?: string[]
      preferences?: Record<string, unknown>
    }

    preview?: Pick<
      PreviewOptions,
      'browser' | 'profile' | 'chromiumBinary' | 'geckoBinary'
    > & {
      browserFlags?: string[]
      excludeBrowserFlags?: string[]
      preferences?: Record<string, unknown>
    }

    build?: Pick<
      BuildOptions,
      'browser' | 'zipFilename' | 'zip' | 'zipSource' | 'polyfill'
    >
  }
  config?: (config: Configuration) => Configuration
}
