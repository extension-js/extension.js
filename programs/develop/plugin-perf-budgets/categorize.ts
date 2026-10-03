// ██████╗ ███████╗██████╗ ███████╗      ██████╗ ██╗   ██╗██████╗  ██████╗ ███████╗████████╗███████╗
// ██╔══██╗██╔════╝██╔══██╗██╔════╝      ██╔══██╗██║   ██║██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██╔════╝
// ██████╔╝█████╗  ██████╔╝█████╗  █████╗██████╔╝██║   ██║██║  ██║██║  ███╗█████╗     ██║   ███████╗
// ██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ╚════╝██╔══██╗██║   ██║██║  ██║██║   ██║██╔══╝     ██║   ╚════██║
// ██║     ███████╗██║  ██║██║          ██████╔╝╚██████╔╝██████╔╝╚██████╔╝███████╗   ██║   ███████║
// ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝          ╚═════╝  ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {classifyEntrySurface, SHARED_CHUNK_DIR} from '../lib/split-chunks'

export const ASSET_CATEGORIES = [
  'content-script',
  'service-worker',
  'page',
  'shared',
  'public',
  'runtime',
  'ignored'
] as const

// The public PerfBudgetCategory in the extension package mirrors this list by
// hand, and a spec there compares both so a new category cannot be left out.
export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

const isCodeAsset = (name: string) => /\.(js|css|wasm)$/i.test(name)
const isSourceMap = (name: string) => /\.map$/i.test(name)
const isHotUpdate = (name: string) => /(^|\/)hot\//.test(name)
const isSharedChunk = (name: string) => name.startsWith(`${SHARED_CHUNK_DIR}/`)
const isServiceWorkerFile = (name: string) =>
  /(^|\/)service[-_]?worker\.(js|css|wasm)$/i.test(name)

// The layout split-chunks reads: the script surfaces load one file each,
// every other folder is a page the HTML links. A file the public/ copier
// shipped as authored is told apart by its asset info, not by its path.
export function categorizeAsset(
  rawName: string,
  info?: {copied?: boolean}
): AssetCategory {
  const name = String(rawName || '').replace(/\\/g, '/')
  if (!name) return 'ignored'
  if (!isCodeAsset(name)) return 'ignored'
  if (isSourceMap(name)) return 'ignored'
  if (isHotUpdate(name)) return 'ignored'
  if (info?.copied) return 'public'
  if (isSharedChunk(name)) return 'shared'

  const surface = classifyEntrySurface(name)

  // MV3 service worker and MV2 background scripts both wake from cold and share
  // one budget; match both emitted names plus the top-level fallback.
  if (surface === 'background' || isServiceWorkerFile(name)) {
    return 'service-worker'
  }

  if (surface === 'content_script' || surface === 'script') {
    return 'content-script'
  }

  // Hashed wasm cores and sibling runtime helpers (ffmpeg, tesseract, …)
  // emit at the output root, not under a named surface folder. Count them
  // so the size report is not fiction for the largest thing in the package.
  if (!name.includes('/') || /\.wasm$/i.test(name)) return 'runtime'

  return 'page'
}

export const BUDGET_BYTES: Record<AssetCategory, number> = {
  'content-script': 512 * 1024,
  'service-worker': 512 * 1024,
  page: 1024 * 1024,
  shared: 512 * 1024,
  public: 1024 * 1024,
  runtime: 1024 * 1024,
  ignored: Number.POSITIVE_INFINITY
}
