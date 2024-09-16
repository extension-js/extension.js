import {DevOptions} from '../commands/dev'

export interface PluginInterface extends PluginOptions {
  browser: DevOptions['browser']
  extension: string | string[]
}

export interface PluginOptions {
  browserFlags?: string[]
  userDataDir?: string
  profile?: string
  preferences?: Record<string, any>
  startingUrl?: string
  browserConsole?: boolean
  devtools?: boolean
  chromiumBinary?: string
  geckoBinary?: string
}
