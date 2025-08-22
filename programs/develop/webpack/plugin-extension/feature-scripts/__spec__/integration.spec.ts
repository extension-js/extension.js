import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const getFixturesPath = (demoDir: string) =>
  path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'examples',
    demoDir
  )

describe('ScriptsPlugin (integration)', () => {
  const fixturesPath = getFixturesPath('content')
  const outputPath = path.resolve(fixturesPath, 'dist', 'chrome')

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

  beforeAll(async () => {
    await extensionBuild(fixturesPath, {browser: 'chrome'})
  })

  afterAll(async () => {
    if (fs.existsSync(outputPath)) {
      await fs.promises.rm(outputPath, {recursive: true, force: true})
    }
  })

  it('emits content script and background entries and wires CSS/assets', async () => {
    const manifestPath = path.join(outputPath, 'manifest.json')
    await waitForFile(manifestPath)
    const manifestText = await fs.promises.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestText) as chrome.runtime.ManifestV3

    // content_scripts present and points to emitted bundle
    expect(Array.isArray(manifest.content_scripts)).toBe(true)
    const content0 = manifest.content_scripts![0]
    expect(Array.isArray(content0.js)).toBe(true)
    expect(content0.js!.some((p) => p.endsWith('.js'))).toBe(true)

    // background worker (mv3) present when defined
    if (manifest.background?.service_worker) {
      expect(typeof manifest.background.service_worker).toBe('string')
    }

    // referenced asset imported by content script is present in output
    const assetsDir = path.join(outputPath, 'assets')
    const hasAnyAsset = fs.existsSync(assetsDir)
      ? (await fs.promises.readdir(assetsDir)).length > 0
      : false
    expect(hasAnyAsset).toBe(true)
  })
})
