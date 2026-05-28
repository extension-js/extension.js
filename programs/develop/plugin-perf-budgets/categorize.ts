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
// Hand-optimized extensions (uBlock Origin, Bitwarden, 1Password) keep
// content scripts well under 100 KiB, but framework-based templates
// (Vue, React, Preact, Svelte) ship a runtime that's ~150–225 KiB
// minified before any user code, and a real UI on top easily lands
// in the 300–500 KiB range. Shipping framework extensions in the wild
// (Bitwarden ~500–700 KiB SW, MetaMask multi-MiB UI pages, Grammarly
// 2–3 MiB content scripts) sit well above the old 256/200/500 KiB
// numbers. We set the budgets to 512/512/1024 KiB so the warning still
// fires on real outliers (multi-MiB AI sidebars, heavyweight WASM SWs)
// without crying wolf on every framework template scaffolded by
// `extension create`. Projects that legitimately need a tighter or
// looser budget can override per-category via `perfBudgets` in
// `extension.config.{js,ts}`.

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
  'content-script': 512 * 1024,
  'service-worker': 512 * 1024,
  page: 1024 * 1024,
  ignored: Number.POSITIVE_INFINITY
}
