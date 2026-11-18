// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {hasPrivateFileName} from '../../../plugin-special-folders/public-private-files'

export type WithheldReason =
  // A file or folder name the build keeps to the project, such as `.env`.
  | 'private-name'
  // A file inside node_modules.
  | 'installed-package'
  // A root URL that climbs above the extension root.
  | 'climbs-out'
  // A root URL or a link whose file sits outside the project.
  | 'outside-project'

export type ShipVerdict = {ship: true} | {ship: false; reason: WithheldReason}

export interface ShipQuestion {
  // The reference as written, when it starts with `/`: a path from the
  // extension root, never an address on this machine.
  rootRef?: string
  // The folder the copier ships. It answers for its own files by name alone.
  publicDir?: string
}

const SHIP: ShipVerdict = {ship: true}

function isInNodeModules(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]+/)
    .some((name) => name.toLowerCase() === 'node_modules')
}

function nameVerdict(relativePath: string): ShipVerdict {
  if (hasPrivateFileName(relativePath)) {
    return {ship: false, reason: 'private-name'}
  }

  if (isInNodeModules(relativePath)) {
    return {ship: false, reason: 'installed-package'}
  }

  return SHIP
}

// The path from a folder to a file inside it, or undefined when it is not.
function insideOf(folder: string, file: string): string | undefined {
  if (!folder) return undefined

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

// Under the fs stand-ins some specs install there is no real path to read,
// and a file that is not there has none. The path as given answers then.
function realOrSame(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

// Whether a build may copy this source file into the output folder. A file
// that may not is reported as missing by the step that asked.
export function sourceMayShip(
  sourcePath: string,
  projectRoot: string,
  extensionRoot: string,
  question: ShipQuestion = {}
): ShipVerdict {
  const source = path.resolve(sourcePath)
  const roots = [projectRoot, extensionRoot].filter(Boolean)

  // The copier leaves a private name out of public/ and ships the rest.
  const inPublic = question.publicDir && insideOf(question.publicDir, source)

  if (inPublic) {
    return hasPrivateFileName(inPublic)
      ? {ship: false, reason: 'private-name'}
      : SHIP
  }

  const isAddressInProject =
    question.rootRef !== undefined &&
    roots.some((root) => insideOf(root, question.rootRef as string))

  if (question.rootRef !== undefined && !isAddressInProject) {
    for (const spelling of browserSpellings(question.rootRef)) {
      if (spelling === '..' || spelling.startsWith('../')) {
        return {ship: false, reason: 'climbs-out'}
      }

      const verdict = nameVerdict(spelling)
      if (!verdict.ship) return verdict
    }
  }

  const written = roots
    .map((root) => insideOf(root, source))
    .find((relative) => relative !== undefined)

  // A root URL names a path inside the extension, so a file elsewhere on
  // this machine is not what it asks for.
  if (written === undefined && question.rootRef !== undefined) {
    return {ship: false, reason: 'outside-project'}
  }

  const base = projectRoot || extensionRoot
  const writtenVerdict = nameVerdict(written ?? path.relative(base, source))
  if (!writtenVerdict.ship) return writtenVerdict

  // A link is followed to the file it names, which has to pass as well.
  const real = realOrSame(source)
  const followed = roots
    .map((root) => insideOf(realOrSame(root), real))
    .find((relative) => relative !== undefined)

  // Written inside the project and leading out of it.
  if (written !== undefined && followed === undefined) {
    return {ship: false, reason: 'outside-project'}
  }

  return nameVerdict(followed ?? path.relative(realOrSame(base), real))
}
