// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isChromiumBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'
import {parseHexThemeColor} from '../manifest-lib/theme-values'

// Firefox parses theme.colors as CSS strings, Chrome only as integer arrays.
// Convert hex strings for chromium targets so one manifest serves both;
// gecko keeps the string form and non-hex values pass through untouched.
export function patchChromiumThemeColors(
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  if (!isChromiumBasedBrowser(String(browser))) return manifest

  const theme = (manifest as Record<string, unknown>).theme as
    | Record<string, unknown>
    | undefined

  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    return manifest
  }

  const colors = theme.colors as Record<string, unknown> | undefined

  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) {
    return manifest
  }

  let converted = false
  const patchedColors: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(colors)) {
    const rgb = parseHexThemeColor(value)
    patchedColors[key] = rgb ?? value
    if (rgb) converted = true
  }

  if (!converted) return manifest

  return {
    ...manifest,
    theme: {...theme, colors: patchedColors}
  } as Manifest
}
