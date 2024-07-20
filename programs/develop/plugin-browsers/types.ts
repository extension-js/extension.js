export interface PluginInterface extends PluginOptions {
  browser?: string
  extension: string | string[]
}

export interface PluginOptions {
  browserFlags?: string[]
  userDataDir?: string
  profile?: string
  preferences?: string
  startingUrl?: string
}
