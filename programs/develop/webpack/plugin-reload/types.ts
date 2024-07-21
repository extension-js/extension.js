import {DevOptions} from '../../develop-types'

export interface PluginInterface extends PluginOptions {
  manifestPath: string
}

export interface PluginOptions {
  browser?: DevOptions['browser']
  port?: number
  stats?: boolean
  autoReload?: boolean
}
