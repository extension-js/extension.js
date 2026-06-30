// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Manifest, DevOptions} from '../types'
import {isChromiumBasedBrowser, isGeckoBasedBrowser} from './constants'

// Canonical browser-key resolver. Single source of truth: the manifest-emission
// path (feature-manifest/manifest-lib/manifest.ts) and feature-scripts/
// feature-html all re-export this. Prefixed keys win deterministically over a
// plain key (applied last), independent of source order.
export function filterKeysForThisBrowser(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  // Safari Web Extensions are MV3 and are produced by converting a Chrome-shaped
  // extension (safari-web-extension-converter consumes the chromium build
  // output). Safari/webkit are intentionally NOT chromium-based for launch
  // classification — they run through Xcode, not a Chromium binary — but for
  // MANIFEST key resolution they must inherit the chromium family, or their
  // chromium:/firefox: prefixed keys (including manifest_version) resolve to
  // nothing and the emitted manifest is invalid.
  const isChromiumTarget =
    isChromiumBasedBrowser(String(browser)) ||
    browser === 'safari' ||
    browser === 'webkit-based' ||
    String(browser).includes('webkit')
  const isGeckoTarget = isGeckoBasedBrowser(String(browser))

  const chromiumPrefixes = new Set(['chromium', 'chrome', 'edge'])
  const geckoPrefixes = new Set(['gecko', 'firefox'])

  const prefixMatchesTarget = (prefix: string): boolean =>
    // exact browser match (e.g., 'firefox')
    prefix === browser ||
    // chromium family (Safari/webkit resolve chromium keys; see note above)
    (isChromiumTarget && chromiumPrefixes.has(prefix)) ||
    // gecko/firefox family
    (isGeckoTarget && geckoPrefixes.has(prefix))

  const resolve = (node: any): any => {
    if (Array.isArray(node)) {
      return node.map((item) => resolve(item))
    }

    if (node && typeof node === 'object') {
      const result: Record<string, any> = {}
      const prefixedMatches: Record<string, any> = {}

      for (const [key, value] of Object.entries(node)) {
        const indexOfColon = key.indexOf(':')

        // Retain plain keys.
        if (indexOfColon === -1) {
          result[key] = resolve(value)
          continue
        }

        // Apply matching browser:key overrides last; drop non-matching ones.
        const prefix = key.substring(0, indexOfColon)
        if (prefixMatchesTarget(prefix)) {
          prefixedMatches[key.substring(indexOfColon + 1)] = resolve(value)
        }
      }

      for (const [strippedKey, value] of Object.entries(prefixedMatches)) {
        result[strippedKey] = value
      }

      return result
    }

    return node
  }

  return resolve(manifest)
}
