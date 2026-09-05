//      ██╗███████╗ ██████╗ ███╗   ██╗
//      ██║██╔════╝██╔═══██╗████╗  ██║
//      ██║███████╗██║   ██║██╔██╗ ██║
// ██   ██║╚════██║██║   ██║██║╚██╗██║
// ╚█████╔╝███████║╚██████╔╝██║ ╚████║
//  ╚════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {inspectPublicFolders} from '../../plugin-special-folders/resolve-public-folder'

export interface ResolvedJsonResource {
  abs: string
  // The copier ships this file, so feature-json must not emit a second copy.
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
// extension-root ref (`/rules.json`). The public folders the copier knows
// (project root first, then next to the manifest) win, matching pages and icons.
export function resolveJsonResource(
  thisResource: string,
  manifestDir: string,
  projectPath: string
): ResolvedJsonResource {
  // The public-folder helpers only read the manifest's directory.
  const manifestPath = path.join(manifestDir, 'manifest.json')
  const inspection = inspectPublicFolders(manifestPath, projectPath)
  // Root-level public/ first, then next to the manifest, the copier's order.
  const publicRoots = [inspection.fromRoot]
  if (
    path.resolve(inspection.fromManifest) !== path.resolve(inspection.fromRoot)
  ) {
    publicRoots.push(inspection.fromManifest)
  }
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

  // The fields package joins refs against the manifest dir, so a public-hosted
  // file shows up as `<manifestDir>/rules.json`. Mirror that path under every
  // public root, root-level public/ first so the copier's precedence holds.
  const relFromManifest = isInsideDir(joined, manifestDir)
    ? path.relative(manifestDir, joined)
    : ''
  const relFromProject = isInsideDir(joined, projectPath)
    ? path.relative(projectPath, joined)
    : ''
  const trimmedRootRef = looksLikeRootRef ? rawRef.replace(/^\/+/, '') : ''
  const relativeRef =
    !path.isAbsolute(rawRef) && !rawRef.startsWith('public/') ? rawRef : ''

  const candidates = [joined]
  for (const publicRoot of publicRoots) {
    const rels = [relFromManifest, trimmedRootRef, relativeRef]
    // A project-relative mirror only makes sense under the root folder.
    if (publicRoot === inspection.fromRoot) rels.push(relFromProject)
    for (const rel of rels) {
      if (rel) candidates.push(path.join(publicRoot, rel))
    }
  }

  const abs = firstExisting(candidates) || joined

  // Only the folder the copier ships counts: when both exist the root one
  // wins and a file under the shadowed next-to-manifest folder never lands.
  const isUnderPublic = publicRoots.some((publicRoot) => {
    if (!isInsideDir(abs, publicRoot)) return false
    return !inspection.bothExist || publicRoot === inspection.fromRoot
  })

  return {
    abs,
    isUnderPublic,
    isPublicRoot
  }
}
