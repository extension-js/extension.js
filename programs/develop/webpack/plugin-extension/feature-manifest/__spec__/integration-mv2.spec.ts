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

describe('ManifestPlugin (integration, MV2 via firefox)', () => {
  const fixturesPath = getFixturesPath('sidebar')
  const outputPath = path.resolve(fixturesPath, 'dist', 'firefox')

  beforeAll(async () => {
    await extensionBuild(fixturesPath, {browser: 'firefox'})
  })

  afterAll(async () => {
    if (fs.existsSync(outputPath)) {
      await fs.promises.rm(outputPath, {recursive: true, force: true})
    }
  })

  it('rewrites MV2 fields (background.scripts, browser_action/sidebar_action)', async () => {
    const manifestPath = path.join(outputPath, 'manifest.json')
    const manifestText = await fs.promises.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestText) as chrome.runtime.ManifestV2

    expect(manifest.manifest_version).toBe(2)
    // background.scripts present for MV2 (firefox build)
    expect(Array.isArray((manifest.background as any)?.scripts)).toBe(true)
    // Either browser_action or sidebar_action is expected for this example
    expect(
      (manifest as any).browser_action || (manifest as any).sidebar_action
    ).toBeTruthy()
  })
})
