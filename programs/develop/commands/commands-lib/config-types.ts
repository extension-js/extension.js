import {Configuration} from 'webpack'
import {DevOptions} from '../dev'
import {PreviewOptions} from '../preview'
import {BuildOptions} from '../build'

type BrowserConfig = Pick<
  DevOptions,
  | 'open'
  | 'profile'
  | 'preferences'
  | 'browserFlags'
  | 'startingUrl'
  | 'chromiumBinary'
  | 'geckoBinary'
>

export interface FileConfig {
  browser?: {
    chrome?: BrowserConfig
    firefox?: BrowserConfig
    edge?: BrowserConfig
    'chromium-based'?: BrowserConfig
    'gecko-based'?: BrowserConfig
  }
  commands?: {
    dev?: Pick<DevOptions, 'browser' | 'profile' | 'preferences' | 'polyfill'>
    preview?: Pick<
      PreviewOptions,
      'browser' | 'profile' | 'preferences' | 'polyfill'
    >
    build?: Pick<
      BuildOptions,
      'browser' | 'zipFilename' | 'zip' | 'zipSource' | 'polyfill'
    >
  }
  config?: (config: Configuration) => Configuration
}
