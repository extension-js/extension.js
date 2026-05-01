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
  const root = projectRoot || path.dirname(manifestPath)
  const folder = path.join(root, '_locales')

  return isUsableDir(folder) ? folder : undefined
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
