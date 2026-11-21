//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {DevOptions, Manifest} from '../types'
import {
  isChromiumBasedBrowser,
  isGeckoBasedBrowser,
  isWebkitBasedBrowser
} from './constants'
import {filterKeysForThisBrowser} from './manifest-utils'

export const DEFAULT_SWC_TARGETS = ['chrome >= 100']

// The stable Firefox and Safari on the day Chrome 100 shipped, so a build
// with no declared floor reaches browsers of the same age on every engine.
const GECKO_DEFAULT_SWC_TARGETS = ['firefox >= 98']
const WEBKIT_DEFAULT_SWC_TARGETS = ['safari >= 15.4']

// A build compiles for one engine, so only that engine's declared floor may
// downlevel it: minimum_chrome_version for the chromium family, the gecko
// strict_min_version (either spelling, prefixed or not) for the gecko family.
// A foreign floor stays in the shipped manifest and out of the compiler.
export function resolveSwcTargets(
  rawManifest: Manifest | undefined,
  browser: DevOptions['browser'] | string | undefined
): string[] {
  if (!rawManifest || typeof rawManifest !== 'object') {
    return [...DEFAULT_SWC_TARGETS]
  }

  const name = String(browser || 'chrome')
  const manifest = filterKeysForThisBrowser(
    rawManifest,
    name as DevOptions['browser']
  ) as Manifest & {
    minimum_chrome_version?: unknown
    browser_specific_settings?: {gecko?: {strict_min_version?: unknown}}
    applications?: {gecko?: {strict_min_version?: unknown}}
  }

  if (isGeckoBasedBrowser(name)) {
    const geckoMin =
      manifest.browser_specific_settings?.gecko?.strict_min_version ||
      manifest.applications?.gecko?.strict_min_version
    const major = parseInt(String(geckoMin ?? '').split('.')[0], 10)

    return Number.isNaN(major)
      ? [...DEFAULT_SWC_TARGETS]
      : [`firefox >= ${major}`]
  }

  if (isChromiumBasedBrowser(name) && manifest.minimum_chrome_version) {
    return [`chrome >= ${manifest.minimum_chrome_version}`]
  }

  return [...DEFAULT_SWC_TARGETS]
}

function isChromiumDefault(targets: string[]): boolean {
  return targets.join('\n') === DEFAULT_SWC_TARGETS.join('\n')
}

// The one answer scripts and stylesheets both compile for. A floor the
// manifest declares for the engine being built wins over that engine's own.
export function resolveEngineTargets(
  rawManifest: Manifest | undefined,
  browser: DevOptions['browser'] | string | undefined
): string[] {
  const name = String(browser || 'chrome')
  const declared = resolveSwcTargets(rawManifest, browser)

  // Safari reads no floor from the manifest: the Xcode project holds it.
  if (isWebkitBasedBrowser(name)) return [...WEBKIT_DEFAULT_SWC_TARGETS]

  if (isGeckoBasedBrowser(name) && isChromiumDefault(declared)) {
    return [...GECKO_DEFAULT_SWC_TARGETS]
  }

  return declared
}
