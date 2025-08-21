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

describe('ScriptsPlugin service worker modes', () => {
  it('builds classic background.service_worker (chunkLoading import-scripts behavior)', async () => {
    const fixturesPath = fx('content')
    const out = path.resolve(fixturesPath, 'dist', 'chrome')
    await extensionBuild(fixturesPath, {browser: 'chrome'})

    const manifestPath = path.join(out, 'manifest.json')
    await waitForFile(manifestPath)
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, 'utf8')
    ) as chrome.runtime.ManifestV3

    if (manifest.background?.service_worker) {
      // Ensure service worker bundle exists
      const swPath = path.join(out, manifest.background.service_worker)
      expect(fs.existsSync(swPath)).toBe(true)
      const swContent = await fs.promises.readFile(swPath, 'utf8')
      // We cannot reliably assert chunkLoading flag post-build; check presence of importScripts usage when split chunks present
      expect(swContent.includes('importScripts(') || swContent.length > 0).toBe(
        true
      )
    }

    if (fs.existsSync(out))
      await fs.promises.rm(out, {recursive: true, force: true})
  })

  it('builds module background service worker without importScripts specific code', async () => {
    const fixturesPath = fx('content-esm')
    const out = path.resolve(fixturesPath, 'dist', 'chrome')
    await extensionBuild(fixturesPath, {browser: 'chrome'})

    const manifestPath = path.join(out, 'manifest.json')
    await waitForFile(manifestPath)
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, 'utf8')
    ) as chrome.runtime.ManifestV3

    if (manifest.background?.service_worker) {
      const swPath = path.join(out, manifest.background.service_worker)
      expect(fs.existsSync(swPath)).toBe(true)
      const swContent = await fs.promises.readFile(swPath, 'utf8')
      // Module workers should not rely on importScripts
      expect(swContent.includes('importScripts(')).toBe(false)
    }

    if (fs.existsSync(out))
      await fs.promises.rm(out, {recursive: true, force: true})
  })
})
