// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'

function isUsableDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function resolveLocalesFolder(
  manifestPath: string,
  projectRoot?: string
): string | undefined {
  // Prefer `<projectRoot>/_locales` (platform-aligned layout — sibling of
  // package.json, public/, dist/), but accept `<manifestDir>/_locales` as
  // a fallback so existing templates with `src/_locales/` next to a
  // src/manifest.json continue to build. validation.ts surfaces a build
  // warning when the fallback path is used so authors are nudged toward
  // the canonical layout without breaking the build.
  if (projectRoot) {
    const fromRoot = path.join(projectRoot, '_locales')
    if (isUsableDir(fromRoot)) return fromRoot
  }
  const fromManifest = path.join(path.dirname(manifestPath), '_locales')
  if (isUsableDir(fromManifest)) return fromManifest
  return undefined
}

function listLocaleFiles(folder: string): string[] {
  const out: string[] = []

  for (const locale of fs.readdirSync(folder)) {
    const localeDir = path.join(folder, locale)

    try {
      if (!fs.statSync(localeDir).isDirectory()) continue
    } catch {
      continue
    }

    for (const entry of fs.readdirSync(localeDir)) {
      out.push(path.join(localeDir, entry))
    }
  }
  return out
}

export function getLocales(
  manifestPath: string,
  projectRoot?: string
): string[] | undefined {
  const localesFolder = resolveLocalesFolder(manifestPath, projectRoot)

  if (!localesFolder) return []

  return listLocaleFiles(localesFolder)
}
