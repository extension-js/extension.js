import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Asset, Compilation} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {noteInjectedSheetTarget} from '../../feature-scripts/scripts-lib/injected-sheet-urls'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'

type Group = {matches?: string[]; resources: string[]}

describe('files a sheet injected by file loads', () => {
  let tmpRoot: string
  let manifestPath: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'war-injected-sheet-'))
    manifestPath = path.join(tmpRoot, 'manifest.json')
    fs.writeFileSync(manifestPath, '{}')
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
  })

  // The sheet names a font and an image the build shipped, and one file
  // that is not in the output.
  function run(
    manifest: Record<string, unknown>,
    mode: 'development' | 'production' = 'production',
    browser?: string
  ) {
    const manifestSource = {
      source: () => JSON.stringify(manifest)
    } as Asset['source']
    const manifestAsset = {
      name: 'manifest.json',
      source: manifestSource
    } as unknown as Readonly<Asset>
    const file = {source: () => 'bytes'} as Asset['source']
    const updateAsset = vi.fn()
    const compilation = {
      getAsset: (name?: string) =>
        !name || name === 'manifest.json' ? manifestAsset : undefined,
      assets: {
        'manifest.json': manifestSource,
        'styles/inject.css': file,
        'fonts/a.woff2': file,
        'styles/img/bg.png': file
      },
      updateAsset,
      emitAsset: vi.fn(),
      fileDependencies: new Set(),
      errors: [] as unknown[],
      warnings: [] as Array<{message: string; name: string}>,
      options: {mode, context: tmpRoot}
    }

    for (const target of ['fonts/a.woff2', 'styles/img/bg.png', 'gone.png']) {
      noteInjectedSheetTarget(compilation, 'styles/inject.css', target)
    }

    generateManifestPatches(
      compilation as unknown as Compilation,
      manifestPath,
      {},
      browser
    )

    const written = JSON.parse(updateAsset.mock.calls[0][1].source().toString())

    return {
      resources: written.web_accessible_resources as
        | Group[]
        | string[]
        | undefined,
      warnings: compilation.warnings.filter(
        (warning) => warning.name === 'InjectedScriptResourceExposedWarning'
      )
    }
  }

  it('lists them for every page, the group a scripts/ file gets, and says so', () => {
    const {resources, warnings} = run({manifest_version: 3})

    expect(resources).toEqual([
      {
        resources: ['fonts/a.woff2', 'styles/img/bg.png'],
        matches: ['<all_urls>']
      }
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('styles/inject.css')
    expect(warnings[0].message).not.toContain('styles/inject.css.js')
    expect(warnings[0].message).toContain('fonts/a.woff2')
    expect(warnings[0].message).toContain('the sheet is injected on')
    expect(warnings[0].message).not.toContain('gone.png')
  })

  it('keeps the scope the author gave a file and adds only the rest', () => {
    const sites = ['https://example.com/*']
    const {resources, warnings} = run({
      manifest_version: 3,
      web_accessible_resources: [{resources: ['fonts/*'], matches: sites}]
    })

    expect(resources).toEqual([
      {resources: ['styles/img/bg.png'], matches: ['<all_urls>']},
      {resources: ['fonts/*'], matches: sites}
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).not.toContain('fonts/a.woff2')
  })

  it('appends them to the plain list of a Manifest V2 extension', () => {
    const {resources, warnings} = run({manifest_version: 2})

    expect(resources).toEqual(['fonts/a.woff2', 'styles/img/bg.png'])
    expect(warnings).toEqual([])
  })

  it('stays quiet in development, where a blanket group covers every file', () => {
    expect(run({manifest_version: 3}, 'development').warnings).toEqual([])
  })

  it.each([
    'chrome',
    'edge',
    'chromium-based',
    'safari',
    'webkit-based'
  ])('lists them for %s', (browser) => {
    const {resources, warnings} = run(
      {manifest_version: 3},
      'production',
      browser
    )

    expect(resources).toEqual([
      {
        resources: ['fonts/a.woff2', 'styles/img/bg.png'],
        matches: ['<all_urls>']
      }
    ])

    expect(warnings).toHaveLength(1)
  })

  it.each([
    'firefox',
    'gecko-based'
  ])('lists only the font for %s, which loads an image unlisted', (browser) => {
    const {resources, warnings} = run(
      {manifest_version: 3},
      'production',
      browser
    )

    expect(resources).toEqual([
      {resources: ['fonts/a.woff2'], matches: ['<all_urls>']}
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('fonts/a.woff2')
    expect(warnings[0].message).not.toContain('styles/img/bg.png')
  })

  it('lists only the font on a Manifest V2 firefox build', () => {
    const {resources, warnings} = run(
      {manifest_version: 2},
      'production',
      'firefox'
    )

    expect(resources).toEqual(['fonts/a.woff2'])
    expect(warnings).toEqual([])
  })
})
