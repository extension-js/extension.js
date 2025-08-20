import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const fx = (demo: string) =>
  path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'examples', demo)

describe('ScriptsPlugin content_scripts with CSS ensure JS bundle exists', () => {
  const fixturesPath = fx('content-css-modules')
  const out = path.resolve(fixturesPath, 'dist', 'chrome')

  beforeAll(async () => {
    await extensionBuild(fixturesPath, {browser: 'chrome'})
  })

  afterAll(async () => {
    if (fs.existsSync(out))
      await fs.promises.rm(out, {recursive: true, force: true})
  })

  it('emits a minimal JS bundle for CSS-only content scripts', async () => {
    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(out, 'manifest.json'), 'utf8')
    ) as chrome.runtime.ManifestV3
    const cs = manifest.content_scripts?.[0]
    expect(cs).toBeTruthy()
    // minimal js should be present even if original was css-only
    expect(Array.isArray(cs!.js)).toBe(true)
    expect(cs!.js!.some((p) => p.endsWith('.js'))).toBe(true)
  })
})
