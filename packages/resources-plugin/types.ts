import {ManifestBase} from './manifest-types'

export interface WebResourcesPluginInterface {
  manifestPath: string
  exclude?: string[]
}

export type Manifest = ManifestBase
