// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {CompilationLike} from '../browsers-types'

function computeSharedCacheRoot(): string {
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

    if (home) {
      return path.join(home, 'Library', 'Caches', 'extension.js', 'browsers')
    }

    return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
  }

  const xdg = String(process.env.XDG_CACHE_HOME || '').trim()

  if (xdg) return path.join(xdg, 'extension.js', 'browsers')

  const home = String(process.env.HOME || '').trim()

  if (home) {
    return path.join(home, '.cache', 'extension.js', 'browsers')
  }

  return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
}

export function getCompilationOutputPath(compilation: CompilationLike): string {
  try {
    return (
      compilation.options?.output?.path || compilation.outputOptions?.path || ''
    )
  } catch {
    return ''
  }
}

export function computeBinariesBaseDir(compilation: CompilationLike) {
  if (process.env.EXTENSIONJS_BINARIES_IN_DIST !== '1') {
    return computeSharedCacheRoot()
  }

  const outputDir = getCompilationOutputPath(compilation)

  if (outputDir) {
    const last = path.basename(outputDir)
    const browserDirs = new Set(['chrome', 'chromium', 'firefox', 'edge'])
    const distRoot = browserDirs.has(last) ? path.dirname(outputDir) : outputDir
    return path.resolve(distRoot, 'extension-js', 'binaries')
  }

  return path.resolve(process.cwd(), 'dist', 'extension-js', 'binaries')
}

export function managedBrowserCacheEnv(
  cacheRoot: string,
  browser:
    | 'chrome'
    | 'chromium'
    | 'firefox'
    | 'edge'
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
): Record<string, string> {
  const root = String(cacheRoot || '').trim()
  if (!root) return {}

  // Safari is built locally via Xcode, not downloaded into a managed cache.
  if (browser === 'safari' || browser === 'webkit-based') return {}

  // Chromium/Gecko forks are located from the user's system, never downloaded
  // into a managed cache, so they have no managed cache directory.
  if (
    browser === 'brave' ||
    browser === 'opera' ||
    browser === 'vivaldi' ||
    browser === 'yandex' ||
    browser === 'waterfox' ||
    browser === 'librewolf'
  ) {
    return {}
  }

  // Managed installs nest as <root>/<browser>/<browser>/<platformOrVersion>/...;
  // Puppeteer cache resolvers expect platform dirs at the base, so point at the nested folder.
  if (browser === 'chrome') {
    return {PUPPETEER_CACHE_DIR: path.join(root, 'chrome', 'chrome')}
  }
  if (browser === 'chromium' || browser === 'chromium-based') {
    return {PUPPETEER_CACHE_DIR: path.join(root, 'chromium', 'chromium')}
  }
  if (
    browser === 'firefox' ||
    browser === 'gecko-based' ||
    browser === 'firefox-based'
  ) {
    return {PUPPETEER_CACHE_DIR: path.join(root, 'firefox', 'firefox')}
  }
  // Edge is installed via Playwright; the installer sets PLAYWRIGHT_BROWSERS_PATH
  // to the managed cache dir for edge.
  return {PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'edge')}
}

