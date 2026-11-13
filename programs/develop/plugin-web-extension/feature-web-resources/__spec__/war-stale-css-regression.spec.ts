import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'

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
    } catch {
      // Ignore
    }
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

  // The browser applies a dev probe sheet from its registration. No page
  // fetches it, so neither an emitted one nor one left on disk is listed.
  it('lists no dev probe sheet, emitted or left on disk', () => {
    const own = 'content_scripts/content-0.css'
    const emittedProbe = 'content_scripts/dev-sheet-0.css'
    const leftProbe = 'content_scripts/dev-sheet-1.css'

    for (const name of [own, emittedProbe, leftProbe]) {
      fs.writeFileSync(path.join(outputPath, name), '/* css */')
    }

    const manifest = {
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/dev-stub-0.js']}
      ]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}
    const updateAsset = vi.fn()
    const compilation: any = {
      getAsset: vi.fn(() => ({name: 'manifest.json', source: manifestSource})),
      assets: {
        'manifest.json': manifestSource,
        [own]: {source: () => '/* css */'},
        [emittedProbe]: {source: () => ':root{--extjs-dev-sheet-0:1}'}
      },
      updateAsset,
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      options: {mode: 'development', output: {path: outputPath}}
    }

    generateManifestPatches(compilation as Compilation, manifestPath, {})

    const patched = JSON.parse(updateAsset.mock.calls[0][1].source().toString())
    const listed = (patched.web_accessible_resources || []).flatMap(
      (group: {resources: string[]}) => group.resources
    )

    expect(listed).toEqual([own])
  })
})
