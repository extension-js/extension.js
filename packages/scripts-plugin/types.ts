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

export type IncludeList = Record<string, string>;
