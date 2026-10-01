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
