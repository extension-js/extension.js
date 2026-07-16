//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

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

  if (value === 'safari' || value === 'webkit-based') {
    throw new Error(
      `There is no Safari binary to install — Safari ships with macOS. ` +
        `Safari builds need the full Xcode app instead (Mac App Store), then ` +
        `run \`extension build --browser safari\`.`
    )
  }

  throw new Error(
    `Unsupported browser "${value}". Supported values: ${Object.keys(BROWSER_ALIASES).join(', ')}`
  )
}
