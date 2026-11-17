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

// The working directory is read only where a branch needs it, so a caller
// that leaves it out never asks the process for one it would not use.
export function resolveBrowsersCacheRoot(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd?: string
): string {
  const explicit = String(env.EXT_BROWSERS_CACHE_DIR || '').trim()

  if (explicit) {
    return cwd === undefined
      ? path.resolve(explicit)
      : path.resolve(cwd, explicit)
  }

  const isWin = platform === 'win32'
  const isMac = platform === 'darwin'

  if (isWin) {
    const local = String(env.LOCALAPPDATA || '').trim()
    if (local) return path.join(local, 'extension.js', 'browsers')

    const userProfile = String(env.USERPROFILE || '').trim()

    if (userProfile) {
      return path.join(
        userProfile,
        'AppData',
        'Local',
        'extension.js',
        'browsers'
      )
    }

    return path.resolve(
      cwd ?? process.cwd(),
      '.cache',
      'extension.js',
      'browsers'
    )
  }

  if (isMac) {
    const home = String(env.HOME || '').trim()

    if (home) {
      return path.join(home, 'Library', 'Caches', 'extension.js', 'browsers')
    }

    return path.resolve(
      cwd ?? process.cwd(),
      '.cache',
      'extension.js',
      'browsers'
    )
  }

  const xdg = String(env.XDG_CACHE_HOME || '').trim()
  if (xdg) return path.join(xdg, 'extension.js', 'browsers')

  const home = String(env.HOME || '').trim()
  if (home) return path.join(home, '.cache', 'extension.js', 'browsers')

  return path.resolve(
    cwd ?? process.cwd(),
    '.cache',
    'extension.js',
    'browsers'
  )
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
