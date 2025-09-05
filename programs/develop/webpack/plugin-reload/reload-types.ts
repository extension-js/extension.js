import {type DevOptions} from '../../develop-lib/config-types'

export type LogLevel =
  | 'off'
  | 'error'
  | 'warn'
  | 'info'
  | 'log'
  | 'debug'
  | 'trace'
  | 'all'

export type LogContext =
  | 'background'
  | 'content'
  | 'page'
  | 'sidebar'
  | 'popup'
  | 'options'
  | 'devtools'

export interface PluginInterface extends PluginOptions {
  manifestPath: string
}

export interface PluginOptions {
  browser?: DevOptions['browser']
  port?: string | number
  stats?: boolean
  autoReload?: boolean
  // Internal auto-generated instance ID, not user-configurable
  instanceId?: string
  // Source inspection options
  source?: string
  watchSource?: boolean
  startingUrl?: string
  // Unified logger CLI output options (plumbed to startServer)
  logLevel?: LogLevel
  // Can be comma-separated string from CLI, array, 'all', or undefined
  logContexts?: LogContext[] | string
  logFormat?: 'pretty' | 'json'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}
