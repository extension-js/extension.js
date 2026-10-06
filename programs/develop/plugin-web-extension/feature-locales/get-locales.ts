// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {inspectPublicFolders} from '../../plugin-special-folders/resolve-public-folder'

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

  const fromPublic = publicLocalesFolder(manifestPath, projectRoot)
  if (fromPublic && isUsableDir(fromPublic)) return fromPublic

  return undefined
}

function publicLocalesFolder(
  manifestPath: string,
  projectRoot?: string
): string | undefined {
  const {publicDir} = inspectPublicFolders(manifestPath, projectRoot)

  return publicDir ? path.join(publicDir, '_locales') : undefined
}

// The public copier ships its whole tree to the output root, so a _locales
// there already lands at the path the browser reads: emitting it again would
// write the same asset twice.
export function localesFolderIsCopiedByPublic(
  manifestPath: string,
  projectRoot?: string
): boolean {
  const localesFolder = resolveLocalesFolder(manifestPath, projectRoot)
  const fromPublic = publicLocalesFolder(manifestPath, projectRoot)

  if (!localesFolder || !fromPublic) return false

  return path.resolve(localesFolder) === path.resolve(fromPublic)
}

function listLocaleDirs(folder: string): string[] {
  const out: string[] = []

  for (const locale of fs.readdirSync(folder)) {
    const localeDir = path.join(folder, locale)

    try {
      if (fs.statSync(localeDir).isDirectory()) out.push(localeDir)
    } catch {}
  }

  return out
}

function hasMessagesFile(localeDir: string): boolean {
  return fs.existsSync(path.join(localeDir, 'messages.json'))
}

// A locale folder without messages.json is one the stores refuse, so it
// stays out of the output and the emitter warns about it by name.
export function localeDirsWithoutMessages(localesFolder: string): string[] {
  if (!isUsableDir(localesFolder)) return []

  return listLocaleDirs(localesFolder).filter((dir) => !hasMessagesFile(dir))
}

export function localeFoldersWithoutMessages(
  manifestPath: string,
  projectRoot?: string
): string[] {
  const localesFolder = resolveLocalesFolder(manifestPath, projectRoot)

  return localesFolder ? localeDirsWithoutMessages(localesFolder) : []
}

function listLocaleFiles(folder: string): string[] {
  const out: string[] = []

  for (const localeDir of listLocaleDirs(folder)) {
    if (hasMessagesFile(localeDir)) walk(localeDir, out)
  }

  return out
}

// Files the OS file browser drops into any folder it opens, never content
const OS_METADATA_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

// Everything under a locale folder ships: a privacy.md or a nested folder a
// project fetches at runtime is as much a locale asset as messages.json.
function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (OS_METADATA_FILES.has(entry.name.toLowerCase())) continue

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
