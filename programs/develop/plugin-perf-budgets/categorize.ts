// Asset categorization for browser-extension performance budgets.
//
// Browser extensions have a different size profile than web apps:
//   • content scripts inject on EVERY page navigation — small budget;
//   • MV3 service workers wake from cold each time the event-page sleeps —
//     small budget keeps wake-up latency low;
//   • UI pages (sidebar, popup, options, devtools, newtab) are cold and
//     opened on demand — generous budget;
//   • images, fonts, locales, manifest.json don't have a code-splitting
//     fix — silenced from the budget warning entirely.
//
// Numbers are tuned to match what shipping extensions actually carry
// (uBlock Origin, Bitwarden, 1Password): content scripts well under
// 100 KiB, MV3 SWs under ~150 KiB, UIs in the 200–500 KiB range.

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

  // MV3 service worker; MV2 background scripts. Both wake from cold, both
  // share the same budget. Match `background/service_worker.js`,
  // `background/scripts.js`, and a top-level `service_worker.js` fallback.
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
  'content-script': 150 * 1024,
  'service-worker': 200 * 1024,
  page: 500 * 1024,
  ignored: Number.POSITIVE_INFINITY
}

export const CATEGORY_DESCRIPTIONS: Record<AssetCategory, string> = {
  'content-script':
    'content script — injected on every page navigation; keep under 150 KiB',
  'service-worker':
    'service worker / background — wakes from cold; keep under 200 KiB',
  page: 'page UI — cold-start; keep under 500 KiB',
  ignored: ''
}
