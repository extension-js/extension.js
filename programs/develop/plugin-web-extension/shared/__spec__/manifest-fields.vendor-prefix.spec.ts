import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {getResolvedManifestFieldsData} from '../manifest-fields'

const roots: string[] = []

function makeProject(manifest: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-vendor-fields-'))
  roots.push(root)
  const dir = path.join(root, 'src')
  fs.mkdirSync(path.join(dir, '_locales', 'en'), {recursive: true})
  fs.writeFileSync(path.join(dir, '_locales', 'en', 'messages.json'), '{}')
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))
  return {dir, manifestPath}
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

// Entry discovery must follow the vendor-exact rule, or an edge build would
// compile the Chrome worker as its entry.
describe('getResolvedManifestFieldsData with vendor-exact prefixes', () => {
  const manifest = {
    manifest_version: 3,
    name: 'x',
    version: '1.0.0',
    'chromium:background': {service_worker: 'family-sw.js'},
    'chrome:background': {service_worker: 'chrome-sw.js'},
    'chrome:action': {default_popup: 'chrome-popup.html'},
    'chromium:content_scripts': [
      {matches: ['<all_urls>'], js: ['../shared/content.js']}
    ]
  }

  it('discovers the entries the emitted manifest keeps for edge', () => {
    const {dir, manifestPath} = makeProject(manifest)
    const data = getResolvedManifestFieldsData({manifestPath, browser: 'edge'})
    const serialized = JSON.stringify(data)

    expect(data.scripts['background/service_worker']).toBe(
      path.join(dir, 'family-sw.js')
    )
    expect(serialized).not.toContain('chrome-sw.js')
    expect(serialized).not.toContain('chrome-popup.html')
    // A path that leaves the manifest folder rebases onto the real project.
    expect(serialized).toContain(
      JSON.stringify(path.join(dir, '..', 'shared', 'content.js'))
    )
    expect(serialized).not.toContain('extension-js-manifest-fields-')
    expect(data.locales).toEqual([
      path.join(dir, '_locales', 'en', 'messages.json')
    ])
  })

  it('keeps the chrome: entries for a chrome build', () => {
    const {dir, manifestPath} = makeProject(manifest)
    const data = getResolvedManifestFieldsData({
      manifestPath,
      browser: 'chrome'
    })

    expect(data.scripts['background/service_worker']).toBe(
      path.join(dir, 'chrome-sw.js')
    )
    expect(JSON.stringify(data)).toContain(
      JSON.stringify(path.join(dir, 'chrome-popup.html'))
    )
  })
})
