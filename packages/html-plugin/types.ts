export interface HtmlPluginInterface {
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
  [key: string]:
    | {
        html: string
        js: string[]
        css: string[]
        static: string[]
      }
    | undefined
}

export type ResourceType =
  | 'script'
  | 'css'
  | 'html'
  | 'static'
  | 'staticSrc'
  | 'staticHref'
  | 'empty'
