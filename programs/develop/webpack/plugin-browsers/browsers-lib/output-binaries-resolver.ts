import * as fs from 'fs'
import * as path from 'path'
import type {Compilation} from '@rspack/core'

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
  const outputDir = getCompilationOutputPath(compilation)

  if (outputDir) {
    const last = path.basename(outputDir)
    const browserDirs = new Set(['chrome', 'firefox', 'edge'])
    const distRoot = browserDirs.has(last) ? path.dirname(outputDir) : outputDir
    return path.resolve(distRoot, 'extension-js', 'binaries')
  }

  return path.resolve(process.cwd(), 'dist', 'extension-js', 'binaries')
}

export function resolveFromBinaries(
  compilation: Compilation,
  browser: 'chrome' | 'firefox'
) {
  const base = computeBinariesBaseDir(compilation)
  const browserBase = path.join(base, browser)

  if (!fs.existsSync(browserBase)) return null

  // Some installs nest an extra browser segment,
  // e.g., .../chrome/chrome/<platform>
  const scanRoots: string[] = [browserBase]
  const nested = path.join(browserBase, browser)

  if (fs.existsSync(nested)) scanRoots.push(nested)

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

  // As a last resort, do a shallow recursive search up to depth 6 for well-known executable names
  if (candidateFiles.length === 0) {
    const names = executableNamesFor(browser)
    for (const root of scanRoots) {
      const found = findExecutableUnder(root, names, 6)
      if (found) return found
    }
  }

  for (const candidate of candidateFiles) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate
    } catch {
      // Ignore
    }
  }
  return null
}

function buildCandidates(dir: string, browser: 'chrome' | 'firefox') {
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

function executableNamesFor(browser: 'chrome' | 'firefox'): string[] {
  if (browser === 'chrome') {
    return process.platform === 'win32'
      ? ['chrome.exe']
      : ['Google Chrome for Testing', 'chrome']
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
