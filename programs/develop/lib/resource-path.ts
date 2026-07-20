// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

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

// Resolve a directory to its real, symlink-resolved path: native first (matches
// rspack), then JS realpath, then the raw path if the dir doesn't exist yet.
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

// Canonicalize the file's DIRECTORY (exists during a build even when the
// resource is virtual) and re-append the basename.
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

// Membership key for path comparison: path.resolve pins both sides to the same
// rooted form on Windows, where drive-less and drive-lettered shapes never equal.
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

// True when resource resolves inside any of dirs (already canonicalized);
// suitable as an rspack rule include condition.
export function isResourceUnderDirs(resource: string, dirs: string[]): boolean {
  if (typeof resource !== 'string' || resource.length === 0) return false
  const candidate = canonicalizeResourcePath(resource)
  return dirs.some((dir) => {
    if (candidate === dir) return true
    const rel = path.relative(dir, candidate)
    return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
}
