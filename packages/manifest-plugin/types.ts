import {ManifestBase} from './manifest-types'

export interface ManifestPluginInterface {
  manifestPath: string
  exclude?: string[]
  browser?: string
}

export interface OutputPath {
  background?: string
  contentScripts?: string
  action?: string
  icons?: string
  actionIcon?: string
  settingsIcon?: string
  sidebarIcon?: string
  newtab?: string
  history?: string
  bookmarks?: string
  devtools?: string
  options?: string
  webResources?: string
  sandbox?: string
  sidebar?: string
  settings?: string
  userScripts?: string
  declarativeNetRequest?: string
  storage?: string
  sidePanel?: string
}

export type Manifest = ManifestBase
