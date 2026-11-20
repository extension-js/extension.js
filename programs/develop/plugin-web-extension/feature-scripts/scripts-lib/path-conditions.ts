// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {
  canonicalizeDir,
  canonicalizeResourcePath
} from '../../../lib/resource-path'

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Either separator stands for any, and Windows paths ignore case, as the
// path comparisons these conditions replace did.
function pathPattern(file: string): string {
  return file
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .map(escaped)
    .join('[\\\\/]')
}

const FLAGS = process.platform === 'win32' ? 'i' : ''

// A path as written and its real spelling: the bundler hands a rule the
// resolved one, and a linked or short-named folder spells it the other way.
function spellings(file: string, canonical: (file: string) => string) {
  const written = path.resolve(file)

  return [...new Set([written, canonical(written)])]
}

// Matches a file inside any of the folders, read by the bundler with no
// call back into JavaScript for each module.
export function underFolders(dirs: string[]): RegExp {
  const patterns = dirs
    .flatMap((dir) => spellings(dir, canonicalizeDir))
    .map(pathPattern)

  return new RegExp(`^(?:${[...new Set(patterns)].join('|')})[\\\\/]`, FLAGS)
}

// Matches exactly one of the files, or nothing when there are none.
export function oneOfFiles(files: string[]): RegExp {
  const patterns = files
    .flatMap((file) => spellings(file, canonicalizeResourcePath))
    .map(pathPattern)

  if (patterns.length === 0) return /(?!)/

  return new RegExp(`^(?:${[...new Set(patterns)].join('|')})$`, FLAGS)
}

// Matches the one layer name, where a plain string would match its prefix.
export function exactly(name: string): RegExp {
  return new RegExp(`^${escaped(name)}$`)
}
