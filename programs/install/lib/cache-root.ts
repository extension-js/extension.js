import fs from 'node:fs'
import path from 'node:path'
import {InstallBrowserTarget} from './browser-target'

export function resolveBrowsersCacheRoot(): string {
  const explicit = String(process.env.EXT_BROWSERS_CACHE_DIR || '').trim()
  if (explicit) return path.resolve(explicit)

  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  if (isWin) {
    const local = String(process.env.LOCALAPPDATA || '').trim()
    if (local) return path.join(local, 'extension.js', 'browsers')

    const userProfile = String(process.env.USERPROFILE || '').trim()
    if (userProfile) {
      return path.join(
        userProfile,
        'AppData',
        'Local',
        'extension.js',
        'browsers'
      )
    }

    return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
  }

  if (isMac) {
    const home = String(process.env.HOME || '').trim()
    if (home)
      return path.join(home, 'Library', 'Caches', 'extension.js', 'browsers')
    return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
  }

  const xdg = String(process.env.XDG_CACHE_HOME || '').trim()
  if (xdg) return path.join(xdg, 'extension.js', 'browsers')

  const home = String(process.env.HOME || '').trim()
  if (home) return path.join(home, '.cache', 'extension.js', 'browsers')

  return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
}

export function resolveBrowserInstallDir(
  browser: InstallBrowserTarget
): string {
  return path.join(resolveBrowsersCacheRoot(), browser)
}

export function removeBrowserDir(browser: InstallBrowserTarget): {
  path: string
  removed: boolean
} {
  const installDir = resolveBrowserInstallDir(browser)

  if (!fs.existsSync(installDir)) {
    return {path: installDir, removed: false}
  }

  fs.rmSync(installDir, {recursive: true, force: true})
  return {path: installDir, removed: true}
}
