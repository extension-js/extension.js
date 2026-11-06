// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import type {ExcludeFilesConfig, SpecialFoldersConfig} from '../types'

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

function omitEntries<T extends Record<string, unknown>>(
  list: T | undefined,
  leftOut: (file: string) => boolean,
  dropped?: string[]
): T {
  const next: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(list || {})) {
    const files = Array.isArray(value) ? value : value ? [value] : []
    const kept = files.filter((file) => !leftOut(String(file)))

    for (const file of files) {
      if (!kept.includes(file)) dropped?.push(String(file))
    }

    if (kept.length === 0) continue

    next[key] = Array.isArray(value) ? kept : kept[0]
  }

  return next as T
}

export function omitDevOnlyEntries<T extends Record<string, unknown>>(
  list: T | undefined,
  dropped?: string[]
): T {
  return omitEntries(list, isDevOnlyEntry, dropped)
}

// The `exclude` config of each project, resolved to absolute paths and keyed
// by the project root for the same reason the folders config is: the plugins
// that only hold a compiler must drop the same files the commands resolved.
const excludedFilesByProjectRoot = new Map<string, ReadonlySet<string>>()
const NO_EXCLUDED_FILES: ReadonlySet<string> = new Set()

export function resolveExcludedFiles(
  projectRoot: string,
  exclude: ExcludeFilesConfig | undefined
): ReadonlySet<string> {
  const files = new Set<string>()

  for (const entry of Array.isArray(exclude) ? exclude : []) {
    if (typeof entry !== 'string' || entry.trim() === '') continue

    files.add(path.resolve(projectRoot, entry.trim()))
  }

  return files
}

export function rememberExcludedFiles(
  projectRoot: string,
  exclude: ExcludeFilesConfig | undefined
): void {
  if (!projectRoot) return

  const root = path.resolve(projectRoot)
  const files = resolveExcludedFiles(root, exclude)

  if (files.size > 0) excludedFilesByProjectRoot.set(root, files)
  else excludedFilesByProjectRoot.delete(root)
}

export function excludedFiles(
  projectRoot: string | undefined
): ReadonlySet<string> {
  if (!projectRoot) return NO_EXCLUDED_FILES

  return (
    excludedFilesByProjectRoot.get(path.resolve(projectRoot)) ||
    NO_EXCLUDED_FILES
  )
}

export function isExcludedEntry(
  filePath: string,
  excluded: ReadonlySet<string>
): boolean {
  if (excluded.size === 0) return false

  return excluded.has(path.resolve(String(filePath)))
}

export function omitExcludedEntries<T extends Record<string, unknown>>(
  list: T | undefined,
  excluded: ReadonlySet<string>,
  dropped?: string[]
): T {
  if (excluded.size === 0) return (list || {}) as T

  return omitEntries(list, (file) => isExcludedEntry(file, excluded), dropped)
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
