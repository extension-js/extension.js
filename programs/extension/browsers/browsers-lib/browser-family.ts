// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {BrowserType} from '../browsers-types'

// Single source of truth for engine-family classification in the browser-launch
// layer. Fork browsers inherit their family's launcher and binary resolution:
// Chromium forks (brave/opera/vivaldi/yandex) run through the chromium launcher,
// gecko forks (waterfox/librewolf) through the firefox launcher. The generic
// '*-based' aliases resolve the same way. Keep this aligned with
// extension-develop's lib/constants.ts classification.
//
// Safari/webkit are intentionally NOT in either family here — they have their
// own run-safari launch path.

const CHROMIUM_BROWSERS: ReadonlySet<string> = new Set([
  'chrome',
  'edge',
  'chromium',
  'brave',
  'opera',
  'vivaldi',
  'yandex',
  'chromium-based'
])

const FIREFOX_BROWSERS: ReadonlySet<string> = new Set([
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
