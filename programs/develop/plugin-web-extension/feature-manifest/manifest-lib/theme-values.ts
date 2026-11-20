// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../types'
import {NAMED_CSS_COLORS} from './named-css-colors'

export interface ThemeArrayIssue {
  field: string
  value: string
  write: string
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const HEX_WITH_ALPHA = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i
const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i
const RGB_WITH_ALPHA =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d*\.?\d+)\s*\)$/i

const isChannel = (entry: unknown): boolean =>
  typeof entry === 'number' &&
  Number.isInteger(entry) &&
  entry >= 0 &&
  entry <= 255

const isFiniteNumber = (entry: unknown): entry is number =>
  typeof entry === 'number' && Number.isFinite(entry)

const isAlpha = (entry: unknown): boolean =>
  isFiniteNumber(entry) && entry >= 0 && entry <= 1

function hexBytes(hex: string): number[] {
  const pairs =
    hex.length >= 6
      ? (hex.match(/../g) as string[])
      : hex.split('').map((digit) => digit + digit)

  return pairs.map((pair) => parseInt(pair, 16))
}

function channels(match: RegExpExecArray): number[] | undefined {
  const rgb = match.slice(1, 4).map(Number)

  return rgb.every(isChannel) ? rgb : undefined
}

// Only the forms with one exact [R, G, B] reading translate for Chromium.
// A color name has one reading too. An alpha, a percentage or hsl() does not.
export function translateThemeColor(value: unknown): number[] | undefined {
  if (typeof value !== 'string') return undefined

  const text = value.trim()
  const hex = HEX.exec(text)
  if (hex) return hexBytes(hex[1])

  const rgb = RGB.exec(text)
  if (rgb) return channels(rgb)

  const name = text.toLowerCase()

  return Object.prototype.hasOwnProperty.call(NAMED_CSS_COLORS, name)
    ? [...NAMED_CSS_COLORS[name]]
    : undefined
}

export function formatThemeArray(entries: number[]): string {
  return `[${entries.join(', ')}]`
}

// The array the author can write in place of a value the build refuses,
// worked out when the value names one, the bare shape otherwise.
function colorToWrite(value: unknown): string {
  if (Array.isArray(value) && value.length === 4) return '[R, G, B, A]'
  if (typeof value !== 'string') return '[R, G, B]'

  const text = value.trim().toLowerCase()
  const hex = HEX_WITH_ALPHA.exec(text)

  if (hex) {
    const bytes = hexBytes(hex[1])
    const alpha = Math.round((bytes[3] / 255) * 100) / 100

    return formatThemeArray([...bytes.slice(0, 3), alpha])
  }

  const rgba = RGB_WITH_ALPHA.exec(text)
  const rgb = rgba && channels(rgba)

  if (rgb && isAlpha(Number(rgba[4]))) {
    return formatThemeArray([...rgb, Number(rgba[4])])
  }

  if (text === 'transparent') return formatThemeArray([0, 0, 0, 0])

  const named = NAMED_CSS_COLORS[text]

  return named ? formatThemeArray(named) : '[R, G, B]'
}

// Chrome's theme handler loads a color as [R, G, B] integers with an optional
// numeric alpha. Channels stay within 0 to 255 and the alpha within 0 to 1.
function isChromiumColor(value: unknown): boolean {
  if (translateThemeColor(value)) return true
  if (!Array.isArray(value)) return false
  if (value.length !== 3 && value.length !== 4) return false
  if (!value.slice(0, 3).every(isChannel)) return false

  return value.length === 3 || isAlpha(value[3])
}

function isChromiumTint(value: unknown): boolean {
  return (
    Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
  )
}

export function collectThemeArrayIssues(
  manifest: Manifest | undefined | null
): ThemeArrayIssue[] {
  const issues: ThemeArrayIssue[] = []
  const theme = (manifest as Record<string, unknown> | undefined | null)?.theme

  if (!theme || typeof theme !== 'object') return issues

  const groups: Array<
    [string, unknown, (value: unknown) => boolean, (value: unknown) => string]
  > = [
    [
      'colors',
      (theme as Record<string, unknown>).colors,
      isChromiumColor,
      colorToWrite
    ],
    [
      'tints',
      (theme as Record<string, unknown>).tints,
      isChromiumTint,
      () => '[H, S, L]'
    ]
  ]

  for (const [group, container, accepts, toWrite] of groups) {
    if (
      !container ||
      typeof container !== 'object' ||
      Array.isArray(container)
    ) {
      continue
    }

    for (const [key, value] of Object.entries(
      container as Record<string, unknown>
    )) {
      if (accepts(value)) continue

      issues.push({
        field: `theme.${group}.${key}`,
        value: JSON.stringify(value),
        write: toWrite(value)
      })
    }
  }

  return issues
}
