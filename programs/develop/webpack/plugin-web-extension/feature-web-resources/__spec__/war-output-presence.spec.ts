import {Compilation} from '@rspack/core'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {WebResourcesPlugin} from '..'

describe('web_accessible_resources: public-root presence checks', () => {
  let tmpRoot: string
  let manifestPath: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'war-output-'))
    manifestPath = path.join(tmpRoot, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    } catch {}
  })

  it("does not warn when public-root resource exists in output (builtAbs present under 'dist/')", () => {
    const plugin = new WebResourcesPlugin({manifestPath})
    const rel = 'pages/oauth-callback.html'
    const warRef = `/${rel}`

    // Simulate built output file presence: <tmpRoot>/dist/pages/oauth-callback.html
    const outputAbs = path.join(tmpRoot, 'dist', rel)
    fs.mkdirSync(path.dirname(outputAbs), {recursive: true})
    fs.writeFileSync(outputAbs, '<html></html>')

    const manifest = {
      manifest_version: 3,
      web_accessible_resources: [{matches: ['<all_urls>'], resources: [warRef]}]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}
    const compilation: any = {
      getAsset: vi.fn(() => ({
        name: 'manifest.json',
        source: manifestSource
      })),
      assets: {'manifest.json': manifestSource},
      updateAsset: vi.fn(),
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      options: {mode: 'development'}
    }

    plugin['generateManifestPatches'](compilation as Compilation, {})

    // Should not warn since file exists in the output root
    expect(compilation.warnings?.length || 0).toBe(0)
  })

  it('does not warn for relative WAR path when file exists in public/', () => {
    const plugin = new WebResourcesPlugin({manifestPath})
    const rel = 'pages/oauth-callback.js'

    // Simulate public file presence: <tmpRoot>/public/pages/oauth-callback.js
    const publicAbs = path.join(tmpRoot, 'public', rel)
    fs.mkdirSync(path.dirname(publicAbs), {recursive: true})
    fs.writeFileSync(publicAbs, 'console.log("ok")')

    const manifest = {
      manifest_version: 3,
      web_accessible_resources: [{matches: ['<all_urls>'], resources: [rel]}]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}
    const compilation: any = {
      getAsset: vi.fn(() => ({
        name: 'manifest.json',
        source: manifestSource
      })),
      assets: {'manifest.json': manifestSource},
      updateAsset: vi.fn(),
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      options: {mode: 'development'}
    }

    plugin['generateManifestPatches'](compilation as Compilation, {})

    // Should not warn, since the relative resource is backed by a public/ file
    expect(compilation.warnings?.length || 0).toBe(0)
  })

  it('does not warn for relative WAR path when file exists in output root', () => {
    const plugin = new WebResourcesPlugin({manifestPath})
    const rel = 'sidebar/index.html'

    // Simulate built output file presence: <tmpRoot>/dist/sidebar/index.html
    const outputAbs = path.join(tmpRoot, 'dist', rel)
    fs.mkdirSync(path.dirname(outputAbs), {recursive: true})
    fs.writeFileSync(outputAbs, '<html></html>')

    const manifest = {
      manifest_version: 3,
      web_accessible_resources: [{matches: ['<all_urls>'], resources: [rel]}]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}
    const compilation: any = {
      getAsset: vi.fn(() => ({
        name: 'manifest.json',
        source: manifestSource
      })),
      assets: {'manifest.json': manifestSource},
      updateAsset: vi.fn(),
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      options: {
        mode: 'development',
        output: {path: path.join(tmpRoot, 'dist')}
      }
    }

    plugin['generateManifestPatches'](compilation as Compilation, {})

    // Should not warn since the relative resource exists in the built output
    expect(compilation.warnings?.length || 0).toBe(0)
  })

  it('does not warn when compilation already has the output asset (getAsset returns truthy for the resource)', () => {
    const plugin = new WebResourcesPlugin({manifestPath})
    const rel = 'sidebar/index.html'
    const warRef = `/${rel}`

    const manifest = {
      manifest_version: 3,
      web_accessible_resources: [{matches: ['<all_urls>'], resources: [warRef]}]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}

    const getAsset = vi.fn((name: string) => {
      if (name === rel) {
        // Simulate in-memory emitted asset
        return {name, source: {source: () => '<html/>'}}
      }
      if (name === 'manifest.json') {
        return {name, source: manifestSource}
      }
      return undefined
    })

    const compilation: any = {
      getAsset,
      assets: {'manifest.json': manifestSource},
      updateAsset: vi.fn(),
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      options: {mode: 'development'}
    }

    plugin['generateManifestPatches'](compilation as Compilation, {})

    // Should not warn since getAsset(rel) returned an asset
    expect(compilation.warnings?.length || 0).toBe(0)
  })
})
