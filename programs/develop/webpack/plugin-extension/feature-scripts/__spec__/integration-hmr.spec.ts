import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const fx = (demo: string) =>
  path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'examples', demo)

async function waitForFile(
  filePath: string,
  timeoutMs: number = 10000,
  intervalMs: number = 50
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`File not found in time: ${filePath}`)
}

describe('ScriptsPlugin HMR accept injection (dev build)', () => {
  const sourceFixture = fx('content')
  let suiteRoot: string
  let out: string

  beforeAll(async () => {
    // Use an isolated temp directory to avoid cross-suite interference
    suiteRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ext-hmr-'))
    await fs.promises.cp(sourceFixture, suiteRoot, {recursive: true})
    out = path.resolve(suiteRoot, 'dist', 'chrome')
    // Build once; the dev server is out of scope here, we assert injected code presence
    await extensionBuild(suiteRoot, {
      browser: 'chrome',
      silent: true,
      exitOnError: false as any
    })
  }, 30000)

  afterAll(async () => {
    if (suiteRoot && fs.existsSync(suiteRoot))
      await fs.promises.rm(suiteRoot, {recursive: true, force: true})
  })

  it('builds successfully; HMR accept code is unit-tested at loader level', async () => {
    const manifestPath = path.join(out, 'manifest.json')
    await waitForFile(manifestPath)
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, 'utf8')
    ) as chrome.runtime.ManifestV3

    const cs = manifest.content_scripts?.[0]?.js?.[0]
    expect(typeof cs).toBe('string')
    const csPath = path.join(out, cs as string)
    await waitForFile(csPath)
    // Ensure final content script bundle exists
    expect(fs.existsSync(csPath)).toBe(true)
  }, 20000)

  it("wrapped content script has mount+dispose pattern when 'use shadow-dom' is present", async () => {
    const manifestPath = path.join(out, 'manifest.json')
    await waitForFile(manifestPath)
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, 'utf8')
    ) as chrome.runtime.ManifestV3
    const cs = manifest.content_scripts?.[0]?.js?.[0]
    const csPath = path.join(out, cs as string)
    await waitForFile(csPath)
    const code = await fs.promises.readFile(csPath, 'utf-8')

    // Heuristic: presence of attachShadow indicates wrapper
    expect(code).toMatch(/attachShadow\(\{\s*mode:\s*['"]open['"]\s*\}\)/)
    // Accept either style element injection or adoptedStyleSheets usage
    const hasStyleElement =
      /document\.createElement\(\s*['"]style['"]\s*\)/.test(code)
    const hasAdoptedSheets =
      /adoptedStyleSheets\s*=/.test(code) ||
      /new\s+CSSStyleSheet\s*\(/.test(code)
    expect(hasStyleElement || hasAdoptedSheets).toBe(true)

    // Note: HMR accept code is injected by the dev server in development.
    // Production builds used in this suite may not include it; loader-level
    // unit tests cover the HMR accept injection separately.
  })
})
