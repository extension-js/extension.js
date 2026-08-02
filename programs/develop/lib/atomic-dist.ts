// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// One-shot builds emit into a hidden staging sibling of dist/<browser> and
// only a whole-directory rename publishes it, so consumers that gate on
// manifest.json presence can never observe a manifest without its pages.
export const DIST_STAGING_PREFIX = '.extension-build-'

export function stagingDistPathFor(distPath: string): string {
  const unique = `${process.pid.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  return path.join(
    path.dirname(distPath),
    `${DIST_STAGING_PREFIX}${path.basename(distPath)}-${unique}`
  )
}

// Interrupted builds (SIGINT, crash, OOM) leave their staging directory
// behind since no process survives to remove it. The next build sweeps them.
export function removeStaleStagingDirs(distPath: string): void {
  const parent = path.dirname(distPath)
  const prefix = `${DIST_STAGING_PREFIX}${path.basename(distPath)}-`

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(parent, {withFileTypes: true})
  } catch {
    return
  }

  for (const entry of entries) {
    try {
      if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
      fs.rmSync(path.join(parent, entry.name), {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }
}

export function removeStagingDir(stagingPath: string): void {
  try {
    fs.rmSync(stagingPath, {recursive: true, force: true})
  } catch {
    // Ignore
  }
}

// Two renames instead of emitting into dist/<browser> directly: at any point
// the dist is the previous complete build, briefly absent, or the new one.
export function promoteStagingDist(
  stagingPath: string,
  distPath: string
): void {
  const parent = path.dirname(distPath)
  fs.mkdirSync(parent, {recursive: true})

  const retiredPath = `${stagingPath}-retired`
  let retired = false
  if (fs.existsSync(distPath)) {
    fs.renameSync(distPath, retiredPath)
    retired = true
  }

  try {
    fs.renameSync(stagingPath, distPath)
  } catch (error) {
    // Put the previous build back so a failed promote never costs the
    // last-good dist the staging swap exists to protect.
    if (retired) {
      try {
        fs.renameSync(retiredPath, distPath)
      } catch {
        // Ignore
      }
    }
    throw error
  }

  if (retired) {
    try {
      fs.rmSync(retiredPath, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }
}