export function resolveFromBinaries(
  compilation: CompilationLike,
  browser: 'chrome' | 'chromium' | 'firefox' | 'edge'
) {
  const base = computeBinariesBaseDir(compilation)
  const browserBase = path.join(base, browser)

  if (!fs.existsSync(browserBase)) return null

  // Some installs nest an extra browser segment,
  // e.g., .../chrome/chrome/<platform>
  const scanRoots: string[] = [browserBase]
  const nested = path.join(browserBase, browser)

  if (fs.existsSync(nested)) scanRoots.push(nested)
  // Puppeteer often nests Chromium under "chrome-*" directories; scan that too.
  if (browser === 'chromium') {
    const chromeNested = path.join(browserBase, 'chrome')
    if (fs.existsSync(chromeNested)) scanRoots.push(chromeNested)
  }

  const versionDirPattern = /^(mac|mac_arm|win32|win64|linux)/i
  const versionDirs: string[] = []

  for (const root of scanRoots) {
    try {
      const entries = fs.readdirSync(root, {withFileTypes: true})
      for (const entry of entries) {
        if (entry.isDirectory() && versionDirPattern.test(entry.name)) {
          versionDirs.push(path.join(root, entry.name))
        }
      }
    } catch {
      // Ignore
    }
  }

  // @puppeteer/browsers keeps every previous install beside the new one.
  // readdir order is not version order, so pick the newest build explicitly.
  versionDirs.sort(compareManagedBuildDirsNewestFirst)

  const names = executableNamesFor(browser)

  for (const dir of versionDirs) {
    for (const candidate of buildCandidates(dir, browser)) {
      if (isUsableBinaryPath(candidate)) return candidate
    }

    const found = findExecutableUnder(dir, names, 6)
    if (found) return found
  }

  for (const root of scanRoots) {
    const found = findExecutableUnder(root, names, 6)
    if (found) return found
  }

  return null
}

const MANAGED_BUILD_DIR_PREFIX =
  /^(?:mac_arm|mac-arm|mac|win64|win32|linux64|linux)[-_]/i

export function parseManagedBuildId(dirName: string): number[] {
  const name = String(dirName || '')
  const buildId = name.replace(MANAGED_BUILD_DIR_PREFIX, '')
  return buildId
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
}

export function compareManagedBuildDirNames(a: string, b: string): number {
  const partsA = parseManagedBuildId(a)
  const partsB = parseManagedBuildId(b)
  const length = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < length; i++) {
    const na = partsA[i] ?? 0
    const nb = partsB[i] ?? 0
    if (na !== nb) return na - nb
  }

  return String(a).localeCompare(String(b))
}

function compareManagedBuildDirsNewestFirst(a: string, b: string): number {
  const byBuild = compareManagedBuildDirNames(
    path.basename(b),
    path.basename(a)
  )
  if (byBuild !== 0) return byBuild

  let timeA = 0
  let timeB = 0
  try {
    timeA = fs.statSync(a).mtimeMs
  } catch {
    // Ignore
  }
  try {
    timeB = fs.statSync(b).mtimeMs
  } catch {
    // Ignore
  }

  if (timeA !== timeB) return timeB - timeA
  return path.basename(b).localeCompare(path.basename(a))
}

// When the requested chromium-family browser has no managed install, another
// managed family binary is a working substitute (install-all vs dev-default drift).
export function resolveChromiumFamilyFallback(
  compilation: CompilationLike,
  requested: 'chrome' | 'chromium' = 'chromium'
): {browser: 'chrome' | 'chromium' | 'edge'; binary: string} | null {
  const candidates = (
    requested === 'chrome' ? ['chromium', 'edge'] : ['chrome', 'edge']
  ) as Array<'chrome' | 'chromium' | 'edge'>

  for (const browser of candidates) {
    const binary = resolveFromBinaries(compilation, browser)

    if (binary && fs.existsSync(binary)) {
      return {browser, binary}
    }
  }

  return null
}

