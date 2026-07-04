import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {resolveChromiumFamilyFallback} from '../browsers-lib/output-binaries-resolver'

const compilation = {} as any

const isWin = process.platform === 'win32'
const platformDir = isWin
  ? 'win64-140.0.7259.2'
  : process.platform === 'darwin'
    ? 'mac_arm-140.0.7259.2'
    : 'linux-140.0.7259.2'
const chromeExecutable = isWin ? 'chrome.exe' : 'chrome'
const edgeExecutable = isWin ? 'msedge.exe' : 'msedge'

let cacheRoot: string
let previousCacheDir: string | undefined

// Mirrors the managed layout `extension install` produces via
// `@puppeteer/browsers install --path <root>/<browser>`:
// <root>/<browser>/<browser>/<platform>-<buildId>/<archive>/<executable>
function installFakeBrowser(browser: 'chrome' | 'edge', executable: string) {
  const dir = path.join(cacheRoot, browser, browser, platformDir, 'unpacked')
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(path.join(dir, executable), '')
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

describe('resolveChromiumFamilyFallback', () => {
  it('returns null when the managed cache has no chromium-family browser', () => {
    expect(resolveChromiumFamilyFallback(compilation)).toBeNull()
  })

  it('falls back to a managed Chrome when Chromium is absent (install all + dev)', () => {
    installFakeBrowser('chrome', chromeExecutable)

    const result = resolveChromiumFamilyFallback(compilation)

    expect(result?.browser).toBe('chrome')
    expect(result?.binary).toContain(cacheRoot)
    expect(fs.existsSync(String(result?.binary))).toBe(true)
  })

  it('falls back to a managed Edge when it is the only family binary', () => {
    installFakeBrowser('edge', edgeExecutable)

    const result = resolveChromiumFamilyFallback(compilation)

    expect(result?.browser).toBe('edge')
    expect(fs.existsSync(String(result?.binary))).toBe(true)
  })

  it('prefers Chrome over Edge when both are installed', () => {
    installFakeBrowser('chrome', chromeExecutable)
    installFakeBrowser('edge', edgeExecutable)

    expect(resolveChromiumFamilyFallback(compilation)?.browser).toBe('chrome')
  })
})
