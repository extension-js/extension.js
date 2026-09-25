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

// Chromium forks the launcher finds on the user's machine through a dedicated
// *-location resolver. Nothing downloads these, so the managed browser cache,
// which holds chrome, chromium and edge only, must never answer for one.
export const SYSTEM_LOCATED_CHROMIUM_FORKS: ReadonlySet<string> = new Set([
  'brave',
  'opera',
  'vivaldi',
  'yandex'
])

export const FIREFOX_BROWSERS: ReadonlySet<string> = new Set([
  'firefox',
  'waterfox',
  'librewolf',
  'zen',
  'floorp',
  'gecko-based',
  'firefox-based'
])

export function isChromiumBrowser(browser: BrowserType | string): boolean {
  return CHROMIUM_BROWSERS.has(String(browser))
}

export function isSystemLocatedChromiumFork(
  browser: BrowserType | string
): boolean {
  return SYSTEM_LOCATED_CHROMIUM_FORKS.has(String(browser))
}

export function isFirefoxBrowser(browser: BrowserType | string): boolean {
  return FIREFOX_BROWSERS.has(String(browser))
}

export const EMULATOR_BROWSERS: ReadonlySet<string> = new Set([
  'chromium-emulator'
])

export function isEmulatorBrowser(browser: BrowserType | string): boolean {
  return EMULATOR_BROWSERS.has(String(browser))
}
