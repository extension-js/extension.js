// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {
  BrowserLogSink,
  ExtensionLoadRetryResult,
  PluginInterface
} from '../browsers-types'
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
  // Resolved launch identity for the dev banner: the RDP layer prints the
  // card, the launcher owns the profile and binary, these carry them across.
  launchProfilePath?: string
  launchBinaryPath?: string
  launchBinaryProvenance?: 'managed' | 'pinned' | 'system' | 'snapshot'
  logSink?: BrowserLogSink
  // Gecko's reason for throwing the add-on out, set at launch. Withholds the
  // ready line, exactly as the Chromium runtime's twin field does.
  extensionLoadRefused?: string
  // Bound at the refusal so a later compile can re-offer the same dist.
  retryAddonInstall?: () => Promise<ExtensionLoadRetryResult>
}
