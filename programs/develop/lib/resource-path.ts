// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'

// Why this module exists
// ----------------------
// rspack hands loaders/rules a "canonical" (symlink-resolved) resource path. We
// canonicalize our own manifest/package/include dirs with `realpathSync.native`
// so they match it. The trap: `realpathSync.native` and `realpathSync` (and a
// plain `path.normalize`) can produce DIFFERENT strings for the same on-disk
// path, and the difference is platform-specific:
//   • Windows: `.native` expands 8.3 short names (`RUNNER~1` -> `runneradmin`)
//     and normalizes drive-letter case; non-native / raw paths do not.
//   • macOS:   `$TMPDIR` is a symlink (`/var` -> `/private/var`); native and
//     non-native realpath both resolve it, a raw path does not.
//   • Linux:   native and non-native typically agree (the bug stays invisible).
//
// So any code that compares a resource path against a canonicalized dir MUST
// canonicalize BOTH sides the SAME way, or the comparison silently fails on
// exactly one platform. That asymmetry has bitten the content-script wrapper
// twice (the loader's declared-entry match, and the loader rule's `include`).
// Route every such comparison through these helpers so the safe form is the
// default and can't be half-applied.

// Resolve a directory to its real, symlink-resolved path. Native first (so it
// matches rspack's resource path), then the JS realpath, then the raw path if
// the directory does not exist yet.
export function canonicalizeDir(dir: string): string {
  try {
    return fs.realpathSync.native(dir)
  } catch {
    try {
      return fs.realpathSync(dir)
    } catch {
      return dir
    }
  }
}

// Canonicalize a resource (file) path so it can be compared against
// `canonicalizeDir`-derived paths. We canonicalize the file's DIRECTORY (which
// exists during a build even when the resource itself is virtual, realpath on
// the file could throw) and re-append the basename.
export function canonicalizeResourcePath(resourcePath: string): string {
  if (typeof resourcePath !== 'string' || resourcePath.length === 0) {
    return resourcePath
  }
  try {
    return path.normalize(
      path.join(
        canonicalizeDir(path.dirname(resourcePath)),
        path.basename(resourcePath)
      )
    )
  } catch {
    return path.normalize(resourcePath)
  }
}

// Membership key for comparing a path against an rspack resource path via a
// Set/Map. `canonicalizeResourcePath` alone is NOT enough for equality checks:
// on Windows a drive-less absolute (`\project\sw.js`, the shape `path.join`
// and `path.normalize` preserve) never string-equals the drive-lettered form
// rspack reports (`D:\project\sw.js`, the shape `path.resolve` produces), so a
// set built with one and probed with the other silently never matches, on
// exactly one platform. `path.resolve` pins both sides to the same rooted
// form; drive-letter casing is then folded because `realpathSync.native` only
// normalizes it for paths that exist on disk.
export function toResourceKey(resourcePath: string): string {
  if (typeof resourcePath !== 'string' || resourcePath.length === 0) {
    return resourcePath
  }
  const key = canonicalizeResourcePath(path.resolve(resourcePath))
  if (process.platform === 'win32' && /^[a-zA-Z]:/.test(key)) {
    return key[0].toUpperCase() + key.slice(1)
  }
  return key
}

// True when `resource` resolves to a path inside any of `dirs`. `dirs` are
// expected to already be `canonicalizeDir`-resolved; the resource is
// canonicalized the same way here so cross-platform form differences don't
// break containment. Suitable as an rspack rule `include` function condition.
export function isResourceUnderDirs(resource: string, dirs: string[]): boolean {
  if (typeof resource !== 'string' || resource.length === 0) return false
  const candidate = canonicalizeResourcePath(resource)
  return dirs.some((dir) => {
    if (candidate === dir) return true
    const rel = path.relative(dir, candidate)
    return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
}
