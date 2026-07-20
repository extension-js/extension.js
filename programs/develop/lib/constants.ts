// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'

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

// Family alias names accepted anywhere a browser NAME selects an engine family;
// kept beside the fork lists so alignment specs derive both from one place.
export const CHROMIUM_FAMILY_ALIASES = [
  'chromium',
  'chrome',
  'edge',
  'chromium-based'
]
export const GECKO_FAMILY_ALIASES = ['firefox', 'gecko-based']

export const SUPPORTED_BROWSERS = [
  ...CHROMIUM_BASED_BROWSERS,
  ...GECKO_BASED_BROWSERS
]

// Canonical "supported X" lists; docs enumerations are asserted against these
// in the supported-surface drift guard. Extend the list first.
export const SUPPORTED_PACKAGE_MANAGERS = [
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'deno'
] as const

export const SUPPORTED_UI_FRAMEWORKS = [
  'react',
  'preact',
  'vue',
  'svelte'
] as const

export const SUPPORTED_CSS_TECH = [
  'css',
  'css-modules',
  'sass',
  'less',
  'postcss',
  'tailwind'
] as const

// Single source of truth for engine-family classification; forks inherit their
// family's scoped manifest keys, '*-based' aliases match by substring.
export function isChromiumBasedBrowser(browser: string): boolean {
  return (
    CHROMIUM_BASED_BROWSERS.includes(browser) ||
    String(browser).includes('chromium')
  )
}

export function isGeckoBasedBrowser(browser: string): boolean {
  return (
    GECKO_BASED_BROWSERS.includes(browser) ||
    String(browser).includes('gecko') ||
    // 'firefox-based' has no 'gecko' substring but is still a gecko target.
    String(browser).includes('firefox')
  )
}
