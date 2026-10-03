// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {publicFolderSetting} from './folders-config'

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
  const setting = publicFolderSetting(projectRoot)
  const fromManifest = path.join(path.dirname(manifestPath), 'public')
  const fromRoot =
    setting.kind === 'path'
      ? setting.dir
      : projectRoot
        ? path.join(projectRoot, 'public')
        : fromManifest
  const sameLocation = path.resolve(fromRoot) === path.resolve(fromManifest)
  // A configured folder is the only one read, and `false` reads none.
  const rootOk = setting.kind !== 'off' && isUsableDir(fromRoot)
  const manifestOk =
    setting.kind === 'default' && !sameLocation && isUsableDir(fromManifest)

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

// The public folders a `public: false` project still has on disk, at the
// root and next to the manifest. Nothing in them ships.
export function turnedOffPublicFolders(
  manifestPath: string,
  projectRoot?: string
): string[] {
  if (publicFolderSetting(projectRoot).kind !== 'off') return []

  const {fromRoot, fromManifest} = inspectPublicFolders(
    manifestPath,
    projectRoot
  )
  const folders = new Set([path.resolve(fromRoot), path.resolve(fromManifest)])

  return [...folders].filter(isUsableDir)
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

// Consumers that need a path even when the folder does not exist yet (static
// serving, watch globs, containment checks) get the resolved one or the
// configured location; `false` reads no folder, so they get none.
export function publicFolderOrDefault(
  manifestPath: string,
  projectRoot: string
): string | undefined {
  const setting = publicFolderSetting(projectRoot)

  if (setting.kind === 'off') return undefined

  return (
    resolvePublicFolder(manifestPath, projectRoot) ||
    (setting.kind === 'path' ? setting.dir : path.join(projectRoot, 'public'))
  )
}

// The CSS ref checks measure containment, so they need a root to compare
// against even when the copier reads no folder at all.
export function publicContainmentRoot(
  manifestPath: string,
  projectRoot: string
): string {
  return (
    publicFolderOrDefault(manifestPath, projectRoot) ||
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
  const setting = publicFolderSetting(projectRoot)
  const manifestDir = path.dirname(manifestPath)

  if (setting.kind === 'off') return [manifestDir]
  if (setting.kind === 'path') return [setting.dir, manifestDir]

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
