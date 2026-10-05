import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {getResolvedManifestFieldsData} from '../manifest-fields'

const roots: string[] = []

function makeProject(manifest: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-mistyped-fields-'))
  roots.push(root)
  const manifestPath = path.join(root, 'manifest.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      ...manifest
    })
  )

  return manifestPath
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

describe('getResolvedManifestFieldsData with mistyped list fields', () => {
  it('returns an empty view instead of throwing for content_scripts as an object', () => {
    const manifestPath = makeProject({
      content_scripts: {matches: ['<all_urls>'], js: ['content.js']}
    })

    const data = getResolvedManifestFieldsData({
      manifestPath,
      browser: 'chrome'
    })

    expect(Object.values(data.scripts).filter(Boolean)).toEqual([])
    expect(Object.values(data.html).filter(Boolean)).toEqual([])
  })

  it('returns an empty view instead of throwing for sandbox.pages as a string', () => {
    const manifestPath = makeProject({sandbox: {pages: 'sandbox.html'}})

    expect(() =>
      getResolvedManifestFieldsData({manifestPath, browser: 'chrome'})
    ).not.toThrow()
  })

  it('keeps the full view for a well-typed manifest', () => {
    const manifestPath = makeProject({
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })

    const data = getResolvedManifestFieldsData({
      manifestPath,
      browser: 'chrome'
    })

    expect(data.scripts['content_scripts/content-0']).toEqual([
      path.join(path.dirname(manifestPath), 'content.js')
    ])
  })
})
