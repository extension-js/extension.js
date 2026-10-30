// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import type {SpecialFoldersConfig} from '../types'

// The `folders` config of each project, keyed by its root, so the plugins
// that only hold a compiler find the same answer the commands resolved.
const foldersByProjectRoot = new Map<string, SpecialFoldersConfig>()

export function rememberSpecialFoldersConfig(
  projectRoot: string,
  folders: SpecialFoldersConfig | undefined
): void {
  if (!projectRoot) return

  if (folders) foldersByProjectRoot.set(path.resolve(projectRoot), folders)
  else foldersByProjectRoot.delete(path.resolve(projectRoot))
}

export function rememberedFolders(
  projectRoot: string | undefined
): SpecialFoldersConfig {
  if (!projectRoot) return {}

  return foldersByProjectRoot.get(path.resolve(projectRoot)) || {}
}

// The file kinds the scan enrolls from scripts/; the watcher asks the same
// question, so a data file dropped there never restarts a session.
export const SCRIPTS_FOLDER_EXTENSIONS: ReadonlySet<string> = new Set([
  '.js',
  '.mjs',
  '.jsx',
  '.mjsx',
  '.ts',
  '.mts',
  '.tsx',
  '.mtsx'
])

export function isScriptsFolderEntry(filePath: string): boolean {
  return SCRIPTS_FOLDER_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

// `pages/player.dev.html` and `scripts/bench.dev.ts` are development-only
// entries: a development compile serves them, a production one leaves them out.
const DEV_ONLY_ENTRY = /\.dev\.[^.]+$/i

export function isDevOnlyEntry(filePath: string): boolean {
  return DEV_ONLY_ENTRY.test(path.basename(String(filePath)))
}

export function omitDevOnlyEntries<T extends Record<string, unknown>>(
  list: T | undefined,
  dropped?: string[]
): T {
  const next: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(list || {})) {
    const files = Array.isArray(value) ? value : value ? [value] : []
    const kept = files.filter((file) => !isDevOnlyEntry(String(file)))

    for (const file of files) {
      if (!kept.includes(file)) dropped?.push(String(file))
    }

    if (kept.length === 0) continue

    next[key] = Array.isArray(value) ? kept : kept[0]
  }

  return next as T
}

export type SpecialFolderName = 'pages' | 'scripts'
export type SpecialFoldersRoots = Partial<Record<SpecialFolderName, string>>

// The absolute folder each entry kind is read from: the configured one, the
// root default otherwise, and none for `false` or a folder spelled another
// name (the scan reads a relocated folder under its own name only).
export function foldersRoots(projectRoot: string): SpecialFoldersRoots {
  const folders = rememberedFolders(projectRoot)
  const roots: SpecialFoldersRoots = {}

  for (const name of ['pages', 'scripts'] as const) {
    const setting = folders[name]
    if (setting === false) continue

    const root =
      typeof setting === 'string' && setting.trim()
        ? path.resolve(projectRoot, setting)
        : path.join(projectRoot, name)

    if (path.basename(root) !== name) continue

    roots[name] = root
  }

  return roots
}

// The folder whose files are content scripts by location: the moved one,
// the root default, or none once `scripts: false` makes it a plain folder.
export function scriptsFolderRoot(
  projectRoot: string | undefined
): string | undefined {
  return projectRoot ? foldersRoots(projectRoot).scripts : undefined
}

export type PublicFolderSetting =
  | {kind: 'default'}
  | {kind: 'off'}
  | {kind: 'path'; dir: string}

export function publicFolderSetting(
  projectRoot: string | undefined
): PublicFolderSetting {
  const setting = rememberedFolders(projectRoot).public

  if (setting === false) return {kind: 'off'}

  if (typeof setting === 'string' && setting.trim() && projectRoot) {
    return {kind: 'path', dir: path.resolve(projectRoot, setting)}
  }

  return {kind: 'default'}
}
