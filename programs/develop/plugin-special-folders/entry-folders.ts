// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {isScriptsFolderEntry, type SpecialFolderName} from './folders-config'

// Installed packages are never entries, in any spelling of the folder name.
// The scan and the watcher both ask here, so they agree on what a folder holds.
export function isSkippedEntryName(name: string): boolean {
  return name.toLowerCase() === 'node_modules'
}

export function isEntryFolderFile(
  folder: SpecialFolderName,
  filePath: string
): boolean {
  return folder === 'pages'
    ? filePath.endsWith('.html')
    : isScriptsFolderEntry(filePath)
}

export interface EntryFolderWalk {
  // An unreadable folder is thrown, or passed over.
  onUnreadable?: 'throw' | 'skip'
}

const DENIED = new Set(['EACCES', 'EPERM'])

// The plain files of one entry folder, at any depth. A link is left to the
// walked-file guard, which asks where it leads before taking it.
export function walkEntryFolder(
  dir: string,
  accept: (filePath: string) => boolean,
  {onUnreadable = 'skip'}: EntryFolderWalk = {}
): string[] {
  const found: string[] = []

  const walk = (current: string) => {
    let entries: fs.Dirent[]

    try {
      entries = fs.readdirSync(current, {withFileTypes: true})
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code

      if (onUnreadable === 'throw' && code && DENIED.has(code)) {
        throw error
      }

      return
    }

    for (const entry of entries) {
      if (isSkippedEntryName(entry.name)) continue

      const full = path.join(current, entry.name)

      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && accept(full)) found.push(full)
    }
  }

  walk(dir)

  return found.sort()
}

// The entry name a folder file builds under: its path inside the folder
// without the extension, and a page's `index` standing for its folder.
export function entryNameOf(
  folder: SpecialFolderName,
  folderRoot: string,
  filePath: string
): string {
  const relative = path.relative(folderRoot, filePath).split(path.sep).join('/')
  let name = relative.slice(0, -path.extname(relative).length)

  if (folder === 'pages' && name.endsWith('/index')) name = name.slice(0, -6)
  if (name === '') name = 'index'

  return `${folder}/${name}`
}

export type ScanEntryFolder = (
  folder: SpecialFolderName,
  folderRoot: string
) => Record<string, string>

// Only pages/ and scripts/ are read: public/ is the copier's to walk.
export const scanEntryFolder: ScanEntryFolder = (folder, folderRoot) => {
  const entries: Record<string, string> = {}
  const files = walkEntryFolder(
    folderRoot,
    (file) => isEntryFolderFile(folder, file),
    {onUnreadable: 'throw'}
  )

  for (const file of files) {
    entries[entryNameOf(folder, folderRoot, file)] = file
  }

  return entries
}
