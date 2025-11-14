import type {PluginInterface} from '../browsers-types'

/**
 * Narrowed plugin options used through the Firefox flow.
 */
export type FirefoxPluginLike = Pick<
  PluginInterface,
  | 'extension'
  | 'browser'
  | 'browserFlags'
  | 'profile'
  | 'preferences'
  | 'startingUrl'
  | 'geckoBinary'
  | 'instanceId'
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
  extensionsToLoad?: string[]
}

/**
 * Runtime state in Firefox flow.
 */
export interface FirefoxPluginRuntime extends FirefoxPluginLike {
  rdpController?: unknown
}
