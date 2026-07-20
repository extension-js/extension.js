// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {DevOptions, Manifest} from '../types'
import {isChromiumBasedBrowser, isGeckoBasedBrowser} from './constants'

// Canonical browser-key resolver. Single source of truth: the manifest-emission
// path (feature-manifest/manifest-lib/manifest.ts) and feature-scripts/
// feature-html all re-export this. Prefixed keys win deterministically over a
// plain key (applied last), independent of source order.
export function filterKeysForThisBrowser(
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  // Safari Web Extensions are MV3 and are produced by converting a Chrome-shaped
  // extension (safari-web-extension-converter consumes the chromium build
  // output). Safari/webkit are intentionally NOT chromium-based for launch
  // classification (they run through Xcode, not a Chromium binary) but for
  // MANIFEST key resolution they must inherit the chromium family, or their
  // chromium:/firefox: prefixed keys (including manifest_version) resolve to
  // nothing and the emitted manifest is invalid.
  const isSafariTarget =
    browser === 'safari' ||
    browser === 'webkit-based' ||
    String(browser).includes('webkit')
  const isChromiumTarget =
    isChromiumBasedBrowser(String(browser)) || isSafariTarget
  const isGeckoTarget = isGeckoBasedBrowser(String(browser))

  const chromiumPrefixes = new Set(['chromium', 'chrome', 'edge'])
  const geckoPrefixes = new Set(['gecko', 'firefox'])
  // Safari's own prefixes. Safari inherits the chromium family (see note
  // above), but `safari:`/`webkit:` keys are more specific and must win over
  // chromium-family keys, for BOTH `safari` and `webkit-based` targets.
  const webkitPrefixes = new Set(['safari', 'webkit'])

  const isFamilyPrefix = (prefix: string): boolean =>
    (isChromiumTarget && chromiumPrefixes.has(prefix)) ||
    (isGeckoTarget && geckoPrefixes.has(prefix))

  const isSpecificPrefix = (prefix: string): boolean =>
    // exact browser match (e.g., 'firefox', 'edge')
    prefix === browser ||
    // safari/webkit prefixes on safari-family targets
    (isSafariTarget && webkitPrefixes.has(prefix))

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

        // Retain plain keys.
        if (indexOfColon === -1) {
          result[key] = resolve(value)
          continue
        }

        // Bucket matching browser:key overrides; drop non-matching ones.
        const prefix = key.substring(0, indexOfColon)
        const strippedKey = key.substring(indexOfColon + 1)
        if (isSpecificPrefix(prefix)) {
          specificMatches[strippedKey] = resolve(value)
        } else if (isFamilyPrefix(prefix)) {
          familyMatches[strippedKey] = resolve(value)
        }
      }

      // Precedence (deterministic, independent of source order):
      // plain < family prefix (chromium:/gecko:/…) < specific prefix
      // (exact browser, or safari:/webkit: on safari-family targets).
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
