import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const getFixturesPath = (demoDir: string) => {
  return path.resolve(
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
}

async function waitForFile(
  filePath: string,
  timeoutMs: number = 2000,
  intervalMs: number = 50
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`File not found in time: ${filePath}`)
}

describe('ManifestPlugin (integration)', () => {
  const fixturesPath = getFixturesPath('content')
  const outputPath = path.resolve(fixturesPath, 'dist', 'chrome')

  beforeAll(async () => {
    await extensionBuild(fixturesPath, {browser: 'chrome'})
  })

  afterAll(async () => {
    if (fs.existsSync(outputPath)) {
      await fs.promises.rm(outputPath, {recursive: true, force: true})
    }
  })

  it('emits manifest.json without $schema and patches expected fields', async () => {
    const manifestPath = path.join(outputPath, 'manifest.json')
    await waitForFile(manifestPath)
    const manifestText = await fs.promises.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestText) as chrome.runtime.ManifestV3

    // $schema should be stripped
    expect('$schema' in (manifest as any)).toBe(false)

    // Paths should be normalized/rewritten
    expect(Array.isArray(manifest.content_scripts)).toBe(true)
    const cs = manifest.content_scripts![0]
    expect(Array.isArray(cs.js)).toBe(true)

    // Background service worker path should be patched to output location
    if (manifest.background && 'service_worker' in manifest.background) {
      expect(typeof manifest.background.service_worker).toBe('string')
    }
  })
})
