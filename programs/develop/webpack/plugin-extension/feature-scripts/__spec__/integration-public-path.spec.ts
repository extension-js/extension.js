import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const fx = (demo: string) =>
  path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'examples', demo)

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

describe('ScriptsPlugin publicPath runtime (production)', () => {
  const fixturesPath = fx('content')
  const out = path.resolve(fixturesPath, 'dist', 'chrome')

  beforeAll(async () => {
    await extensionBuild(fixturesPath, {browser: 'chrome'})
  })

  afterAll(async () => {
    if (fs.existsSync(out))
      await fs.promises.rm(out, {recursive: true, force: true})
  })

  it('injects runtime code that resolves publicPath via runtime.getURL()', async () => {
    const manifestPath = path.join(out, 'manifest.json')
    await waitForFile(manifestPath)
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, 'utf8')
    ) as chrome.runtime.ManifestV3
    const cs = manifest.content_scripts?.[0]?.js?.[0]
    expect(typeof cs).toBe('string')
    const csPath = path.join(out, cs as string)
    await waitForFile(csPath)
    const js = await fs.promises.readFile(csPath, 'utf8')

    // Heuristic: publicPath runtime uses runtime.getURL or importScripts branch
    expect(js.includes('runtime.getURL') || js.includes('importScripts(')).toBe(
      true
    )
  })
})
