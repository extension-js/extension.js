import {type DevOptions} from '../../commands/commands-lib/config-types'

export interface PluginInterface extends PluginOptions {
  manifestPath: string
}

export interface PluginOptions {
  browser?: DevOptions['browser']
  port?: number
  stats?: boolean
  autoReload?: boolean
}
