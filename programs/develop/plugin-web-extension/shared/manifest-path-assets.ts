// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripBom} from '../../lib/parse-json-safe'
import type {FilepathList} from '../../types'
import {isManifestAddress} from './paths'

// The manifest-fields package does not extract theme_experiment.stylesheet,
// search_provider.favicon_url or startup_pages, so the overrides promised
// output paths nothing produced. These feed the css, icons and html
// emitters so every promise is kept.

type SettingsManifest = {
  theme_experiment?: {stylesheet?: unknown}
  chrome_settings_overrides?: {
    startup_pages?: unknown
    search_provider?: {favicon_url?: unknown}
  }
}

function readManifest(manifestPath: string): SettingsManifest {
  try {
    return JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8')))
  } catch {
    return {}
  }
}

function isPublicSpelling(value: string): boolean {
  return /^(?:\/public\/|(?:\.\/)?public\/)/i.test(value)
}

// Public-hosted files ship through the copier; root-absolute spellings stay
// raw for the emitters; everything else resolves from the manifest folder.
function resolveAsset(manifestDir: string, value: string): string {
  if (isPublicSpelling(value) || value.startsWith('/')) return value
  return path.isAbsolute(value) ? value : path.join(manifestDir, value)
}

function localFile(manifestDir: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (isManifestAddress(value) || isPublicSpelling(value)) return undefined
  const resolved = resolveAsset(manifestDir, value)
  // A root-absolute ref that only public/ owns is served from there as-is.
  if (resolved.startsWith('/') && !path.isAbsolute(resolved)) return undefined
  if (
    resolved.startsWith('/') &&
    !fs.existsSync(resolved) &&
    fs.existsSync(path.join(manifestDir, 'public', resolved.slice(1)))
  ) {
    return undefined
  }
  return resolved.startsWith('/') && !fs.existsSync(resolved)
    ? path.join(manifestDir, resolved.slice(1))
    : resolved
}

// theme_experiment.stylesheet compiles through the css pipeline as its own
// entry, so a scss/less source still lands under its advertised .css name.
export function themeExperimentStylesheetEntries(
  manifestPath: string
): FilepathList {
  const manifest = readManifest(manifestPath)
  const manifestDir = path.dirname(manifestPath)
  const file = localFile(manifestDir, manifest.theme_experiment?.stylesheet)
  if (!file) return {}
  const name = path.basename(file).replace(/\.[^.]+$/, '')
  return {[`theme_experiment/${name}`]: [file]}
}

export function settingsOverridesIconFields(
  manifestPath: string
): FilepathList {
  const manifest = readManifest(manifestPath)
  const manifestDir = path.dirname(manifestPath)
  const fav = manifest.chrome_settings_overrides?.search_provider?.favicon_url
  if (typeof fav !== 'string' || !fav.trim() || isManifestAddress(fav)) {
    return {}
  }
  return {
    'chrome_settings_overrides/favicon_url': resolveAsset(manifestDir, fav)
  }
}

export function settingsOverridesStartupPages(
  manifestPath: string
): FilepathList {
  const manifest = readManifest(manifestPath)
  const manifestDir = path.dirname(manifestPath)
  const pages = manifest.chrome_settings_overrides?.startup_pages
  if (!Array.isArray(pages)) return {}
  const out: Record<string, string> = {}
  pages.forEach((page, index) => {
    const file = localFile(manifestDir, page)
    if (file) out[`chrome_settings_overrides/startup-${index}`] = file
  })
  return out as FilepathList
}
