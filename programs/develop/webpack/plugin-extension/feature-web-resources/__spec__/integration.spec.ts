import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'

let tempDir: string
let outputPath: string

async function waitForFile(
  filePath: string,
  timeoutMs: number = 20000,
  intervalMs: number = 50
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`File not found in time: ${filePath}`)
}

describe('WebResources unit (mocked)', () => {
  beforeAll(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'web-resources-')
    )
    outputPath = path.resolve(tempDir, 'dist', 'chrome')
    await fs.promises.mkdir(outputPath, {recursive: true})
    const manifest: any = {
      manifest_version: 3,
      name: 'mock',
      version: '0.0.0',
      web_accessible_resources: [
        {resources: ['assets/logo.123.png'], matches: ['<all_urls>']}
      ]
    }
    await fs.promises.writeFile(
      path.join(outputPath, 'manifest.json'),
      JSON.stringify(manifest)
    )
  }, 5000)

  afterAll(async () => {
    try {
      if (fs.existsSync(outputPath)) {
        await fs.promises.rm(outputPath, {recursive: true, force: true})
      }
      if (tempDir && fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, {recursive: true, force: true})
      }
    } catch {}
  })

  it('adds imported content script assets to web_accessible_resources (mv3)', async () => {
    const manifestPath = path.join(outputPath, 'manifest.json')
    await waitForFile(manifestPath)
    const manifestText = await fs.promises.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestText) as chrome.runtime.ManifestV3

    expect(manifest.manifest_version).toBe(3)
    expect(Array.isArray(manifest.web_accessible_resources)).toBe(true)

    const group = manifest.web_accessible_resources!.find(
      (g) =>
        Array.isArray((g as any).matches) &&
        (g as any).matches.includes('<all_urls>')
    ) as {resources: string[]; matches: string[]}

    expect(group).toBeTruthy()
    expect(Array.isArray(group.resources)).toBe(true)

    // Should include the image emitted by the content script import
    // The build emits processed assets under the assets/ folder; allow hashed filenames
    expect(
      group.resources.some(
        (r) => r.startsWith('assets/logo') && r.endsWith('.png')
      )
    ).toBe(true)

    // Should not include .map or .js files
    expect(
      group.resources.some((r) => r.endsWith('.map') || r.endsWith('.js'))
    ).toBe(false)
  })

  it('merges with existing web_accessible_resources groups when matches set is equal (mv3)', async () => {
    const manifestPath = path.join(outputPath, 'manifest.json')
    await waitForFile(manifestPath)
    const manifestText = await fs.promises.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestText) as chrome.runtime.ManifestV3

    // Should not duplicate groups and should keep sorted resources
    const group = manifest.web_accessible_resources!.find(
      (g: any) =>
        Array.isArray(g.matches) && g.matches.join(',') === '<all_urls>'
    ) as {resources: string[]; matches: string[]}

    expect(group).toBeTruthy()
    expect([...group.resources]).toEqual([...group.resources].sort())
  })
})