function buildCandidates(
  dir: string,
  browser: 'chrome' | 'chromium' | 'firefox' | 'edge'
) {
  const out: string[] = []
  if (browser === 'chrome') {
    if (process.platform === 'darwin') {
      out.push(
        path.join(
          dir,
          'chrome-mac-arm64',
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing'
        ),
        path.join(
          dir,
          'chrome-mac',
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing'
        )
      )
    } else if (process.platform === 'win32') {
      out.push(
        path.join(dir, 'chrome-win64', 'chrome.exe'),
        path.join(dir, 'chrome-win32', 'chrome.exe'),
        path.join(dir, 'chrome.exe')
      )
    } else {
      out.push(
        path.join(dir, 'chrome-linux64', 'chrome'),
        path.join(dir, 'chrome-linux', 'chrome'),
        path.join(dir, 'chrome')
      )
    }
  } else if (browser === 'chromium') {
    if (process.platform === 'darwin') {
      out.push(
        path.join(dir, 'mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(
          dir,
          'mac_arm',
          'Chromium.app',
          'Contents',
          'MacOS',
          'Chromium'
        )
      )
    } else if (process.platform === 'win32') {
      out.push(
        path.join(dir, 'win64', 'chrome.exe'),
        path.join(dir, 'win32', 'chrome.exe'),
        path.join(dir, 'chromium.exe'),
        path.join(dir, 'chrome.exe')
      )
    } else {
      out.push(
        path.join(dir, 'linux', 'chrome'),
        path.join(dir, 'linux64', 'chrome'),
        path.join(dir, 'linux', 'chromium'),
        path.join(dir, 'chromium'),
        path.join(dir, 'chrome')
      )
    }
  } else if (browser === 'edge') {
    if (process.platform === 'darwin') {
      out.push(
        path.join(
          dir,
          'msedge-mac',
          'Microsoft Edge.app',
          'Contents',
          'MacOS',
          'Microsoft Edge'
        ),
        path.join(
          dir,
          'msedge-mac-arm64',
          'Microsoft Edge.app',
          'Contents',
          'MacOS',
          'Microsoft Edge'
        )
      )
    } else if (process.platform === 'win32') {
      out.push(
        path.join(dir, 'msedge-win64', 'msedge.exe'),
        path.join(dir, 'msedge-win32', 'msedge.exe'),
        path.join(dir, 'msedge.exe')
      )
    } else {
      out.push(
        path.join(dir, 'msedge-linux64', 'msedge'),
        path.join(dir, 'msedge-linux', 'msedge'),
        path.join(dir, 'microsoft-edge'),
        path.join(dir, 'msedge')
      )
    }
  } else {
    if (process.platform === 'darwin') {
      out.push(
        path.join(dir, 'Firefox.app', 'Contents', 'MacOS', 'firefox'),
        path.join(dir, 'Firefox Nightly.app', 'Contents', 'MacOS', 'firefox'),
        path.join(
          dir,
          'Firefox Developer Edition.app',
          'Contents',
          'MacOS',
          'firefox'
        )
      )
    } else if (process.platform === 'win32') {
      out.push(path.join(dir, 'firefox.exe'))
    } else {
      out.push(path.join(dir, 'firefox'))
    }
  }
  return out
}

function isUsableBinaryPath(candidate: string): boolean {
  try {
    return Boolean(candidate) && fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function executableNamesFor(
  browser: 'chrome' | 'chromium' | 'firefox' | 'edge'
): string[] {
  if (browser === 'chrome') {
    return process.platform === 'win32'
      ? ['chrome.exe']
      : ['Google Chrome for Testing', 'chrome']
  } else if (browser === 'chromium') {
    return process.platform === 'win32'
      ? ['chromium.exe', 'chrome.exe']
      : ['Chromium', 'chromium', 'chrome']
  } else if (browser === 'edge') {
    // macOS app bundles name the binary 'Microsoft Edge'
    // (Microsoft Edge.app/Contents/MacOS/Microsoft Edge), not msedge.
    return process.platform === 'win32'
      ? ['msedge.exe']
      : ['Microsoft Edge', 'msedge', 'microsoft-edge']
  }
  return process.platform === 'win32' ? ['firefox.exe'] : ['firefox']
}

function findExecutableUnder(
  root: string,
  names: string[],
  maxDepth: number
): string | null {
  try {
    const stack: Array<{dir: string; depth: number}> = [{dir: root, depth: 0}]

    while (stack.length) {
      const {dir, depth} = stack.pop() as {dir: string; depth: number}

      if (depth > maxDepth) continue

      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(dir, {withFileTypes: true})
      } catch {
        continue
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          stack.push({dir: full, depth: depth + 1})
        } else {
          const base = path.basename(full)
          if (names.includes(base)) return full
        }
      }
    }
  } catch {
    // Ignore
  }

  return null
}
