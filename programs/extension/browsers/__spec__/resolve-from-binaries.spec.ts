import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  compareManagedBuildDirNames,
  resolveFromBinaries
} from '../browsers-lib/output-binaries-resolver'

const compilation = {} as any

const isWin = process.platform === 'win32'
const platformPrefix =
  process.platform === 'win32'
    ? 'win64'
    : process.platform === 'darwin'
      ? 'mac_arm'
      : 'linux'

const chromeExecutable = isWin ? 'chrome.exe' : 'chrome'
const chromiumExecutable = isWin ? 'chromium.exe' : 'chromium'
const edgeExecutable = isWin ? 'msedge.exe' : 'msedge'
const firefoxExecutable = isWin ? 'firefox.exe' : 'firefox'

let cacheRoot: string
let previousCacheDir: string | undefined

function writeExecutable(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, '')
}

function installBuild(
  browser: 'chrome' | 'chromium' | 'firefox' | 'edge',
  buildId: string,
  executable: string
) {
  const dir = path.join(
    cacheRoot,
    browser,
    browser,
    `${platformPrefix}-${buildId}`
  )
  writeExecutable(path.join(dir, 'unpacked', executable))
  return dir
}

function installChromeCandidate(buildId: string) {
  const dir = path.join(
    cacheRoot,
    'chrome',
    'chrome',
    `${platformPrefix}-${buildId}`
  )
  if (isWin) {
    writeExecutable(path.join(dir, 'chrome-win64', 'chrome.exe'))
  } else if (process.platform === 'darwin') {
    writeExecutable(
      path.join(
        dir,
        'chrome-mac-arm64',
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing'
      )
    )
  } else {
    writeExecutable(path.join(dir, 'chrome-linux64', 'chrome'))
  }
  return dir
}

beforeEach(() => {
  cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-browsers-cache-'))
  previousCacheDir = process.env.EXT_BROWSERS_CACHE_DIR
  process.env.EXT_BROWSERS_CACHE_DIR = cacheRoot
})

afterEach(() => {
  if (previousCacheDir === undefined) {
    delete process.env.EXT_BROWSERS_CACHE_DIR
  } else {
    process.env.EXT_BROWSERS_CACHE_DIR = previousCacheDir
  }
  fs.rmSync(cacheRoot, {recursive: true, force: true})
})

describe('compareManagedBuildDirNames', () => {
  it('orders Chrome for Testing versions numerically, not lexicographically', () => {
    expect(
      compareManagedBuildDirNames(
        `${platformPrefix}-99.0.0.0`,
        `${platformPrefix}-140.0.7259.2`
      )
    ).toBeLessThan(0)
    expect(
      compareManagedBuildDirNames(
        `${platformPrefix}-140.0.7259.2`,
        `${platformPrefix}-120.0.6099.109`
      )
    ).toBeGreaterThan(0)
  })

  it('orders Chromium snapshot revisions numerically', () => {
    expect(
      compareManagedBuildDirNames(
        `${platformPrefix}-999999`,
        `${platformPrefix}-1361497`
      )
    ).toBeLessThan(0)
  })
})

describe('resolveFromBinaries', () => {
  it('picks the newest Chrome build from a cache holding several installs', () => {
    installBuild('chrome', '140.0.7259.2', chromeExecutable)
    installBuild('chrome', '99.0.0.0', chromeExecutable)
    installBuild('chrome', '120.0.6099.109', chromeExecutable)

    const binary = resolveFromBinaries(compilation, 'chrome')

    expect(binary).toContain(`${platformPrefix}-140.0.7259.2`)
    expect(fs.existsSync(String(binary))).toBe(true)
  })

  it('picks the newest Chromium snapshot from a cache holding several installs', () => {
    installBuild('chromium', '1361497', chromiumExecutable)
    installBuild('chromium', '999999', chromiumExecutable)
    installBuild('chromium', '1200000', chromiumExecutable)

    const binary = resolveFromBinaries(compilation, 'chromium')

    expect(binary).toContain(`${platformPrefix}-1361497`)
    expect(fs.existsSync(String(binary))).toBe(true)
  })

  it('picks the newest Firefox build from a cache holding several installs', () => {
    installBuild('firefox', '140.0', firefoxExecutable)
    installBuild('firefox', '99.0', firefoxExecutable)
    installBuild('firefox', '120.0.1', firefoxExecutable)

    const binary = resolveFromBinaries(compilation, 'firefox')

    expect(binary).toContain(`${platformPrefix}-140.0`)
    expect(fs.existsSync(String(binary))).toBe(true)
  })

  it('picks the newest Edge build from a cache holding several installs', () => {
    installBuild('edge', '140.0.7259.2', edgeExecutable)
    installBuild('edge', '99.0.0.0', edgeExecutable)
    installBuild('edge', '120.0.6099.109', edgeExecutable)

    const binary = resolveFromBinaries(compilation, 'edge')

    expect(binary).toContain(`${platformPrefix}-140.0.7259.2`)
    expect(fs.existsSync(String(binary))).toBe(true)
  })

  it('finds the macOS Edge app-bundle binary named Microsoft Edge', () => {
    if (process.platform !== 'darwin') return
    const dir = path.join(
      cacheRoot,
      'edge',
      'edge',
      `${platformPrefix}-141.0.0.0`
    )
    writeExecutable(
      path.join(
        dir,
        'Microsoft Edge.app',
        'Contents',
        'MacOS',
        'Microsoft Edge'
      )
    )

    const binary = resolveFromBinaries(compilation, 'edge')

    expect(String(binary)).toContain('Microsoft Edge')
    expect(fs.existsSync(String(binary))).toBe(true)
  })

  it('picks the newest Chrome for Testing candidate path, not the first readdir hit', () => {
    installChromeCandidate('99.0.0.0')
    installChromeCandidate('140.0.7259.2')
    installChromeCandidate('120.0.6099.109')

    const binary = resolveFromBinaries(compilation, 'chrome')

    expect(binary).toContain(`${platformPrefix}-140.0.7259.2`)
    expect(fs.existsSync(String(binary))).toBe(true)
  })

  it('skips a newer build folder that has no executable yet', () => {
    installBuild('chrome', '120.0.6099.109', chromeExecutable)
    fs.mkdirSync(
      path.join(
        cacheRoot,
        'chrome',
        'chrome',
        `${platformPrefix}-140.0.7259.2`
      ),
      {recursive: true}
    )

    const binary = resolveFromBinaries(compilation, 'chrome')

    expect(binary).toContain(`${platformPrefix}-120.0.6099.109`)
  })
})
