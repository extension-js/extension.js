import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../build'

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

describe('WebResourcesPlugin (integration)', () => {
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

  it('adds imported content script assets to web_accessible_resources (mv3)', async () => {
    const manifestPath = path.join(outputPath, 'manifest.json')
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
