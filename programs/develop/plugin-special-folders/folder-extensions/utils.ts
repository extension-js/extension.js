// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {isGeckoBasedBrowser} from '../../lib/constants'
import type {CompanionExtensionsConfig} from './types'

export function isDir(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function isFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile()
  } catch {
    return false
  }
}

export function toAbs(projectRoot: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(projectRoot, p)
}

export function isValidExtensionRoot(dir: string): boolean {
  if (!isDir(dir)) return false
  return isFile(path.join(dir, 'manifest.json'))
}

export function normalizeCompanionConfig(config?: CompanionExtensionsConfig): {
  dir?: string
  paths: string[]
} {
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

  return {dir: scanDir, paths: explicitPaths}
}

// The store downloader files companions under extensions/<browser>/ with
// these three folder names; a folder named for a browser belongs to that
// browser's sessions only. Any other name is a shared companion.
const BROWSER_COMPANION_FOLDERS = new Set(['chrome', 'edge', 'firefox'])

export function isBrowserNamedCompanionFolder(name: string): boolean {
  return BROWSER_COMPANION_FOLDERS.has(name.toLowerCase())
}

export function companionFolderForBrowser(browser: string | undefined): string {
  if (browser && isGeckoBasedBrowser(String(browser))) return 'firefox'
  if (browser === 'edge') return 'edge'
  return 'chrome'
}

export function companionFolderMatchesBrowser(
  name: string,
  browser: string | undefined
): boolean {
  return name.toLowerCase() === companionFolderForBrowser(browser)
}
