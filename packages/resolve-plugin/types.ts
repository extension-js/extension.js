import {type LoaderContext} from 'webpack'
import { type ManifestBase } from './manifest-types'

export interface Callee {
  type: string
  object: {
    type: string
    object?: {
      type: string
      name: string
    }
    property?: {
      type: string
      name: string
    }
  }
  property?: {
    type: string
    name: string
  }
}

export interface BrowserExtensionContext extends LoaderContext<any> {
  getOptions: () => {
    test: string
    manifestPath: string
    includeList?: IncludeList
    exclude?: string[]
  }
}

export interface ResolvePluginInterface {
  manifestPath: string
  includeList?: IncludeList
  exclude?: string[]
}

export type IncludeList = Record<string, string>;

export type Manifest = ManifestBase