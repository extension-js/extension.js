// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'

export const CERTIFICATE_DESTINATION_PATH = path.join(
  process.cwd(),
  'node_modules/extension-develop/dist/certs'
)

export const CHROMIUM_BASED_BROWSERS = [
  'chrome',
  'edge',
  'brave',
  'opera',
  'vivaldi',
  'yandex'
]
export const GECKO_BASED_BROWSERS = ['firefox', 'waterfox', 'librewolf']

export const SUPPORTED_BROWSERS = [
  ...CHROMIUM_BASED_BROWSERS,
  ...GECKO_BASED_BROWSERS
]

// Single source of truth for engine-family classification. Fork browsers inherit
// their family's chrome:/firefox: scoped manifest keys; the generic
// '*-based'/'chromium'/'gecko' aliases are matched by substring.
export function isChromiumBasedBrowser(browser: string): boolean {
  return (
    CHROMIUM_BASED_BROWSERS.includes(browser) ||
    String(browser).includes('chromium')
  )
}

export function isGeckoBasedBrowser(browser: string): boolean {
  return (
    GECKO_BASED_BROWSERS.includes(browser) || String(browser).includes('gecko')
  )
}
