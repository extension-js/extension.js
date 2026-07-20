// ██████╗ ███████╗██████╗ ███████╗      ██████╗ ██╗   ██╗██████╗  ██████╗ ███████╗████████╗███████╗
// ██╔══██╗██╔════╝██╔══██╗██╔════╝      ██╔══██╗██║   ██║██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██╔════╝
// ██████╔╝█████╗  ██████╔╝█████╗  █████╗██████╔╝██║   ██║██║  ██║██║  ███╗█████╗     ██║   ███████╗
// ██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ╚════╝██╔══██╗██║   ██║██║  ██║██║   ██║██╔══╝     ██║   ╚════██║
// ██║     ███████╗██║  ██║██║          ██████╔╝╚██████╔╝██████╔╝╚██████╔╝███████╗   ██║   ███████║
// ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝          ╚═════╝  ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Extension-specific budgets: content scripts inject on every navigation and
// SWs wake cold, but framework runtimes make 512/512/1024 KiB the realistic bar.

export type AssetCategory =
  | 'content-script'
  | 'service-worker'
  | 'page'
  | 'ignored'

const PAGE_DIRS = [
  'pages',
  'sidebar',
  'popup',
  'options',
  'options_ui',
  'devtools',
  'newtab',
  'sandbox',
  'action',
  'browser_action',
  'page_action'
] as const

const isCodeAsset = (name: string) => /\.(js|css|wasm)$/i.test(name)
const isSourceMap = (name: string) => /\.map$/i.test(name)
const isHotUpdate = (name: string) => /(^|\/)hot\//.test(name)

export function categorizeAsset(rawName: string): AssetCategory {
  const name = String(rawName || '').replace(/\\/g, '/')
  if (!name) return 'ignored'
  if (!isCodeAsset(name)) return 'ignored'
  if (isSourceMap(name)) return 'ignored'
  if (isHotUpdate(name)) return 'ignored'

  if (/(^|\/)content_scripts\//.test(name)) return 'content-script'

  // MV3 service worker and MV2 background scripts both wake from cold and share
  // one budget; match both emitted names plus the top-level fallback.
  if (
    /(^|\/)background\//.test(name) ||
    /(^|\/)service[-_]?worker\.(js|css|wasm)$/i.test(name)
  ) {
    return 'service-worker'
  }

  for (const dir of PAGE_DIRS) {
    if (new RegExp(`(^|\\/)${dir}\\/`).test(name)) return 'page'
  }

  return 'ignored'
}

export const BUDGET_BYTES: Record<AssetCategory, number> = {
  'content-script': 512 * 1024,
  'service-worker': 512 * 1024,
  page: 1024 * 1024,
  ignored: Number.POSITIVE_INFINITY
}
