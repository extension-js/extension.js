// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import type {SpecialFoldersConfig} from '../types'
import {foldersRoots, isScriptsFolderEntry} from './folders-config'
import {sourceFileMayShip} from './public-private-files'

const isPackageFolder = (name: string) => name.toLowerCase() === 'node_modules'

export interface WalkedScripts {
  kept: Record<string, string>
  // Left out for a private name or for a place outside the project.
  leftOut: string[]
}

// The folder the walk reads, and the roots a walked file must stay inside.
// A folder the config names is the author's own word for where to walk.
function walkedScriptsRoots(
  projectRoot: string,
  folders: SpecialFoldersConfig
): {dir: string; roots: string[]} | undefined {
  const dir = foldersRoots(projectRoot, folders).scripts

  if (!dir) return undefined

  const named = typeof folders.scripts === 'string'

  return {dir, roots: named ? [projectRoot, dir] : [projectRoot]}
}

// The scan passes over a link, so a linked file or folder is walked here
// and asked the same way. A folder reached twice is walked once.
function walkLinkedScripts(
  folder: {dir: string; roots: string[]},
  kept: Record<string, string>,
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
      if (isPackageFolder(entry.name)) continue

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

      const isScript = stat.isFile() && isScriptsFolderEntry(full)

      if (!isScript && !stat.isDirectory()) continue

      if (!sourceFileMayShip(full, folder.roots, 'walked')) {
        if (isScript || isLink) leftOut.push(full)

        continue
      }

      if (stat.isDirectory()) {
        walk(full, true)
        continue
      }

      const name = path.relative(folder.dir, full).split(path.sep).join('/')

      kept[`scripts/${name.slice(0, -path.extname(name).length)}`] = full
    }
  }

  walk(folder.dir, false)
}

// No field names a walked file, so one the build withholds is no entry and
// no error. A folder of installed packages is passed over without a word.
export function guardWalkedScripts(
  scripts: Record<string, string> | undefined,
  projectRoot: string,
  folders: SpecialFoldersConfig
): WalkedScripts {
  const folder = walkedScriptsRoots(projectRoot, folders)
  const kept: Record<string, string> = {}
  const leftOut: string[] = []

  if (!folder) return {kept: {...scripts}, leftOut}

  const mayBeEntry = (entry: unknown) => {
    const file = String(entry)

    // The scan hands over absolute paths. Another shape is not its own.
    if (!path.isAbsolute(file)) return true

    const names = path.relative(folder.dir, file).split(path.sep)

    if (names.some(isPackageFolder)) return false
    if (sourceFileMayShip(file, folder.roots, 'walked')) return true

    leftOut.push(file)

    return false
  }

  for (const [key, value] of Object.entries(scripts || {})) {
    const files: unknown[] = Array.isArray(value) ? value : [value]
    const entries = files.filter(mayBeEntry)

    if (entries.length === 0) continue

    kept[key] = Array.isArray(value)
      ? (entries as unknown as string)
      : String(entries[0])
  }

  walkLinkedScripts(folder, kept, leftOut)

  return {kept, leftOut}
}
