export type InstallBrowserTarget = 'chrome' | 'chromium' | 'edge' | 'firefox'

const BROWSER_ALIASES: Record<string, InstallBrowserTarget> = {
  chrome: 'chrome',
  chromium: 'chromium',
  edge: 'edge',
  firefox: 'firefox',
  'chromium-based': 'chromium',
  'gecko-based': 'firefox',
  'firefox-based': 'firefox'
}

export function normalizeBrowserName(input: string): InstallBrowserTarget {
  const value = String(input || '')
    .trim()
    .toLowerCase()
  const resolved = BROWSER_ALIASES[value]

  if (resolved) return resolved

  throw new Error(
    `Unsupported browser "${value}". Supported values: ${Object.keys(BROWSER_ALIASES).join(', ')}`
  )
}
