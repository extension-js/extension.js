// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../types'

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

// Chrome's theme_handler.cc: colors are [R, G, B] or [R, G, B, A] with integer
// channels and a numeric alpha, anything else refuses the whole extension.
function colorValueDetail(value: unknown): string | undefined {
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
