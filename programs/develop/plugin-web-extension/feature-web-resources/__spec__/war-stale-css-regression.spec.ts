import {Compilation} from '@rspack/core'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'

// Regression for the 3.14 → 3.15 content-script CSS WAR gap. Dev mode runs
// with `output.clean: false`, so prior compilations leave hashed CSS chunks
// like `content_scripts/content-index.<hash>.css` behind in the output
// directory. Open tabs whose pre-rebuild content script's `import.meta.url`
// fetch resolves to a leftover chunk would otherwise hit a 403 because only
// the current compile's CSS made it into web_accessible_resources.
describe('web_accessible_resources: stale on-disk content-script CSS', () => {
  let tmpRoot: string
  let outputPath: string
  let csDir: string
  let manifestPath: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'war-stale-'))
    outputPath = path.join(tmpRoot, 'dist', 'chromium')
    csDir = path.join(outputPath, 'content_scripts')
    fs.mkdirSync(csDir, {recursive: true})
    manifestPath = path.join(tmpRoot, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    } catch {}
  })

  it('WAR-lists leftover content_scripts/*.css that exists on disk but not in compilation.assets', () => {
    const stale = 'content_scripts/content-index.aaaaaaaa.css'
    const fresh = 'content_scripts/content-index.bbbbbbbb.css'
    fs.writeFileSync(path.join(outputPath, stale), '/* stale */')
    fs.writeFileSync(path.join(outputPath, fresh), '/* fresh */')

    const manifest = {
      manifest_version: 3,
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-0.js']
        }
      ]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}
    const updateAsset = vi.fn()
    const compilation: any = {
      getAsset: vi.fn(() => ({name: 'manifest.json', source: manifestSource})),
      assets: {
        'manifest.json': manifestSource,
        [fresh]: {source: () => '/* fresh */'}
      },
      updateAsset,
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      options: {mode: 'development', output: {path: outputPath}}
    }

    generateManifestPatches(compilation as Compilation, manifestPath, {})

    const patched = JSON.parse(updateAsset.mock.calls[0][1].source().toString())
    const allWarResources = (patched.web_accessible_resources || []).flatMap(
      (group: {resources: string[]}) => group.resources
    )
    expect(allWarResources).toContain(stale)
    expect(allWarResources).toContain(fresh)
  })
})
