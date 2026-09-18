// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {isEmulatorBrowser, isEmulatorLaneEnabled} from './constants'
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
  | 'zen'
  | 'floorp'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'
  | 'safari'
  | 'webkit-based'
  | 'chromium-emulator'
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
  | 'zen'
  | 'floorp'
  | 'chromium-based'
  | 'gecko-based'
  | 'safari'
  | 'webkit-based'
  | 'chromium-emulator'

export function asAbsolute(p: string): AbsolutePath {
  return (path.isAbsolute(p) ? p : path.resolve(p)) as AbsolutePath
}

// Watch-ignore globs match forward-slash paths on every platform, so Windows
// absolute paths must be normalized before embedding in a glob.
export function toPosixPath(p: string): string {
  return p.split(path.sep).join('/')
}

// Printed paths collapse the home dir for scanability. Evidence and debug
// lines never do, so a pasted path stays valid.
export function collapseHomeDir(value: string): string {
  const raw = String(value || '')
  const home = os.homedir()
  if (!home || !raw.startsWith(home)) return raw

  const rest = raw.slice(home.length)
  if (rest === '') return '~'
  if (rest.startsWith(path.sep) || rest.startsWith('/')) return `~${rest}`

  return raw
}

// A path inside the base dir prints relative to it; the base itself and
// anything outside it return null so the caller picks a longer form.
export function relativeToDir(target: string, base: string): string | null {
  const relative = path.relative(base, target)

  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative
  }

  return null
}

// The one shortening rule every human line shares with the session card:
// relative inside the project, the `~/` form under the home dir, else as is.
export function displayPath(target: string, base = process.cwd()): string {
  return relativeToDir(target, base) || collapseHomeDir(target)
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

export function needsInstall(
  packageJsonDir: AbsolutePath,
  workspaceRoot?: string
): boolean {
  const nm = getNodeModulesDir(packageJsonDir)

  // Web-only mode: no project manifest means nothing to install; an install
  // here would crash with ENOENT (e.g. dev <github-url> on a vanilla sample).
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

    if (fs.existsSync(nm)) {
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
      if (hasInstalledDep) return false
    }

    // A hoisted pnpm workspace keeps every member's packages in the root
    // node_modules, where resolution from the member still finds them.
    if (workspaceRoot) {
      const rootModules = path.join(workspaceRoot, 'node_modules')

      return !deps.some((dep) => fs.existsSync(path.join(rootModules, dep)))
    }

    return true
  } catch {
    return true
  }
}

// Every name normalizeBrowser maps on its own; anything else is refused
// before it reaches a build, whether typed or read from extension.config.
const KNOWN_BROWSER_NAMES = new Set([
  'chrome',
  'edge',
  'chromium',
  'brave',
  'opera',
  'vivaldi',
  'yandex',
  'chromium-based',
  'firefox',
  'waterfox',
  'librewolf',
  'zen',
  'floorp',
  'gecko-based',
  'firefox-based',
  'safari',
  'webkit-based'
])

export function isKnownBrowserName(name: unknown): boolean {
  if (typeof name !== 'string') return false
  if (isEmulatorBrowser(name)) return isEmulatorLaneEnabled()

  return KNOWN_BROWSER_NAMES.has(name)
}

// commands.<cmd>.browser from extension.config.js, only when no browser was
// passed in; the name is checked like a typed one.
export function configBrowserOrThrow(
  configBrowser: unknown,
  command: string
): BrowserInput | undefined {
  if (configBrowser === undefined || configBrowser === null) return undefined

  if (!isKnownBrowserName(configBrowser)) {
    throw new Error(
      `Unsupported browser in extension.config commands.${command}.browser: ${String(configBrowser)}`
    )
  }

  return configBrowser as BrowserInput
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
    ) {
      return 'gecko-based'
    }

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
    case 'zen':
      return 'zen'
    case 'floorp':
      return 'floorp'
    case 'gecko-based':
    case 'firefox-based':
      return 'gecko-based'
    case 'safari':
      return 'safari'
    case 'webkit-based':
      return 'webkit-based'
    case 'chromium-emulator':
      if (isEmulatorLaneEnabled()) return 'chromium-emulator'

      return 'chrome'
    default:
      // Unrecognized input falls back to the documented default; the CLI validates
      // upstream, this is defense-in-depth.
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
      // Ignore
    }
  }

  return manifestDir
}

export function ensureDirSync(dir: AbsolutePath) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true})
  } catch {
    // Ignore
  }
}

export function devtoolsEngineFor(
  browser: unknown
): 'chrome' | 'edge' | 'chromium' | 'firefox' | 'safari' {
  switch (browser) {
    case 'chrome':
      return 'chrome'
    case 'edge':
      return 'edge'
    case 'chromium':
    case 'chromium-based':
    case 'chromium-emulator':
    case 'brave':
    case 'opera':
    case 'vivaldi':
    case 'yandex':
      return 'chromium'
    case 'firefox':
    case 'gecko-based':
    case 'waterfox':
    case 'librewolf':
    case 'zen':
    case 'floorp':
      return 'firefox'
    // Safari is not a chromium fork: no safari companion build ships today,
    // so callers probing dist/<package>/safari correctly find nothing.
    case 'safari':
    case 'webkit-based':
      return 'safari'
    default:
      return 'chrome'
  }
}
