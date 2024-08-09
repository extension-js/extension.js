import {type DevOptions} from '../../commands/dev'

export interface PluginInterface extends PluginOptions {
  manifestPath: string
}

export interface PluginOptions {
  browser?: DevOptions['browser']
  port?: number
  stats?: boolean
  autoReload?: boolean
}
