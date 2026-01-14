// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import type {Compilation} from '@rspack/core'

function computeSharedCacheRoot(): string {
  // Highest priority: explicit override
  const explicit = String(process.env.EXT_BROWSERS_CACHE_DIR || '').trim()
  if (explicit) return path.resolve(explicit)

  // Respect XDG cache on Linux
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
    // Fallback to cwd if envs are missing (rare)
    return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
  }

  if (isMac) {
    const home = String(process.env.HOME || '').trim()

    if (home) {
      return path.join(home, 'Library', 'Caches', 'extension.js', 'browsers')
    }

    return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
  }

  // Linux / others
  const xdg = String(process.env.XDG_CACHE_HOME || '').trim()

  if (xdg) return path.join(xdg, 'extension.js', 'browsers')

  const home = String(process.env.HOME || '').trim()

  if (home) {
    return path.join(home, '.cache', 'extension.js', 'browsers')
  }

  return path.resolve(process.cwd(), '.cache', 'extension.js', 'browsers')
}

export function getCompilationOutputPath(compilation: Compilation): string {
  try {
    return (
      compilation.options?.output?.path || compilation.outputOptions?.path || ''
    )
  } catch {
    return ''
  }
}

export function computeBinariesBaseDir(compilation: Compilation) {
  // New default: per-user shared cache
  if (process.env.EXTENSIONJS_BINARIES_IN_DIST !== '1') {
    return computeSharedCacheRoot()
  }

  // Legacy fallback: project dist
  const outputDir = getCompilationOutputPath(compilation)

  if (outputDir) {
    const last = path.basename(outputDir)
    const browserDirs = new Set(['chrome', 'chromium', 'firefox', 'edge'])
    const distRoot = browserDirs.has(last) ? path.dirname(outputDir) : outputDir
    return path.resolve(distRoot, 'extension-js', 'binaries')
  }

  return path.resolve(process.cwd(), 'dist', 'extension-js', 'binaries')
}

export function resolveFromBinaries(
  compilation: Compilation,
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
  const candidateFiles: string[] = []

  for (const root of scanRoots) {
    try {
      const entries = fs.readdirSync(root, {withFileTypes: true})
      const versionDirs = entries
        .filter(
          (entry) => entry.isDirectory() && versionDirPattern.test(entry.name)
        )
        .map((entry) => path.join(root, entry.name))

      for (const dir of versionDirs) {
        candidateFiles.push(...buildCandidates(dir, browser))
      }
    } catch {
      // Ignore
    }
  }

  let matched = false
  for (const candidate of candidateFiles) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        matched = true
        return candidate
      }
    } catch {
      // Ignore
    }
  }

  // If no candidate paths matched, do a shallow recursive search up to depth 6
  if (!matched) {
    const names = executableNamesFor(browser)
    for (const root of scanRoots) {
      const found = findExecutableUnder(root, names, 6)
      if (found) return found
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
    // firefox
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
    return process.platform === 'win32'
      ? ['msedge.exe']
      : ['msedge', 'microsoft-edge']
  }
  // firefox
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
