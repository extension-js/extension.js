import {Configuration} from '@rspack/core'

export type BrowserType =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium-based'
  | 'gecko-based'

export interface BrowserOptionsBase {
  open?: boolean
  profile?: string
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
  mode: 'development' | 'production'
  polyfill?: boolean
  // Narrow down the options based on `browser`
  chromiumBinary?: ChromiumOptions['chromiumBinary']
  geckoBinary?: GeckoOptions['geckoBinary']
}

export interface BuildOptions {
  browser: BrowserOptionsBase['browser']
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
  silent?: boolean
}

export interface PreviewOptions extends BrowserOptionsBase {
  mode: 'production'
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
    > & {
      browserFlags?: string[]
      preferences?: Record<string, unknown>
    }

    start?: Pick<
      StartOptions,
      'browser' | 'profile' | 'chromiumBinary' | 'geckoBinary' | 'polyfill'
    > & {
      browserFlags?: string[]
      preferences?: Record<string, unknown>
    }

    preview?: Pick<
      PreviewOptions,
      'browser' | 'profile' | 'chromiumBinary' | 'geckoBinary'
    > & {
      browserFlags?: string[]
      preferences?: Record<string, unknown>
    }

    build?: Pick<
      BuildOptions,
      'browser' | 'zipFilename' | 'zip' | 'zipSource' | 'polyfill'
    >
  }
  config?: (config: Configuration) => Configuration
}
