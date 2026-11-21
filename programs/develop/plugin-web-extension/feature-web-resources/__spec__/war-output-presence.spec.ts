import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {asCompilation} from '../../__spec__/helpers/rspack-fakes'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'

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
    } catch {
      // Ignore
    }
  })

  // The manifest patch over a compilation that emits the given files.
  function patched(
    listed: string,
    options: Record<string, unknown>,
    emitted: Record<string, string> = {}
  ) {
    const manifest = {
      manifest_version: 3,
      web_accessible_resources: [{matches: ['<all_urls>'], resources: [listed]}]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}
    const updateAsset = vi.fn()
    const compilation = {
      getAsset: vi.fn((name: string) => {
        if (name === 'manifest.json') return {name, source: manifestSource}

        return name in emitted
          ? {name, source: {source: () => emitted[name]}}
          : undefined
      }),
      assets: {'manifest.json': manifestSource},
      updateAsset,
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      warnings: [],
      options
    }

    generateManifestPatches(asCompilation(compilation), manifestPath, {})

    const written = updateAsset.mock.calls.at(-1)?.[1]
    const groups = written
      ? JSON.parse(String(written.source())).web_accessible_resources || []
      : []

    return {
      warnings: compilation.warnings as Array<{name: string; file?: string}>,
      resources: groups.flatMap(
        (group: {resources: string[]}) => group.resources
      ) as string[]
    }
  }

  it('does not warn for relative WAR path when file exists in public/', () => {
    const rel = 'pages/oauth-callback.js'

    const publicAbs = path.join(tmpRoot, 'public', rel)
    fs.mkdirSync(path.dirname(publicAbs), {recursive: true})
    fs.writeFileSync(publicAbs, 'console.log("ok")')

    const manifest = {
      manifest_version: 3,
      web_accessible_resources: [{matches: ['<all_urls>'], resources: [rel]}]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}
    const compilation = {
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

    generateManifestPatches(asCompilation(compilation), manifestPath, {})

    expect((compilation as {warnings?: unknown[]}).warnings?.length || 0).toBe(
      0
    )
  })

  // A copy an earlier build left in the output folder is not the file.
  it.each([
    ['development', 'sidebar/index.html'],
    ['production', 'sidebar/index.html'],
    ['production', '/sidebar/index.html']
  ] as const)('warns in %s for %s when only a stale copy sits in the output folder', (mode, listed) => {
    const rel = 'sidebar/index.html'

    const outputAbs = path.join(tmpRoot, 'dist', rel)
    fs.mkdirSync(path.dirname(outputAbs), {recursive: true})
    fs.writeFileSync(outputAbs, '<html></html>')

    const {warnings, resources} = patched(listed, {
      mode,
      output: {path: path.join(tmpRoot, 'dist')}
    })

    expect(warnings.map(({name}) => name)).toEqual(['WARRelativeAssetMissing'])
    expect(warnings[0].file).toBe('manifest.json')
    expect(resources).toEqual([])
  })

  it.each([
    'development',
    'production'
  ] as const)('does not warn in %s for a file this build emits at that path', (mode) => {
    const rel = 'sidebar/index.html'
    const {warnings, resources} = patched(
      rel,
      {mode, output: {path: path.join(tmpRoot, 'dist')}},
      {[rel]: '<html></html>'}
    )

    expect(warnings).toEqual([])
    expect(resources).toEqual([rel])
  })

  it('does not warn when compilation already has the output asset (getAsset returns truthy for the resource)', () => {
    const rel = 'sidebar/index.html'
    const warRef = `/${rel}`

    const manifest = {
      manifest_version: 3,
      web_accessible_resources: [{matches: ['<all_urls>'], resources: [warRef]}]
    }
    const manifestSource = {source: () => JSON.stringify(manifest)}

    const getAsset = vi.fn((name: string) => {
      if (name === rel) {
        return {name, source: {source: () => '<html/>'}}
      }

      if (name === 'manifest.json') {
        return {name, source: manifestSource}
      }

      return undefined
    })

    const compilation = {
      getAsset,
      assets: {'manifest.json': manifestSource},
      updateAsset: vi.fn(),
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      options: {mode: 'development'}
    }

    generateManifestPatches(asCompilation(compilation), manifestPath, {})

    expect((compilation as {warnings?: unknown[]}).warnings?.length || 0).toBe(
      0
    )
  })
})
