//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {isGeckoBasedBrowser, isWebkitBasedBrowser} from '../../lib/constants'
import {DEFAULT_SWC_TARGETS, resolveSwcTargets} from '../../lib/swc-targets'
import type {DevOptions, Manifest} from '../../types'

// The stable Firefox and Safari on the day Chrome 100 shipped, so a build
// with no declared floor reaches browsers of the same age on every engine.
export const GECKO_DEFAULT_SWC_TARGETS = ['firefox >= 98']
export const WEBKIT_DEFAULT_SWC_TARGETS = ['safari >= 15.4']

function isChromiumDefault(targets: string[]): boolean {
  return targets.join('\n') === DEFAULT_SWC_TARGETS.join('\n')
}

// A floor the manifest declares for the engine being built wins. With none, a
// Firefox or Safari build compiles for its own engine, not for Chrome.
export function resolveEngineSwcTargets(
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
