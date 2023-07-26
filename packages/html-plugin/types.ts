export interface HtmlPluginInterface {
  manifestPath: string
  exclude?: string[]
  experimentalHMREnabled?: boolean
}

export interface OutputPath {
  backgroundPage?: string
  bookmarks?: string
  history?: string
  newtab?: string
  devtools?: string
  options?: string
  action?: string
  settings?: string
  sidebar?: string
  sandbox?: string
  sidePanel?: string
}

export type ResourceType =
  | 'script'
  | 'css'
  | 'html'
  | 'static'
  | 'staticSrc'
  | 'staticHref'
  | 'empty'
