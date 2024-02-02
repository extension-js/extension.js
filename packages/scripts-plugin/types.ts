export interface ScriptsPluginInterface {
  manifestPath: string
  include?: string[]
  exclude?: string[]
}

export interface StepPluginInterface {
  manifestPath: string
  includeList: IncludeList
  exclude: string[]
}

export interface IncludeList {
  [key: string]: string
}
