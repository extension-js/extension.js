// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  isChromiumBasedBrowser,
  isGeckoBasedBrowser,
  isWebkitBasedBrowser
} from '../../../lib/constants'
import {humanLine} from '../../../lib/messaging'
import type {DevOptions, Manifest} from '../../../types'
import * as messages from '../messages'

export type IconVariantsReader = 'gecko' | 'chromium' | 'webkit'
export type IconVariantsOutcome = 'kept' | 'added' | 'missing'

export interface IconVariantsVerdict {
  // The manifest key the browser shows instead of the variants.
  key: string
  outcome: IconVariantsOutcome
}

// Gecko has no schema for the key, Chromium gates it, and Apple's converter
// reads icons only. A target leaves this list when its release reads the key.
export function ignoresIconVariants(
  browser: DevOptions['browser']
): IconVariantsReader | undefined {
  const name = String(browser)

  if (isGeckoBasedBrowser(name)) return 'gecko'
  if (isChromiumBasedBrowser(name)) return 'chromium'
  if (isWebkitBasedBrowser(name)) return 'webkit'

  return undefined
}

interface Group {
  schemes?: string[]
  sized: Record<string, string>
  any?: string
}

function readGroups(variants: unknown, allowSvg: boolean): Group[] {
  if (!Array.isArray(variants)) return []

  const groups: Group[] = []

  for (const raw of variants) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue

    const group = raw as Record<string, unknown>
    const sized: Record<string, string> = {}

    for (const [key, value] of Object.entries(group)) {
      if (!/^\d+$/.test(key) || typeof value !== 'string' || !value) continue
      // Chromium takes no SVG under icons, so a vector cannot stand in there.
      if (!allowSvg && /\.svg$/i.test(value)) continue

      sized[key] = value
    }

    groups.push({
      schemes: Array.isArray(group.color_schemes)
        ? group.color_schemes.map(String)
        : undefined,
      sized,
      any: typeof group.any === 'string' && group.any ? group.any : undefined
    })
  }

  return groups
}

// A group for every scheme first, then the light one, then whatever is left:
// a browser without the key draws one icon and light is its default look.
export function iconsFromVariants(
  variants: unknown,
  reader: IconVariantsReader
): Record<string, string> | undefined {
  // Apple's converter draws the app icon from an SVG too, but PNG sizes are
  // what every Safari is known to take, so they win when both exist.
  if (reader === 'webkit') {
    return pickIcons(variants, false) ?? pickIcons(variants, true)
  }

  return pickIcons(variants, reader === 'gecko')
}

function pickIcons(
  variants: unknown,
  allowSvg: boolean
): Record<string, string> | undefined {
  const groups = readGroups(variants, allowSvg)
  const ordered = [
    ...groups.filter((group) => !group.schemes),
    ...groups.filter((group) => group.schemes?.includes('light')),
    ...groups
  ]

  const sized = ordered.find((group) => Object.keys(group.sized).length > 0)
  if (sized) return sized.sized

  // Firefox and Apple's converter scale one SVG to every size they ask for.
  const vector = allowSvg ? ordered.find((group) => group.any) : undefined
  if (vector?.any) return {48: vector.any, 96: vector.any}

  return undefined
}

function hasIcons(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0

  return Boolean(
    value && typeof value === 'object' && Object.keys(value).length > 0
  )
}

export function applyIconVariantsFallback(
  manifest: Manifest,
  browser: DevOptions['browser']
): {manifest: Manifest; verdicts: IconVariantsVerdict[]} {
  const reader = ignoresIconVariants(browser)
  const verdicts: IconVariantsVerdict[] = []

  if (!reader || !manifest || typeof manifest !== 'object') {
    return {manifest, verdicts}
  }

  const next = {...manifest} as Record<string, unknown>

  if (Array.isArray(next.icon_variants)) {
    if (hasIcons(next.icons)) {
      verdicts.push({key: 'icons', outcome: 'kept'})
    } else {
      const icons = iconsFromVariants(next.icon_variants, reader)

      if (icons) next.icons = icons

      verdicts.push({key: 'icons', outcome: icons ? 'added' : 'missing'})
    }
  }

  for (const surfaceKey of ['action', 'browser_action'] as const) {
    const surface = next[surfaceKey] as Record<string, unknown> | undefined

    if (!surface || !Array.isArray(surface.icon_variants)) continue

    const key = `${surfaceKey}.default_icon`

    if (hasIcons(surface.default_icon)) {
      verdicts.push({key, outcome: 'kept'})
      continue
    }

    const icons = iconsFromVariants(surface.icon_variants, reader)

    if (icons) next[surfaceKey] = {...surface, default_icon: icons}

    verdicts.push({key, outcome: icons ? 'added' : 'missing'})
  }

  return {manifest: next as Manifest, verdicts}
}

// Dev rebuilds the manifest on every save, so each line prints once a process.
const reported = new Set<string>()

export function reportIconVariantsFallback(
  verdicts: IconVariantsVerdict[],
  browser: DevOptions['browser']
): void {
  const reader = ignoresIconVariants(browser)

  if (!reader || verdicts.length === 0) return

  const line = messages.iconVariantsFallback(reader, verdicts)

  if (reported.has(line)) return

  reported.add(line)
  humanLine(line)
}

// Tests drive the reporter repeatedly, so they need the latch cleared.
export function resetIconVariantsNotice(): void {
  reported.clear()
}
