import {ManifestBase} from './manifest-types'

export interface JsonPluginInterface {
  manifestPath: string
  exclude?: string[]
}

export interface OutputPath {
  declarative_net_request?: string
  storage?: string
}

export type Manifest = ManifestBase
