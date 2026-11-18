// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {
  hasPrivateFileName,
  sourceFileMayShip
} from '../../../plugin-special-folders/public-private-files'

export interface ShipQuestion {
  // The reference as written, when it starts with `/`: a path from the
  // extension root, never an address on this machine.
  rootRef?: string
  // The folder the copier ships. It answers for its own files by name alone.
  publicDir?: string
}

// The path from a folder to a file inside it, or undefined when it is not.
function insideOf(folder: string, file: string): string | undefined {
  const relative = path.relative(folder, file)

  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined
  }

  return relative
}

// The name as written and as the browser reads it, where `%2e%2e` is `..`.
function browserSpellings(rootRef: string): string[] {
  const written = rootRef.split(/[?#]/)[0].replace(/^\/+/, '')
  const spellings = [written]

  try {
    spellings.push(decodeURIComponent(written))
  } catch {
    // Not a valid escape, so the browser asks for the name as written.
  }

  return spellings.map((spelling) =>
    path.posix.normalize(spelling.replace(/\\/g, '/'))
  )
}

// Whether a build may copy this source file into the output folder. A file
// that may not is reported as missing by the step that asked.
export function sourceMayShip(
  sourcePath: string,
  projectRoot: string,
  extensionRoot: string,
  question: ShipQuestion = {}
): boolean {
  const roots = [projectRoot, extensionRoot].filter(Boolean)
  const {rootRef, publicDir} = question

  // An address inside the project is a file on disk, read as one below.
  if (rootRef !== undefined && !roots.some((root) => insideOf(root, rootRef))) {
    const spellings = browserSpellings(rootRef)

    if (
      spellings.some(
        (name) =>
          name === '..' || name.startsWith('../') || hasPrivateFileName(name)
      )
    ) {
      return false
    }
  }

  // The copier leaves a private name out of public/ and ships the rest, so
  // the name is asked before the folder answers.
  const inPublic = publicDir && insideOf(publicDir, path.resolve(sourcePath))
  if (inPublic) return !hasPrivateFileName(inPublic)

  return sourceFileMayShip(sourcePath, roots)
}
