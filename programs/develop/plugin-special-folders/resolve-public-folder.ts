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
