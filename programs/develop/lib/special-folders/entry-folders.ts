// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {codedError} from '../coded-error'
import {CODES} from '../messaging'
import {isScriptsFolderEntry, type SpecialFolderName} from './folders-config'
import * as messages from './messages'

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

interface EntryFolderWalk {
  // An unreadable folder is thrown as a coded error, or passed over.
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
        throw unreadableFolderError(dir, current, code)
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

// Named from the folder's parent, so `scripts/locked` reads the same in a
// moved folder, and never by an absolute path.
function unreadableFolderError(
  folderRoot: string,
  unreadable: string,
  code: string
) {
  const relative = path
    .relative(path.dirname(folderRoot), unreadable)
    .split(path.sep)
    .join('/')
  const error = codedError(
    CODES.E_FOLDER_UNREADABLE,
    messages.entryFolderUnreadable(
      relative,
      `${path.basename(folderRoot)}/`,
      code
    )
  )

  error.name = 'SpecialFolderUnreadable'

  return error
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

// Two files that build under one entry name: the build takes one of them.
export interface EntryNameCollision {
  name: string
  used: string
  dropped: string[]
}

// One name has one file, so the path that sorts last is the entry: the
// TypeScript source over its compiled copy, `a/index.html` over `a.html`.
export function pickEntryFile(files: string[]): string {
  return [...files].sort()[files.length - 1]
}

export type ScanEntryFolder = (
  folder: SpecialFolderName,
  folderRoot: string,
  // Every file of a name more than one file claims, for the caller to settle.
  rivals?: Record<string, string[]>
) => Record<string, string>

// Only pages/ and scripts/ are read: public/ is the copier's to walk.
export const scanEntryFolder: ScanEntryFolder = (
  folder,
  folderRoot,
  rivals
) => {
  const claims = new Map<string, string[]>()
  const files = walkEntryFolder(
    folderRoot,
    (file) => isEntryFolderFile(folder, file),
    {onUnreadable: 'throw'}
  )

  for (const file of files) {
    const name = entryNameOf(folder, folderRoot, file)

    claims.set(name, [...(claims.get(name) || []), file])
  }

  const entries: Record<string, string> = {}

  for (const [name, claimed] of claims) {
    entries[name] = pickEntryFile(claimed)

    if (rivals && claimed.length > 1) rivals[name] = claimed
  }

  return entries
}
