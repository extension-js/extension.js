import {DevOptions} from '../commands/commands-lib/config-types'

export interface PluginInterface extends PluginOptions {
  browser: DevOptions['browser']
  extension: string | string[]
}

export interface PluginOptions {
  open?: boolean
  browserFlags?: string[]
  profile?: string
  preferences?: Record<string, any>
  startingUrl?: string
  browserConsole?: boolean
  devtools?: boolean
  chromiumBinary?: string
  geckoBinary?: string
}
