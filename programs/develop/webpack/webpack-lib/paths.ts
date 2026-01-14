// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import type {ProjectStructure} from './project'

export type AbsolutePath = string & {readonly __brand: 'AbsolutePath'}
export type BrowserInput =
  | 'chrome'
  | 'edge'
  | 'chromium'
  | 'firefox'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'
  | undefined

export type NormalizedBrowser =
  | 'chrome'
  | 'edge'
  | 'chromium'
  | 'firefox'
  | 'chromium-based'
  | 'gecko-based'

export function asAbsolute(p: string): AbsolutePath {
  return (path.isAbsolute(p) ? p : path.resolve(p)) as AbsolutePath
}

export function getDirs(struct: ProjectStructure): {
  manifestDir: AbsolutePath
  packageJsonDir: AbsolutePath
} {
  const manifestDir = asAbsolute(path.dirname(struct.manifestPath))
  const packageJsonDir = asAbsolute(
    struct.packageJsonPath ? path.dirname(struct.packageJsonPath) : manifestDir
  )
  return {manifestDir, packageJsonDir}
}

export function getNodeModulesDir(packageJsonDir: AbsolutePath): AbsolutePath {
  return asAbsolute(path.join(packageJsonDir, 'node_modules'))
}

export function needsInstall(packageJsonDir: AbsolutePath): boolean {
  const nm = getNodeModulesDir(packageJsonDir)
  try {
    return !fs.existsSync(nm) || fs.readdirSync(nm).length === 0
  } catch {
    return true
  }
}

export function normalizeBrowser(
  browser: BrowserInput,
  chromiumBinary?: string,
  geckoBinary?: string
): NormalizedBrowser {
  if (chromiumBinary) return 'chromium-based'
  if (geckoBinary) return 'gecko-based'
  switch (String(browser || '')) {
    case 'chrome':
      return 'chrome'
    case 'edge':
      return 'edge'
    case 'chromium':
    case 'chromium-based':
      return 'chromium'
    case 'firefox':
    case 'firefox-based':
    case 'gecko-based':
      return 'firefox'
    default:
      return (browser as NormalizedBrowser) || 'chrome'
  }
}

export function getDistPath(
  packageJsonDir: AbsolutePath,
  browser: string
): AbsolutePath {
  return asAbsolute(path.join(packageJsonDir, 'dist', browser))
}

export function computePreviewOutputPath(
  struct: ProjectStructure,
  browser: string,
  explicitOutputPath?: string
): AbsolutePath {
  const {manifestDir, packageJsonDir} = getDirs(struct)
  if (explicitOutputPath) return asAbsolute(explicitOutputPath)

  if (struct.packageJsonPath) {
    const distDir = getDistPath(packageJsonDir, browser)
    try {
      if (fs.existsSync(path.join(distDir, 'manifest.json'))) {
        return distDir
      }
    } catch {
      // ignore
    }
  }
  return manifestDir
}

export function ensureDirSync(dir: AbsolutePath) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true})
  } catch {
    // ignore
  }
}

export function devtoolsEngineFor(
  browser: any
): 'chrome' | 'edge' | 'chromium' | 'firefox' {
  switch (browser) {
    case 'chrome':
      return 'chrome'
    case 'edge':
      return 'edge'
    case 'chromium':
    case 'chromium-based':
      return 'chromium'
    case 'firefox':
    case 'gecko-based':
      return 'firefox'
    default:
      return 'chrome'
  }
}
