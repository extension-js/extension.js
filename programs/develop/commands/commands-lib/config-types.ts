import {Configuration} from 'webpack'

export interface BrowserOptions {
  open?: boolean
  profile?: string
  startingUrl?: string
  browser: 'chrome' | 'edge' | 'firefox' | 'chromium-based' | 'gecko-based'
  chromiumBinary?: string
  geckoBinary?: string
}

export interface DevOptions extends BrowserOptions {
  mode: 'development' | 'production'
  polyfill?: boolean
}

export interface BuildOptions {
  browser: BrowserOptions['browser']
  zipFilename?: string
  zip?: boolean
  zipSource?: boolean
  polyfill?: boolean
  silent?: boolean
}

export interface PreviewOptions extends BrowserOptions {
  mode: 'production'
}

export interface StartOptions extends BrowserOptions {
  mode: 'production'
  polyfill?: boolean
}

export interface BrowserConfig extends BrowserOptions {
  browserFlags?: string[]
  preferences?: Record<string, unknown>
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
