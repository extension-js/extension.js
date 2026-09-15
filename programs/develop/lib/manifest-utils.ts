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

// chrome: and edge: name one vendor. Up to 4.1.18 they reached every
// Chromium-family target, which is why a drop elsewhere gets a warning.
export const CHROMIUM_VENDOR_PREFIXES = ['chrome', 'edge'] as const

function classifyPrefixes(browser: DevOptions['browser']) {
  // Safari/webkit are not chromium-based for launch classification, but for
  // MANIFEST keys they must inherit the chromium family or prefixed keys resolve to nothing.
  const isSafariTarget =
    browser === 'safari' ||
    browser === 'webkit-based' ||
    String(browser).includes('webkit')
  const isChromiumTarget =
    isChromiumBasedBrowser(String(browser)) || isSafariTarget
  const isGeckoTarget = isGeckoBasedBrowser(String(browser))

  // chromium: is the only Chromium family prefix. chrome: and edge: match
  // by name alone, the requested target, never the launch binary.
  const chromiumPrefixes = new Set(['chromium'])
  const geckoPrefixes = new Set(['gecko', 'firefox'])
  // safari:/webkit: keys are more specific and must win over chromium-family
  // keys, for BOTH safari and webkit-based targets.
  const webkitPrefixes = new Set(['safari', 'webkit'])

  const isFamilyPrefix = (prefix: string): boolean =>
    (isChromiumTarget && chromiumPrefixes.has(prefix)) ||
    (isGeckoTarget && geckoPrefixes.has(prefix))

  const isSpecificPrefix = (prefix: string): boolean =>
    prefix === browser || (isSafariTarget && webkitPrefixes.has(prefix))

  return {isChromiumTarget, isFamilyPrefix, isSpecificPrefix}
}

// Canonical browser-key resolver, re-exported by manifest/scripts/html paths.
// Prefixed keys win deterministically over a plain key, independent of source order.
export function filterKeysForThisBrowser(
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  const {isFamilyPrefix, isSpecificPrefix} = classifyPrefixes(browser)

  const resolve = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map((item) => resolve(item))
    }

    if (node && typeof node === 'object') {
      // Maps, not plain objects: a manifest key named __proto__ assigned on
      // a plain object sets its prototype instead of a key and vanishes.
      const result = new Map<string, unknown>()
      const familyMatches = new Map<string, unknown>()
      const specificMatches = new Map<string, unknown>()

      for (const [key, value] of Object.entries(node)) {
        const indexOfColon = key.indexOf(':')

        if (indexOfColon === -1) {
          result.set(key, resolve(value))
          continue
        }

        const prefix = key.substring(0, indexOfColon)
        const strippedKey = key.substring(indexOfColon + 1)
        if (isSpecificPrefix(prefix)) {
          specificMatches.set(strippedKey, resolve(value))
        } else if (isFamilyPrefix(prefix)) {
          familyMatches.set(strippedKey, resolve(value))
        }
      }

      // Precedence (deterministic): plain < family prefix < specific prefix.
      // Two sibling family prefixes on one build (gecko: and firefox: on
      // waterfox) keep source order, the later key wins. The manifest-fields
      // package that discovers entries applies the same rule, so a change
      // here must land there too or entries and consumers split.
      for (const [strippedKey, value] of familyMatches) {
        result.set(strippedKey, value)
      }
      for (const [strippedKey, value] of specificMatches) {
        result.set(strippedKey, value)
      }

      // fromEntries creates own data properties, so __proto__ survives as a key.
      return Object.fromEntries(result)
    }

    return node
  }

  return resolve(manifest) as Manifest
}

export interface DroppedVendorKey {
  // Dotted location of the key as written, like background.chrome:service_worker
  path: string
  // The same location under chromium:, the rename that keeps the old reach
  familyPath: string
  vendor: (typeof CHROMIUM_VENDOR_PREFIXES)[number]
  // True when the family-wide rule up to 4.1.18 put this value in the build
  appliedBefore: boolean
}

// Every chrome: or edge: key a Chromium-family target drops because it names
// another vendor. Subtrees the resolver drops are not walked.
export function findDroppedVendorKeys(
  manifest: Manifest,
  browser: DevOptions['browser']
): DroppedVendorKey[] {
  const {isChromiumTarget, isFamilyPrefix, isSpecificPrefix} =
    classifyPrefixes(browser)
  const found: DroppedVendorKey[] = []
  if (!isChromiumTarget) return found

  const vendors = new Set<string>(CHROMIUM_VENDOR_PREFIXES)
  const formerFamily = new Set<string>(['chromium', ...vendors])
  const join = (at: string, key: string) => (at ? `${at}.${key}` : key)

  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        walk(item, join(at, String(index)))
      }
      return
    }
    if (!node || typeof node !== 'object') return

    // Up to 4.1.18 a specific key beat the family, and the last family key
    // in source order won a tie, so only that key's value reached the build.
    const lastFormerFamily = new Map<string, string>()
    const hasSpecific = new Set<string>()
    for (const key of Object.keys(node)) {
      const colon = key.indexOf(':')
      if (colon === -1) continue
      const prefix = key.substring(0, colon)
      const strippedKey = key.substring(colon + 1)
      if (isSpecificPrefix(prefix)) hasSpecific.add(strippedKey)
      else if (formerFamily.has(prefix)) lastFormerFamily.set(strippedKey, key)
    }

    for (const [key, value] of Object.entries(node)) {
      const colon = key.indexOf(':')
      if (colon === -1) {
        walk(value, join(at, key))
        continue
      }

      const prefix = key.substring(0, colon)
      const strippedKey = key.substring(colon + 1)
      if (isSpecificPrefix(prefix) || isFamilyPrefix(prefix)) {
        walk(value, join(at, key))
      } else if (vendors.has(prefix)) {
        found.push({
          path: join(at, key),
          familyPath: join(at, `chromium:${strippedKey}`),
          vendor: prefix as DroppedVendorKey['vendor'],
          appliedBefore:
            !hasSpecific.has(strippedKey) &&
            lastFormerFamily.get(strippedKey) === key
        })
      }
    }
  }

  walk(manifest, '')
  return found
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
