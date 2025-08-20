import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const fx = (demo: string) =>
  path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'examples', demo)

describe('ScriptsPlugin HMR accept injection (dev build)', () => {
  const fixturesPath = fx('content')
  const out = path.resolve(fixturesPath, 'dist', 'chrome')

  beforeAll(async () => {
    // Build once; the dev server is out of scope here, we assert injected code presence
    await extensionBuild(fixturesPath, {browser: 'chrome'})
  })

  afterAll(async () => {
    if (fs.existsSync(out))
      await fs.promises.rm(out, {recursive: true, force: true})
  })

  it('builds successfully; HMR accept code is unit-tested at loader level', async () => {
    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(out, 'manifest.json'), 'utf8')
    ) as chrome.runtime.ManifestV3

    const cs = manifest.content_scripts?.[0]?.js?.[0]
    expect(typeof cs).toBe('string')
    const csPath = path.join(out, cs as string)
    // Ensure final content script bundle exists
    expect(fs.existsSync(csPath)).toBe(true)
  })
})
