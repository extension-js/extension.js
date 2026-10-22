import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Asset, Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'

type Group = {matches?: string[]; resources: string[]}

describe('resources a scripts/ entry names', () => {
  let tmpRoot: string
  let manifestPath: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'war-injected-scope-'))
    manifestPath = path.join(tmpRoot, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
    fs.mkdirSync(path.join(tmpRoot, 'pages'))
    fs.writeFileSync(path.join(tmpRoot, 'pages', 'engine.html'), '<html>')
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
  })

  function run(
    entryImports: Record<string, string[]>,
    manifest: Record<string, unknown>,
    mode: 'development' | 'production' = 'production'
  ) {
    const manifestSource = {
      source: () => JSON.stringify(manifest)
    } as Asset['source']
    const manifestAsset = {
      name: 'manifest.json',
      source: manifestSource
    } as unknown as Readonly<Asset>
    const updateAsset = vi.fn()
    const compilation = {
      getAsset: (name?: string) =>
        !name || name === 'manifest.json' ? manifestAsset : undefined,
      assets: {'manifest.json': manifestSource},
      updateAsset,
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      errors: [] as unknown[],
      warnings: [] as Array<{message: string; name: string}>,
      options: {mode, context: tmpRoot}
    }

    generateManifestPatches(
      compilation as unknown as Compilation,
      manifestPath,
      entryImports
    )

    const written = JSON.parse(updateAsset.mock.calls[0][1].source().toString())

    return {
      groups: written.web_accessible_resources as Group[],
      warnings: compilation.warnings.filter(
        (warning) => warning.name === 'InjectedScriptResourceExposedWarning'
      )
    }
  }

  const callSites = ['https://meet.google.com/*', 'https://*.zoom.us/*']

  it('keeps the author scope when a declared group already lists the resource', () => {
    const {groups, warnings} = run(
      {'scripts/bridge': ['pages/engine.html']},
      {
        manifest_version: 3,
        web_accessible_resources: [
          {resources: ['pages/engine.html'], matches: callSites}
        ]
      }
    )

    expect(groups).toEqual([
      {resources: ['pages/engine.html'], matches: [...callSites].sort()}
    ])

    expect(warnings).toEqual([])
  })

  it('keeps the author scope when a declared glob covers the resource', () => {
    const {groups, warnings} = run(
      {'scripts/bridge': ['pages/engine.html']},
      {
        manifest_version: 3,
        web_accessible_resources: [{resources: ['pages/*'], matches: callSites}]
      }
    )

    expect(groups).toEqual([
      {resources: ['pages/*'], matches: [...callSites].sort()}
    ])

    expect(warnings).toEqual([])
  })

  it('exposes only the undeclared resource and names the file and resource', () => {
    const {groups, warnings} = run(
      {'scripts/bridge': ['pages/engine.html', 'assets/frame.svg']},
      {
        manifest_version: 3,
        web_accessible_resources: [
          {resources: ['pages/engine.html'], matches: callSites}
        ]
      }
    )

    expect(groups).toEqual([
      {resources: ['assets/frame.svg'], matches: ['<all_urls>']},
      {resources: ['pages/engine.html'], matches: [...callSites].sort()}
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('scripts/bridge.js')
    expect(warnings[0].message).toContain('assets/frame.svg')
    expect(warnings[0].message).not.toContain('pages/engine.html')
  })

  it('stays quiet in development, where a blanket group covers every file', () => {
    const {groups, warnings} = run(
      {'scripts/bridge': ['assets/frame.svg']},
      {manifest_version: 3},
      'development'
    )

    expect(groups).toEqual([
      {resources: ['assets/frame.svg'], matches: ['<all_urls>']}
    ])

    expect(warnings).toEqual([])
  })

  it('still exposes what a manifest content script names to its own matches', () => {
    const {groups, warnings} = run(
      {'content_scripts/content-0': ['pages/engine.html']},
      {
        manifest_version: 3,
        content_scripts: [
          {
            matches: ['https://example.com/*'],
            js: ['content_scripts/content-0.js']
          }
        ],
        web_accessible_resources: [
          {resources: ['pages/engine.html'], matches: callSites}
        ]
      }
    )

    expect(groups).toEqual([
      {resources: ['pages/engine.html'], matches: [...callSites].sort()},
      {resources: ['pages/engine.html'], matches: ['https://example.com/*']}
    ])

    expect(warnings).toEqual([])
  })
})
