// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {publicRootsFor} from '../plugin-special-folders/resolve-public-folder'
import {projectRelative, resolveReal} from './project-relative'

// What one compile read: its file dependencies (modules, loader inputs,
// manifest references, config and env files) and the paths it looked for.
export interface BuildReads {
  files: Set<string>
  missing: Set<string>
}

export function readsOfCompilation(
  compilation: unknown
): BuildReads | undefined {
  const {fileDependencies, missingDependencies} = (compilation || {}) as {
    fileDependencies?: Iterable<string>
    missingDependencies?: Iterable<string>
  }

  // A compile that does not say what it read keeps every reported file.
  if (
    !fileDependencies ||
    typeof fileDependencies[Symbol.iterator] !== 'function'
  ) {
    return undefined
  }

  // Resolved so each entry compares with path.resolve(root, rel) whatever
  // slashes the bundler or a loader reported it with.
  return {
    files: new Set(Array.from(fileDependencies, (f) => path.resolve(f))),
    missing: new Set(
      Array.from(missingDependencies || [], (f) => path.resolve(f))
    )
  }
}

// Both spellings of a folder: macOS reports /private/var/... for a project
// the context names /var/...
function bothSpellings(folder: string): string[] {
  const real = resolveReal(folder)

  return real === folder ? [folder] : [folder, real]
}

function isUnder(file: string, folder: string): boolean {
  return file.startsWith(folder.endsWith(path.sep) ? folder : folder + path.sep)
}

// The compile before counts too, so a delete is kept. public/ ships every
// file whether or not anything reads it.
export function wasReadByBuild(
  rel: string,
  options: {
    contextDir: string
    reads: BuildReads
    readBefore?: Set<string>
    publicRoots: string[]
  }
): boolean {
  const {contextDir, reads, readBefore, publicRoots} = options

  for (const root of publicRoots) {
    if (rel.startsWith(`${root.replace(/\/+$/, '')}/`)) return true
  }

  for (const root of bothSpellings(contextDir)) {
    const absolute = path.resolve(root, rel)
    if (reads.files.has(absolute) || readBefore?.has(absolute)) return true

    for (
      let looked = absolute;
      isUnder(looked, root);
      looked = path.dirname(looked)
    ) {
      if (reads.missing.has(looked)) return true
    }
  }

  return false
}

// The watcher names only the folder when a file appears in or leaves one a
// glob reads, so the file is the one the build started or stopped reading.
export function filesBehindFolders(options: {
  contextDir: string
  folders: string[]
  reads: BuildReads
  readBefore?: Set<string>
}): string[] {
  const {contextDir, folders, reads, readBefore} = options
  if (!readBefore || folders.length === 0) return []

  const roots = folders.flatMap((folder) => bothSpellings(folder))
  const out: string[] = []

  const consider = (file: string) => {
    if (file.split(path.sep).includes('node_modules')) return
    if (!roots.some((root) => isUnder(file, root))) return

    const rel = projectRelative(contextDir, file)
    if (rel && !rel.startsWith('..') && !out.includes(rel)) out.push(rel)
  }

  for (const file of reads.files) {
    if (!readBefore.has(file)) consider(file)
  }

  for (const file of readBefore) {
    if (!reads.files.has(file)) consider(file)
  }

  return out
}

// The public/ roots as project-relative prefixes, like the changed paths.
export function relativePublicRootsOf(
  compiler: object | undefined | null,
  contextDir: string
): string[] {
  const out: string[] = []

  for (const root of publicRootsFor(compiler)) {
    const rel = projectRelative(contextDir, root)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) out.push(rel)
  }

  return out
}
