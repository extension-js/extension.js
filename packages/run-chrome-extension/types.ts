import {type ManifestBase} from './manifest-types'

export interface RunChromeExtensionInterface extends PluginOptions {
  manifestPath?: string
  extensionPath?: string
  stats?: StatsPreset
}

export interface PluginOptions {
  port?: number
  browserFlags?: string[]
  userDataDir?: string
  startingUrl?: string
  autoReload?: boolean | 'background'
}

export type StatsPreset =
  | boolean
  | 'errors-only' // Alternative: none - Only output when errors happen
  | 'errors-warnings' // Alternative: none - Only output errors and warnings happen
  | 'minimal' // Alternative: none - Only output when errors or new compilation happen
  | 'none' // Alternative: false -tput nothing
  | 'normal' // Alternative:	true - Standard output
  | 'verbose' // Alternative: none - Output everything
  | 'detailed' // Alternative: none - Output everything except chunkModules and chunkRootModules
  | 'summary' // Alternative: none - Output webpack version, warnings count and errors count

export type Manifest = ManifestBase
