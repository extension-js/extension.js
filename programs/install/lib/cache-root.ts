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
  const p = platform === 'win32' ? path.win32 : path.posix
  const explicit = String(env.EXT_BROWSERS_CACHE_DIR || '').trim()

  if (explicit) {
    return cwd === undefined ? p.resolve(explicit) : p.resolve(cwd, explicit)
  }

  // Nothing to resolve against falls back to the folder the process runs in.
  const inWorkingDir = () =>
    p.resolve(cwd ?? process.cwd(), '.cache', 'extension.js', 'browsers')

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
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 100
  })
}
