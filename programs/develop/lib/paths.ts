// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {ProjectStructure} from './project'
import {
  PROJECT_MANIFEST_FILENAMES,
  readProjectDependencies
} from './project-manifest'

export type AbsolutePath = string & {readonly __brand: 'AbsolutePath'}
export type BrowserInput =
  | 'chrome'
  | 'edge'
  | 'chromium'
  | 'firefox'
  | 'brave'
  | 'opera'
  | 'vivaldi'
  | 'yandex'
  | 'waterfox'
  | 'librewolf'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'
  | 'safari'
  | 'webkit-based'
  | undefined

export type NormalizedBrowser =
  | 'chrome'
  | 'edge'
  | 'chromium'
  | 'firefox'
  | 'brave'
  | 'opera'
  | 'vivaldi'
  | 'yandex'
  | 'waterfox'
  | 'librewolf'
  | 'chromium-based'
  | 'gecko-based'
  | 'safari'
  | 'webkit-based'

export function asAbsolute(p: string): AbsolutePath {
  return (path.isAbsolute(p) ? p : path.resolve(p)) as AbsolutePath
}

// Watch-ignore globs are matched against forward-slash paths on every
// platform, so Windows absolute paths must be normalized before being
// embedded in a glob.
export function toPosixPath(p: string): string {
  return p.split(path.sep).join('/')
}

export function getDirs(struct: ProjectStructure): {
  manifestDir: AbsolutePath
  packageJsonDir: AbsolutePath
} {
  const manifestDir = asAbsolute(path.dirname(struct.manifestPath))
  const projectManifestPath = struct.packageJsonPath || struct.denoJsonPath
  const packageJsonDir = asAbsolute(
    projectManifestPath ? path.dirname(projectManifestPath) : manifestDir
  )
  return {manifestDir, packageJsonDir}
}

export function getNodeModulesDir(packageJsonDir: AbsolutePath): AbsolutePath {
  return asAbsolute(path.join(packageJsonDir, 'node_modules'))
}

export function needsInstall(packageJsonDir: AbsolutePath): boolean {
  const nm = getNodeModulesDir(packageJsonDir)

  // Web-only mode: no project manifest (package.json or deno.json(c)) means
  // there is nothing to install. Running an install here would crash with
  // ENOENT (e.g. when running `extension dev <github-url>` against a vanilla
  // Chrome sample).
  const hasManifest = PROJECT_MANIFEST_FILENAMES.some((filename) =>
    fs.existsSync(path.join(packageJsonDir, filename))
  )
  if (!hasManifest) {
    return false
  }

  try {
    // Merged across package.json dependency fields and deno.json(c) `npm:`
    // imports, either manifest can declare the packages the bundler needs.
    const deps = Object.keys(readProjectDependencies(packageJsonDir))
    if (deps.length === 0) {
      return false
    }

    if (!fs.existsSync(nm)) {
      return true
    }

    if (fs.existsSync(path.join(nm, '.pnpm'))) {
      return false
    }

    if (fs.existsSync(path.join(nm, '.modules.yaml'))) {
      return false
    }

    // Deno's nodeModulesDir "auto" layout keeps its store in node_modules/.deno.
    if (fs.existsSync(path.join(nm, '.deno'))) {
      return false
    }

    const hasInstalledDep = deps.some((dep) =>
      fs.existsSync(path.join(nm, dep))
    )
    return !hasInstalledDep
  } catch {
    return true
  }
}

export function normalizeBrowser(
  browser: BrowserInput,
  chromiumBinary?: string,
  geckoBinary?: string,
  safariBinary?: string
): NormalizedBrowser {
  const requested = String(browser || '')

  if (chromiumBinary) {
    if (!requested || requested === 'chromium-based') return 'chromium-based'
    if (requested === 'chromium') return 'chromium'
    if (requested === 'edge') return 'edge'
    if (requested === 'chrome') return 'chrome'
  }

  if (geckoBinary) {
    if (
      !requested ||
      requested === 'gecko-based' ||
      requested === 'firefox-based'
    )
      return 'gecko-based'
    if (requested === 'firefox') return 'firefox'
  }

  if (safariBinary) {
    if (!requested || requested === 'webkit-based') return 'webkit-based'
    if (requested === 'safari') return 'safari'
  }

  switch (requested) {
    case 'chrome':
      return 'chrome'
    case 'edge':
      return 'edge'
    case 'chromium':
      return 'chromium'
    case 'brave':
      return 'brave'
    case 'opera':
      return 'opera'
    case 'vivaldi':
      return 'vivaldi'
    case 'yandex':
      return 'yandex'
    case 'chromium-based':
      return 'chromium-based'
    case 'firefox':
      return 'firefox'
    case 'waterfox':
      return 'waterfox'
    case 'librewolf':
      return 'librewolf'
    case 'gecko-based':
    case 'firefox-based':
      return 'gecko-based'
    case 'safari':
      return 'safari'
    case 'webkit-based':
      return 'webkit-based'
    default:
      // Unrecognized input falls back to the documented default rather than
      // passing an invalid string through as a NormalizedBrowser. The CLI
      // validates browser names upstream; this is defense-in-depth.
      return 'chrome'
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

  if (struct.packageJsonPath || struct.denoJsonPath) {
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
  browser: unknown
): 'chrome' | 'edge' | 'chromium' | 'firefox' {
  switch (browser) {
    case 'chrome':
      return 'chrome'
    case 'edge':
      return 'edge'
    case 'chromium':
    case 'chromium-based':
    case 'brave':
    case 'opera':
    case 'vivaldi':
    case 'yandex':
      return 'chromium'
    case 'firefox':
    case 'gecko-based':
    case 'waterfox':
    case 'librewolf':
      return 'firefox'
    default:
      return 'chrome'
  }
}
