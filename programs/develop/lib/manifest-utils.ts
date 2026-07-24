// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import type {DevOptions, Manifest} from '../types'
import {isChromiumBasedBrowser, isGeckoBasedBrowser} from './constants'
import {parseJsonSafe} from './parse-json-safe'

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

// Every key a static theme may not carry: a theme is validated against the
// theme schema, which forbids extra top-level keys (AMO hard-errors on each).
const THEME_DISQUALIFYING_KEYS = [
  'background',
  'content_scripts',
  'action',
  'browser_action',
  'page_action',
  'sidebar_action',
  'side_panel',
  'options_page',
  'options_ui',
  'devtools_page',
  'chrome_url_overrides',
  'sandbox',
  'user_scripts',
  'declarative_net_request',
  'web_accessible_resources'
] as const

// A static theme has no runtime to instrument: no background, no pages, no
// content scripts. Dev must leave it alone or the artifact stops being a theme.
export function isStaticTheme(manifest: Manifest | undefined | null): boolean {
  if (!manifest || typeof manifest !== 'object') return false
  const theme = (manifest as Record<string, unknown>).theme
  if (!theme || typeof theme !== 'object') return false

  return !THEME_DISQUALIFYING_KEYS.some((key) => {
    const value = (manifest as Record<string, unknown>)[key]
    return value !== undefined && value !== null
  })
}

// Decided from the manifest on disk: by the time dev patches land, the
// in-flight manifest already carries injected keys and no longer looks a theme.
export function isStaticThemeSource(
  manifestPath: string | undefined,
  browser: DevOptions['browser'] | string | undefined
): boolean {
  if (!manifestPath) return false

  try {
    const parsed = parseJsonSafe(fs.readFileSync(manifestPath, 'utf-8'))
    return isStaticTheme(
      filterKeysForThisBrowser(parsed, browser as DevOptions['browser'])
    )
  } catch {
    return false
  }
}
