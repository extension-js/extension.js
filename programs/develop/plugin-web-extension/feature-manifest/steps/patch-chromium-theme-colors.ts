// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {isChromiumBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'
import {translateThemeColor} from '../manifest-lib/theme-values'

export interface TranslatedThemeColor {
  key: string
  rgb: number[]
}

// Firefox reads theme.colors as CSS strings, Chromium only as number arrays.
// The colors with one exact array reading are the ones a Chromium build ports.
export function translatedThemeColors(
  manifest: Manifest,
  browser: DevOptions['browser']
): TranslatedThemeColor[] {
  if (!isChromiumBasedBrowser(String(browser))) return []

  const theme = (manifest as Record<string, unknown>).theme as
    | Record<string, unknown>
    | undefined
  const colors = theme?.colors

  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) {
    return []
  }

  const translated: TranslatedThemeColor[] = []

  for (const [key, value] of Object.entries(colors)) {
    const rgb = translateThemeColor(value)
    if (rgb) translated.push({key, rgb})
  }

  return translated
}

export function patchChromiumThemeColors(
  manifest: Manifest,
  browser: DevOptions['browser']
): Manifest {
  const translated = translatedThemeColors(manifest, browser)

  if (translated.length === 0) return manifest

  const theme = (manifest as Record<string, unknown>).theme as Record<
    string,
    unknown
  >
  const colors = {...(theme.colors as Record<string, unknown>)}

  for (const {key, rgb} of translated) colors[key] = rgb

  return {...manifest, theme: {...theme, colors}} as Manifest
}
