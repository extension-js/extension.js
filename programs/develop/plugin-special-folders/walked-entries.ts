// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import {sourceFileMayShip} from '../lib/public-private-files'
import {
  foldersRoots,
  rememberedFolders,
  type SpecialFolderName
} from '../lib/special-folders/folders-config'
import type {SpecialFoldersConfig} from '../types'
import {
  type EntryNameCollision,
  entryNameOf,
  isEntryFolderFile,
  isSkippedEntryName,
  pickEntryFile
} from './entry-folders'

export interface WalkedEntries {
  kept: Record<string, string>
  // Left out for a private name or for a place outside the project.
  leftOut: string[]
  // The names more than one file builds under, and the file each one took.
  collisions: EntryNameCollision[]
}

interface WalkedFolder {
  name: SpecialFolderName
  dir: string
  roots: string[]
}

// The folder the walk reads, and the roots a walked file must stay inside.
// A folder the config names is the author's own word for where to walk.
function walkedFolderRoots(
  name: SpecialFolderName,
  projectRoot: string,
  folders: SpecialFoldersConfig
): WalkedFolder | undefined {
  const dir = foldersRoots(projectRoot, folders)[name]

  if (!dir) return undefined

  const named = typeof folders[name] === 'string'

  return {name, dir, roots: named ? [projectRoot, dir] : [projectRoot]}
}

// The scan passes over a link, so a linked file or folder is walked here
// and asked the same way. A folder reached twice is walked once.
function walkLinkedEntries(
  folder: WalkedFolder,
  claim: (name: string, file: string) => void,
  leftOut: string[]
) {
  const walked = new Set<string>()

  const walk = (dir: string, belowLink: boolean) => {
    let entries: fs.Dirent[]

    try {
      const real = fs.realpathSync(dir)

      if (walked.has(real)) return

      walked.add(real)
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }

    // Real folders first, so a link to one of them is the second visit.
    const ordered = [...entries].sort(
      (a, b) => Number(a.isSymbolicLink()) - Number(b.isSymbolicLink())
    )

    for (const entry of ordered) {
      if (isSkippedEntryName(entry.name)) continue

      const full = path.join(dir, entry.name)
      const isLink = entry.isSymbolicLink()

      if (!isLink && !belowLink) {
        if (entry.isDirectory()) walk(full, false)

        continue
      }

      let stat: fs.Stats

      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }

      const isEntry = stat.isFile() && isEntryFolderFile(folder.name, full)

      if (!isEntry && !stat.isDirectory()) continue

      if (!sourceFileMayShip(full, folder.roots, 'walked')) {
        if (isEntry || isLink) leftOut.push(full)

        continue
      }

      if (stat.isDirectory()) {
        walk(full, true)
        continue
      }

      claim(entryNameOf(folder.name, folder.dir, full), full)
    }
  }

  walk(folder.dir, false)
}

// No field names a walked file, so one the build withholds is no entry and
// no error. A folder of installed packages is passed over without a word.
export function guardWalkedEntries(
  name: SpecialFolderName,
  scanned: Record<string, string> | undefined,
  projectRoot: string,
  folders: SpecialFoldersConfig,
  rivals: Record<string, string[]> = {}
): WalkedEntries {
  const folder = walkedFolderRoots(name, projectRoot, folders)
  const kept: Record<string, string> = {}
  const leftOut: string[] = []

  if (!folder) return {kept: {...scanned}, leftOut, collisions: []}

  const mayBeEntry = (entry: unknown) => {
    const file = String(entry)

    // The scan hands over absolute paths. Another shape is not its own.
    if (!path.isAbsolute(file)) return true

    const names = path.relative(folder.dir, file).split(path.sep)

    if (names.some(isSkippedEntryName)) return false
    if (sourceFileMayShip(file, folder.roots, 'walked')) return true

    leftOut.push(file)

    return false
  }

  // Every file that may be an entry, by the name it would build under.
  const claims = new Map<string, string[]>()

  const claim = (key: string, file: string) => {
    const held = claims.get(key) || []

    if (!held.includes(file)) claims.set(key, [...held, file])
  }

  for (const [key, value] of Object.entries(scanned || {})) {
    if (Array.isArray(value)) {
      const entries = (value as unknown[]).filter(mayBeEntry)

      if (entries.length > 0) kept[key] = entries as unknown as string

      continue
    }

    for (const file of rivals[key] || [value]) {
      if (mayBeEntry(file)) claim(key, String(file))
    }
  }

  walkLinkedEntries(folder, claim, leftOut)

  const collisions: EntryNameCollision[] = []

  for (const [key, files] of claims) {
    const used = pickEntryFile(files)

    kept[key] = used

    if (files.length > 1) {
      collisions.push({
        name: key,
        used,
        dropped: files.filter((file) => file !== used).sort()
      })
    }
  }

  return {kept, leftOut, collisions}
}

// The linked files the walk takes as entries, so the watcher lists them
// beside the plain files and a link added mid-session asks for a restart.
export function linkedEntryFiles(
  projectRoot: string,
  folders: SpecialFoldersConfig = rememberedFolders(projectRoot)
): string[] {
  const files: string[] = []

  for (const name of ['pages', 'scripts'] as const) {
    const folder = walkedFolderRoots(name, projectRoot, folders)

    if (!folder) continue

    walkLinkedEntries(folder, (_name, file) => files.push(file), [])
  }

  return files
}
