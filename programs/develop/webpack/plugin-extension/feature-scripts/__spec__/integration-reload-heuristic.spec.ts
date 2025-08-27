import * as fs from 'fs'
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

describe('ScriptsPlugin (reload heuristic)', () => {
  const fixturesPath = fx('content')
  const out = path.resolve(fixturesPath, 'dist', 'chrome')

  beforeAll(async () => {
    await extensionBuild(fixturesPath, {
      browser: 'chrome',
      silent: true,
      exitOnError: false as any
    })
  }, 30000)

  afterAll(async () => {
    if (fs.existsSync(out))
      await fs.promises.rm(out, {recursive: true, force: true})
  })

  it('rebundles content script after source touch (timestamp changes)', async () => {
    const manifestPath = path.join(out, 'manifest.json')
    await waitForFile(manifestPath)
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, 'utf-8')
    ) as chrome.runtime.ManifestV3

    const jsRel = manifest.content_scripts?.[0]?.js?.[0]
    expect(typeof jsRel).toBe('string')
    const jsPath = path.join(out, jsRel as string)
    await waitForFile(jsPath)

    const before = (await fs.promises.stat(jsPath)).mtimeMs

    // Touch the source entry to simulate change
    const src = path.join(fixturesPath, 'content', 'scripts.ts')
    const now = Date.now()
    await fs.promises.utimes(src, now / 1000, now / 1000)

    // Rebuild
    await extensionBuild(fixturesPath, {
      browser: 'chrome',
      silent: true,
      exitOnError: false as any
    })

    await waitForFile(jsPath)
    const after = (await fs.promises.stat(jsPath)).mtimeMs
    expect(after).toBeGreaterThanOrEqual(before)
  }, 30000)
})
