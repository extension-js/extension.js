// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {PluginInterface} from '../browsers-types'
import type {FirefoxRDPController} from './firefox-source-inspection/rdp-extension-controller'

/**
 * Narrowed plugin options used through the Firefox flow.
 */
export type FirefoxPluginLike = Pick<
  PluginInterface,
  | 'extension'
  | 'browserFlags'
  | 'profile'
  | 'preferences'
  | 'startingUrl'
  | 'geckoBinary'
  | 'instanceId'
  | 'watchSource'
  | 'sourceFormat'
  | 'sourceSummary'
  | 'sourceMeta'
  | 'sourceProbe'
  | 'sourceTree'
  | 'sourceConsole'
  | 'sourceDom'
  | 'sourceMaxBytes'
  | 'sourceRedact'
  | 'sourceIncludeShadow'
  | 'sourceDiff'
  | 'port'
  | 'logLevel'
  | 'logContexts'
  | 'logFormat'
  | 'logTimestamps'
  | 'logColor'
  | 'logUrl'
  | 'logTab'
  | 'dryRun'
> & {
  browser: PluginInterface['browser']
  source?: string | boolean
  extensionsToLoad?: string[]
}

/**
 * Runtime state in Firefox flow.
 */
export interface FirefoxPluginRuntime extends FirefoxPluginLike {
  rdpController?: FirefoxRDPController
  browserVersionLine?: string
}
