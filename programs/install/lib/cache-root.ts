//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import type {InstallBrowserTarget} from './browser-target'

// Where a managed browser lives. The launcher in the extension package keeps
// a copy, computeSharedCacheRoot, and one table spec here pins both on the
// path shapes of all three platforms, so they can never disagree. The working
// directory is read only where a branch needs it.
export function resolveBrowsersCacheRoot(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd?: string
): string {
  // Joined by the rules of the platform asked about. A path that is already
  // absolute here, or the folder this process runs in, keeps this host's rules.
  const p = platform === 'win32' ? path.win32 : path.posix
  const explicit = String(env.EXT_BROWSERS_CACHE_DIR || '').trim()

  if (explicit) {
    return path.isAbsolute(explicit) || cwd === undefined
      ? path.resolve(explicit)
      : p.resolve(cwd, explicit)
  }

  const inWorkingDir = () =>
    cwd === undefined
      ? path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
      : p.resolve(cwd, '.cache', 'extension.js', 'browsers')

  if (platform === 'win32') {
    const local = String(env.LOCALAPPDATA || '').trim()
    if (local) return p.join(local, 'extension.js', 'browsers')

    const userProfile = String(env.USERPROFILE || '').trim()

    if (userProfile) {
      return p.join(userProfile, 'AppData', 'Local', 'extension.js', 'browsers')
    }

    return inWorkingDir()
  }

  if (platform === 'darwin') {
    const home = String(env.HOME || '').trim()

    if (home) {
      return p.join(home, 'Library', 'Caches', 'extension.js', 'browsers')
    }

    return inWorkingDir()
  }

  const xdg = String(env.XDG_CACHE_HOME || '').trim()
  if (xdg) return p.join(xdg, 'extension.js', 'browsers')

  const home = String(env.HOME || '').trim()
  if (home) return p.join(home, '.cache', 'extension.js', 'browsers')

  return inWorkingDir()
}

export function resolveBrowserInstallDir(
  browser: InstallBrowserTarget,
  cacheRoot: string = resolveBrowsersCacheRoot()
): string {
  return path.join(cacheRoot, browser)
}

// Windows answers EBUSY while a scanner or a closing browser still holds a
// file, and lets go a moment later, so the removal waits and tries again.
export function removeTree(dir: string): void {
  try {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 4,
      retryDelay: 100
    })
  } catch (error) {
    throw explainRemovalFailure(dir, error)
  }
}

// A file this user may not delete surfaces as ENOTEMPTY on the folder above
// it, which names the wrong cause. The folder that refused is the real one.
function explainRemovalFailure(dir: string, error: unknown): unknown {
  if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOTEMPTY') {
    return error
  }

  const blocked = firstUnwritableFolder(dir)
  if (!blocked) return error

  return Object.assign(
    new Error(`EACCES: permission denied, no write access to '${blocked}'`),
    {code: 'EACCES', path: blocked, cause: error}
  )
}

// What is left after a failed removal is small, so a bounded walk finds the
// folder whose entries this user cannot remove.
function firstUnwritableFolder(dir: string): string | null {
  const queue = [dir]

  for (let seen = 0; queue.length > 0 && seen < 10_000; seen++) {
    const current = queue.shift() as string

    try {
      fs.accessSync(current, fs.constants.W_OK)
    } catch {
      return current
    }

    try {
      for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
        if (entry.isDirectory()) queue.push(path.join(current, entry.name))
      }
    } catch {
      // A folder that cannot be listed is one more that cannot be emptied.
      return current
    }
  }

  return null
}
