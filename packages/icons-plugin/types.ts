import {type ManifestBase} from './manifest-types'

export interface IconsPluginInterface {
  manifestPath: string
  exclude?: string[]
}

export type Manifest = ManifestBase
