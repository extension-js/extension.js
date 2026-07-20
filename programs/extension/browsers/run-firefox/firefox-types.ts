// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {PluginInterface} from '../browsers-types'
import type {FirefoxRDPController} from './rdp/rdp-extension-controller'

export type FirefoxPluginLike = Pick<
  PluginInterface,
  | 'extension'
  | 'browserFlags'
  | 'profile'
  | 'persistProfile'
  | 'keepProfileChanges'
  | 'copyFromProfile'
  | 'preferences'
  | 'startingUrl'
  | 'geckoBinary'
  | 'instanceId'
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
}

export interface FirefoxPluginRuntime extends FirefoxPluginLike {
  rdpController?: FirefoxRDPController
  browserVersionLine?: string
}
