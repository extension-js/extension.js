// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

function isUsableDir(candidate: string): boolean {
  try {
    if (!fs.existsSync(candidate)) return false

    const stat = fs.statSync(candidate)

    // A stat without the method (a files-only mock) still counts as a folder.
    return typeof stat?.isDirectory === 'function' ? stat.isDirectory() : true
  } catch {
    return false
  }
}

export interface PublicFolderInspection {
  // The folder the build copies from; undefined when neither location exists.
  publicDir?: string
  fromRoot: string
  fromManifest: string
  // Only the next-to-manifest folder exists.
  usedFallback: boolean
  // Both folders exist and differ; the project-root one wins.
  bothExist: boolean
}

// The one answer to "where is public/": the project root, as for _locales,
// with the next-to-manifest folder accepted when the root has none. Every
// consumer (copier, root refs, resolve roots, dev-server watch) asks here.
export function inspectPublicFolders(
  manifestPath: string,
  projectRoot?: string
): PublicFolderInspection {
  const fromManifest = path.join(path.dirname(manifestPath), 'public')
  const fromRoot = projectRoot ? path.join(projectRoot, 'public') : fromManifest
  const sameLocation = path.resolve(fromRoot) === path.resolve(fromManifest)
  const rootOk = isUsableDir(fromRoot)
  const manifestOk = !sameLocation && isUsableDir(fromManifest)

  return {
    publicDir: rootOk ? fromRoot : manifestOk ? fromManifest : undefined,
    fromRoot,
    fromManifest,
    usedFallback: !rootOk && manifestOk,
    bothExist: rootOk && manifestOk
  }
}

export function resolvePublicFolder(
  manifestPath: string,
  projectRoot?: string
): string | undefined {
  return inspectPublicFolders(manifestPath, projectRoot).publicDir
}

function isUsableFile(candidate: string): boolean {
  try {
    if (!fs.existsSync(candidate)) return false

    const stat = fs.statSync(candidate)

    return typeof stat?.isFile === 'function' ? stat.isFile() : true
  } catch {
    return false
  }
}

// Strip every spelling a manifest uses for a public-hosted file down to its
// path inside the folder: `/public/x`, `public/x`, `./public/x`, `/x`, `./x`.
export function publicRelativePath(ref: string): string {
  return String(ref || '')
    .replace(/\\/g, '/')
    .replace(/^(?:\/public\/|(?:\.\/)?public\/)/i, '')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

// The copy of a manifest-referenced file that the public/ folder the copier
// ships holds (the project root one, or the next-to-manifest one when the
// root has none); undefined when that folder has no such file.
export function findPublicFile(
  manifestPath: string,
  projectRoot: string | undefined,
  ref: string
): string | undefined {
  const rel = publicRelativePath(ref)

  if (!rel || rel.split('/').includes('..') || path.isAbsolute(rel)) {
    return undefined
  }

  const {publicDir} = inspectPublicFolders(manifestPath, projectRoot)
  if (!publicDir) return undefined

  const candidate = path.join(publicDir, rel)

  return isUsableFile(candidate) ? candidate : undefined
}

// Consumers that need a path even when no folder exists (static serving,
// watch globs, containment checks) get the resolved one or the root default.
export function publicFolderOrDefault(
  manifestPath: string,
  projectRoot: string
): string {
  return (
    resolvePublicFolder(manifestPath, projectRoot) ||
    path.join(projectRoot, 'public')
  )
}

// Root-absolute refs resolve against project-root public/ first, then the
// manifest dir, then next-to-manifest public/, so links that resolve today
// keep winning while src-layout files become reachable.
export function publicResolveRoots(
  projectRoot: string,
  manifestPath: string
): string[] {
  const manifestDir = path.dirname(manifestPath)
  const fromRoot = path.join(projectRoot, 'public')
  const fromManifest = path.join(manifestDir, 'public')
  const roots = [fromRoot, manifestDir]

  if (path.resolve(fromManifest) !== path.resolve(fromRoot)) {
    roots.push(fromManifest)
  }

  return roots
}

// The public root each compiler ships from, kept per compiler so the reload
// classifier can map a changed source to the dist path the copier gives it.
const publicRootsByCompiler = new WeakMap<object, string[]>()

export function rememberPublicRoots(compiler: object, roots: string[]): void {
  publicRootsByCompiler.set(
    compiler,
    roots.filter(Boolean).map((root) => path.resolve(root))
  )
}

export function publicRootsFor(compiler: object | undefined | null): string[] {
  if (!compiler) return []

  return publicRootsByCompiler.get(compiler) || []
}
