import * as fs from 'fs'
import * as path from 'path'

/**
 * Companion extensions are "load-only" unpacked extension directories that
 * should be loaded alongside the user extension in dev/preview/start.
 *
 * Each directory MUST be an unpacked extension root containing a manifest.json.
 */
export type CompanionExtensionsConfig =
  | string[]
  | {
      /**
       * Folder to scan for subfolders that contain a manifest.json.
       * Example: "./extensions" -> loads "./extensions/*" (one level deep)
       */
      dir?: string
      /**
       * Explicit extension directories to load (absolute or relative to projectRoot).
       */
      paths?: string[]
    }

function isDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function toAbs(projectRoot: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(projectRoot, p)
}

function isValidExtensionRoot(dir: string): boolean {
  if (!isDir(dir)) return false
  return isFile(path.join(dir, 'manifest.json'))
}

/**
 * Resolve companion extension directories that should be loaded by the browser runner.
 * Load-only: we assume each directory is already an unpacked extension root.
 */
export function resolveCompanionExtensionDirs(opts: {
  projectRoot: string
  config?: CompanionExtensionsConfig
}): string[] {
  const {projectRoot, config} = opts

  const explicitPaths: string[] = []
  let scanDir: string | undefined

  if (Array.isArray(config)) {
    explicitPaths.push(
      ...config.filter((p): p is string => typeof p === 'string')
    )
  } else if (config && typeof config === 'object') {
    if (Array.isArray(config.paths)) {
      explicitPaths.push(
        ...config.paths.filter((p): p is string => typeof p === 'string')
      )
    }
    if (typeof config.dir === 'string' && config.dir.trim().length > 0) {
      scanDir = config.dir.trim()
    }
  }

  const found: string[] = []

  // Explicit paths first (stable order)
  for (const p of explicitPaths) {
    const abs = toAbs(projectRoot, p)
    if (isValidExtensionRoot(abs)) found.push(abs)
  }

  // Scan a directory for <dir>/*/manifest.json (one level deep)
  if (scanDir) {
    const absScan = toAbs(projectRoot, scanDir)
    if (isDir(absScan)) {
      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(absScan, {withFileTypes: true})
      } catch {
        entries = []
      }

      for (const ent of entries) {
        if (!ent.isDirectory()) continue
        if (ent.name.startsWith('.')) continue
        const candidate = path.join(absScan, ent.name)
        if (isValidExtensionRoot(candidate)) found.push(candidate)
      }
    }
  }

  // De-dupe while preserving order
  const unique: string[] = []
  const seen = new Set<string>()
  for (const p of found) {
    if (seen.has(p)) continue
    seen.add(p)
    unique.push(p)
  }

  return unique
}
