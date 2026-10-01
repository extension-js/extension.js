// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

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
  // Prefer <projectRoot>/_locales but accept <manifestDir>/_locales so legacy
  // templates keep building; validation.ts warns on the fallback.
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

    walk(localeDir, out)
  }

  return out
}

// Everything under a locale folder ships: a privacy.md or a nested folder a
// project fetches at runtime is as much a locale asset as messages.json.
function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const abs = path.join(dir, entry.name)

    if (entry.isDirectory()) walk(abs, out)
    else out.push(abs)
  }
}

export function getLocales(
  manifestPath: string,
  projectRoot?: string
): string[] | undefined {
  const localesFolder = resolveLocalesFolder(manifestPath, projectRoot)

  if (!localesFolder) return []

  return listLocaleFiles(localesFolder)
}
