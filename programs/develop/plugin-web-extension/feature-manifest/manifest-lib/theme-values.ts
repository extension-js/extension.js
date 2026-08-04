// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../types'
import {NAMED_CSS_COLORS} from './named-css-colors'

export interface ThemeValueIssue {
  field: string
  detail: string
  value: string
}

const isChannel = (entry: unknown): boolean =>
  typeof entry === 'number' &&
  Number.isInteger(entry) &&
  entry >= 0 &&
  entry <= 255

const isFiniteNumber = (entry: unknown): boolean =>
  typeof entry === 'number' && Number.isFinite(entry)

// Firefox accepts CSS hex strings in theme.colors while Chrome wants integer
// arrays; hex is unambiguous, so the chromium build converts it instead of
// refusing. Returns [R, G, B] or [R, G, B, A] with a 0-1 alpha, or undefined.
export function parseHexThemeColor(value: unknown): number[] | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())
  if (!match) return undefined

  const hex = match[1]
  const digits =
    hex.length >= 6
      ? (hex.match(/../g) as string[])
      : hex.split('').map((digit) => digit + digit)
  const bytes = digits.map((pair) => parseInt(pair, 16))

  if (bytes.length === 3) return bytes
  return [...bytes.slice(0, 3), Math.round((bytes[3] / 255) * 1000) / 1000]
}

// Firefox accepts the whole CSS <color> grammar in theme.colors. Everything
// unambiguous converts for chromium the same way hex does: named keywords,
// transparent, and numeric rgb()/rgba(). Values outside that grammar keep
// refusing, so the guard on what Chrome genuinely rejects stays intact.
export function parseCssThemeColor(value: unknown): number[] | undefined {
  const hex = parseHexThemeColor(value)
  if (hex) return hex
  if (typeof value !== 'string') return undefined

  const keyword = value.trim().toLowerCase()
  if (keyword === 'transparent') return [0, 0, 0, 0]

  const named = NAMED_CSS_COLORS[keyword]
  if (named) return [...named]

  const match =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+|1\.0+)\s*)?\)$/.exec(
      keyword
    )
  if (!match) return undefined

  const channels = match.slice(1, 4).map(Number)
  if (channels.some((channel) => channel > 255)) return undefined
  if (match[4] === undefined) return channels
  return [...channels, Number(match[4])]
}

// Chrome's theme_handler.cc: colors are [R, G, B] or [R, G, B, A] with integer
// channels and a numeric alpha, anything else refuses the whole extension.
// CSS color strings pass because the chromium manifest writer converts them.
function colorValueDetail(value: unknown): string | undefined {
  if (parseCssThemeColor(value)) return undefined

  if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4)) {
    return 'Chrome only accepts an [R, G, B] or [R, G, B, A] array here.'
  }

  for (const entry of value.slice(0, 3)) {
    if (!isChannel(entry)) {
      return 'Chrome only accepts integer color channels from 0 to 255 here.'
    }
  }

  if (value.length === 4 && !isFiniteNumber(value[3])) {
    return 'Chrome only accepts a numeric alpha channel here.'
  }

  return undefined
}

function tintValueDetail(value: unknown): string | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(isFiniteNumber)
  ) {
    return 'Chrome only accepts a [hue, saturation, lightness] array of 3 numbers here.'
  }

  return undefined
}

export function collectThemeValueIssues(
  manifest: Manifest | undefined | null
): ThemeValueIssue[] {
  const issues: ThemeValueIssue[] = []
  const theme = (manifest as Record<string, unknown> | undefined | null)?.theme

  if (!theme || typeof theme !== 'object') return issues

  const groups: Array<
    [string, unknown, (value: unknown) => string | undefined]
  > = [
    ['colors', (theme as Record<string, unknown>).colors, colorValueDetail],
    ['tints', (theme as Record<string, unknown>).tints, tintValueDetail]
  ]

  for (const [group, container, detailFor] of groups) {
    if (!container || typeof container !== 'object' || Array.isArray(container))
      continue

    for (const [key, value] of Object.entries(
      container as Record<string, unknown>
    )) {
      const detail = detailFor(value)

      if (detail) {
        issues.push({
          field: `theme.${group}.${key}`,
          detail,
          value: JSON.stringify(value)
        })
      }
    }
  }

  return issues
}
