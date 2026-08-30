//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface ResolvedJsonResource {
  abs: string
  isUnderPublic: boolean
  // Leading '/' that is not an OS path under the project (pages-style public root).
  isPublicRoot: boolean
}

function isInsideDir(abs: string, dir: string): boolean {
  const rel = path.relative(dir, abs)
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

function firstExisting(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return undefined
}

// includeList values may be OS-absolute, public-relative, or a leading-slash
// extension-root ref (`/rules.json`). public/ wins, matching pages and icons.
export function resolveJsonResource(
  thisResource: string,
  manifestDir: string,
  projectPath: string
): ResolvedJsonResource {
  const publicDir = path.join(projectPath, 'public')
  const rawRef = String(thisResource)
  const looksLikeRootRef =
    rawRef.startsWith('/') &&
    !rawRef.startsWith('//') &&
    !(projectPath && rawRef.startsWith(projectPath))
  // `/rules.json` is the public-root spelling. `/abs/path/file.json` is an
  // already-resolved OS path and must not pick up the public/ hint.
  const isPublicRoot =
    looksLikeRootRef &&
    (!path.isAbsolute(rawRef) ||
      path.dirname(rawRef) === path.parse(rawRef).root)

  const joined = path.isAbsolute(rawRef)
    ? rawRef
    : path.join(manifestDir, rawRef)

  const publicFromProject = isInsideDir(joined, projectPath)
    ? path.join(publicDir, path.relative(projectPath, joined))
    : ''
  const publicFromSlash = looksLikeRootRef
    ? path.join(publicDir, rawRef.replace(/^\/+/, ''))
    : ''
  const publicFromRelative =
    !path.isAbsolute(rawRef) && !rawRef.startsWith('public/')
      ? path.join(publicDir, rawRef)
      : ''

  const abs =
    firstExisting([
      joined,
      publicFromProject,
      publicFromSlash,
      publicFromRelative
    ]) || joined

  return {
    abs,
    isUnderPublic: isInsideDir(abs, publicDir),
    isPublicRoot
  }
}
