import {LoaderContext} from 'webpack'

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

export interface IncludeList {
  [key: string]: string
}
