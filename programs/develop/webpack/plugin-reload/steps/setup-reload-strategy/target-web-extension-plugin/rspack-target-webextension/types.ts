export interface BackgroundOptions {
  noWarningDynamicEntry?: boolean
  entry?: string // Deprecated, use pageEntry and serviceWorkerEntry instead.
  manifest?: 2 | 3 // Defaults to 2. Deprecated.
  pageEntry?: string
  serviceWorkerEntry?: string
  eagerChunkLoading?: boolean // Defaults to true
  classicLoader?: boolean // Defaults to true
}

export interface WebExtensionPluginOptions {
  background?: BackgroundOptions
  hmrConfig?: boolean // Defaults to true
  weakRuntimeCheck?: boolean
}
