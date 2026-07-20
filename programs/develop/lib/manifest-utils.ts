// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {DevOptions, Manifest} from '../types'
import {isChromiumBasedBrowser, isGeckoBasedBrowser} from './constants'

// Canonical browser-key resolver, re-exported by manifest/scripts/html paths.
// Prefixed keys win deterministically over a plain key, independent of source order.
export function filterKeysForThisBrowser(
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  // Safari/webkit are not chromium-based for launch classification, but for
  // MANIFEST keys they must inherit the chromium family or prefixed keys resolve to nothing.
  const isSafariTarget =
    browser === 'safari' ||
    browser === 'webkit-based' ||
    String(browser).includes('webkit')
  const isChromiumTarget =
    isChromiumBasedBrowser(String(browser)) || isSafariTarget
  const isGeckoTarget = isGeckoBasedBrowser(String(browser))

  const chromiumPrefixes = new Set(['chromium', 'chrome', 'edge'])
  const geckoPrefixes = new Set(['gecko', 'firefox'])
  // safari:/webkit: keys are more specific and must win over chromium-family
  // keys, for BOTH safari and webkit-based targets.
  const webkitPrefixes = new Set(['safari', 'webkit'])

  const isFamilyPrefix = (prefix: string): boolean =>
    (isChromiumTarget && chromiumPrefixes.has(prefix)) ||
    (isGeckoTarget && geckoPrefixes.has(prefix))

  const isSpecificPrefix = (prefix: string): boolean =>
    prefix === browser || (isSafariTarget && webkitPrefixes.has(prefix))

  const resolve = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map((item) => resolve(item))
    }

    if (node && typeof node === 'object') {
      const result: Record<string, unknown> = {}
      const familyMatches: Record<string, unknown> = {}
      const specificMatches: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(node)) {
        const indexOfColon = key.indexOf(':')

        if (indexOfColon === -1) {
          result[key] = resolve(value)
          continue
        }

        const prefix = key.substring(0, indexOfColon)
        const strippedKey = key.substring(indexOfColon + 1)
        if (isSpecificPrefix(prefix)) {
          specificMatches[strippedKey] = resolve(value)
        } else if (isFamilyPrefix(prefix)) {
          familyMatches[strippedKey] = resolve(value)
        }
      }

      // Precedence (deterministic): plain < family prefix < specific prefix.
      for (const [strippedKey, value] of Object.entries(familyMatches)) {
        result[strippedKey] = value
      }
      for (const [strippedKey, value] of Object.entries(specificMatches)) {
        result[strippedKey] = value
      }

      return result
    }

    return node
  }

  return resolve(manifest) as Manifest
}
