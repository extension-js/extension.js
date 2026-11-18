// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export interface ContentScriptMeta {
  world?: 'main' | 'extension'
  bridgeBundleId?: string
  role?: string
  mainBundleId?: string
  index?: number
  bundleId?: string
}

// Emitted content script bundles by file name, so the chunk loader picks a
// loading strategy the world of each bundle can use.
export type ContentScriptsMeta = Record<string, ContentScriptMeta>

export interface ChunkLoadingBackgroundOptions {
  // The entry point of the background page.
  pageEntry?: string
  // The entry point of the service worker.
  serviceWorkerEntry?: string
  // Adds the background side of the message fallback, which injects a chunk
  // a content script could not import. On unless set to false.
  classicLoader?: boolean
}

export interface ChunkLoadingTargetOptions {
  background?: ChunkLoadingBackgroundOptions
  // Accepts a runtime with no extension API, for code a build step evaluates
  // outside a browser. Off unless set to true.
  weakRuntimeCheck?: boolean
  contentScriptsMeta?: ContentScriptsMeta
  // The build targets a Gecko browser, where a MAIN world file opens on the
  // read that takes the extension base.
  gecko?: boolean
  // The attribute the bridge of this extension writes the extension base
  // under, keyed per extension on a Gecko build.
  baseAttribute?: string
  // The one scheme the engine of this build serves an extension under, the
  // only one a base read off the document may have.
  baseScheme?: string
}
