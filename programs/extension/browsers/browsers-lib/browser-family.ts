// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {BrowserType} from '../browsers-types'

// Single source of truth for engine-family classification in the launch layer;
// keep aligned with develop's constants. Safari/webkit are deliberately in neither.

export const CHROMIUM_BROWSERS: ReadonlySet<string> = new Set([
  'chrome',
  'edge',
  'chromium',
  'brave',
  'opera',
  'vivaldi',
  'yandex',
  'chromium-based'
])

export const FIREFOX_BROWSERS: ReadonlySet<string> = new Set([
  'firefox',
  'waterfox',
  'librewolf',
  'gecko-based',
  'firefox-based'
])

export function isChromiumBrowser(browser: BrowserType | string): boolean {
  return CHROMIUM_BROWSERS.has(String(browser))
}

export function isFirefoxBrowser(browser: BrowserType | string): boolean {
  return FIREFOX_BROWSERS.has(String(browser))
}
