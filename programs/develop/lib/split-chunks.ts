// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Configuration} from '@rspack/core'

export type EntrySurface = 'page' | 'background' | 'content_script' | 'script'

// The slice of an rspack Chunk the predicates read. Kept structural so the
// guard specs can hand in a plain object.
export interface ChunkNameLike {
  name?: string | null
  canBeInitial?: () => boolean
}

// The MV2 background.page entry: an HTML document whose own markup loads
// every sibling chunk, unlike the service worker and the scripts list.
const BACKGROUND_PAGE_ENTRY = 'background/index'

// Every surface loads exactly one file per entry: the HTML tag, the
// background registration, the content_scripts list or the injection call.
export function classifyEntrySurface(entryName: string): EntrySurface {
  if (entryName === BACKGROUND_PAGE_ENTRY) return 'page'
  if (entryName.startsWith('background')) return 'background'
  if (entryName.startsWith('content_scripts/')) return 'content_script'
  if (entryName.startsWith('scripts/')) return 'script'
  // The manifest names one file for user_scripts.api_script, so the surface
  // loads that file alone and a sibling chunk never reaches it.
  if (entryName.startsWith('user_scripts/')) return 'script'

  return 'page'
}

// A page is the only surface that can load more than one file: the emitted
// HTML lists every sibling chunk, the other surfaces name a single script.
export function isPageChunkName(name: string | null | undefined): boolean {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    classifyEntrySurface(name) === 'page'
  )
}

// True for a named entry chunk whose surface cannot load a sibling file.
export function isSurfaceLockedChunkName(
  name: string | null | undefined
): boolean {
  return typeof name === 'string' && classifyEntrySurface(name) !== 'page'
}

function canBeInitial(chunk: ChunkNameLike): boolean {
  return typeof chunk.canBeInitial === 'function' ? chunk.canBeInitial() : true
}

// The default groups only touch the initial chunk of an HTML page, so
// background, content scripts and injected scripts keep one file each.
export function pageInitialChunks(chunk: ChunkNameLike): boolean {
  return canBeInitial(chunk) && isPageChunkName(chunk.name)
}

// The UI framework runtimes an extension page ships. Matched on the package
// directory so a pnpm store path and a flat node_modules both qualify.
export const FRAMEWORK_PACKAGE_PATTERN =
  /[\\/]node_modules[\\/](react|react-dom|scheduler|preact|vue|@vue|svelte|solid-js|lit|lit-html|lit-element|@lit)[\\/]/

// Only script modules move: a stylesheet shared by two pages stays in each
// page's own css file because the HTML links exactly one sheet per page.
const SCRIPT_MODULE_TYPE = /^javascript\//

export type SplitChunksConfig = NonNullable<
  NonNullable<Configuration['optimization']>['splitChunks']
>

// The output folder every chunk two or more pages share is emitted under.
export const SHARED_CHUNK_DIR = 'shared'

// HTML pages share code the way a web app does: the framework runtime in one
// file, everything two or more pages import in another. Stable names, no
// hash, so a manifest or a public asset can keep pointing at them.
export function defaultSplitChunks(): SplitChunksConfig {
  return {
    chunks: pageInitialChunks,
    cacheGroups: {
      default: false,
      defaultVendors: false,
      framework: {
        name: `${SHARED_CHUNK_DIR}/framework`,
        filename: `${SHARED_CHUNK_DIR}/framework.js`,
        test: FRAMEWORK_PACKAGE_PATTERN,
        type: SCRIPT_MODULE_TYPE,
        priority: 40,
        enforce: true,
        reuseExistingChunk: true
      },
      commons: {
        name: `${SHARED_CHUNK_DIR}/commons`,
        filename: `${SHARED_CHUNK_DIR}/commons.js`,
        type: SCRIPT_MODULE_TYPE,
        minChunks: 2,
        minSize: 0,
        priority: 20,
        reuseExistingChunk: true
      }
    }
  }
}
