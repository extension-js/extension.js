import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  type SourceFeatureIndex
} from '../index'

const count = (n: number) => () => n

describe('classifyReloadFromSources', () => {
  it('returns undefined when nothing changed', () => {
    expect(
      classifyReloadFromSources({
        changedSources: [],
        getContentScriptCount: count(3)
      })
    ).toBeUndefined()
  })

  it('a manifest/_locales change forces a full reload', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/content/scripts.js'],
        forcedFull: true,
        getContentScriptCount: count(1)
      })
    ).toMatchObject({type: 'full'})
  })

  it('a background/service-worker source change → service-worker', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/background.ts'],
        getContentScriptCount: count(1)
      })
    ).toMatchObject({type: 'service-worker'})
  })

  it('a content source change with declared content scripts → content-scripts with canonical entries', () => {
    const result = classifyReloadFromSources({
      changedSources: ['src/content/scripts.js'],
      getContentScriptCount: count(2)
    })
    expect(result?.type).toBe('content-scripts')
    expect(result?.changedContentScriptEntries).toHaveLength(2)
    expect(result?.changedAssets).toEqual(['src/content/scripts.js'])
  })

  it('a page-only edit with no content scripts → notify-only "page" (livereload owns the refresh)', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/popup/index.js'],
        getContentScriptCount: count(0)
      })
    ).toMatchObject({
      type: 'page',
      label: 'popup page (src/popup/index.js)'
    })
  })

  it('builds the shared context label for every classification', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/manifest.json'],
        forcedFull: true,
        getContentScriptCount: count(1)
      })?.label
    ).toBe('extension (src/manifest.json)')

    expect(
      classifyReloadFromSources({
        changedSources: ['src/background.ts'],
        getContentScriptCount: count(1)
      })?.label
    ).toBe('service_worker (src/background.ts)')

    expect(
      classifyReloadFromSources({
        changedSources: ['src/content/scripts.js'],
        getContentScriptCount: count(1)
      })?.label
    ).toBe('content_script (src/content/scripts.js)')

    expect(
      classifyReloadFromSources({
        changedSources: ['src/sidebar/index.tsx'],
        getContentScriptCount: count(0)
      })?.label
    ).toBe('sidebar page (src/sidebar/index.tsx)')
  })

  it('caps the label file list at two entries', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        forcedFull: true,
        getContentScriptCount: count(0)
      })?.label
    ).toBe('extension (src/a.ts, src/b.ts +2 more)')
  })

  it('does not read the content-script count when classification resolves earlier', () => {
    let called = 0
    classifyReloadFromSources({
      changedSources: ['src/background.ts'],
      getContentScriptCount: () => {
        called++
        return 1
      }
    })
    expect(called).toBe(0)
  })
})

describe('classifyReloadFromSources with a chunk-graph source index', () => {
  const index = (
    over: Partial<SourceFeatureIndex> = {}
  ): SourceFeatureIndex => ({
    swSources: new Set<string>(),
    contentEntriesBySource: new Map<string, Set<string>>(),
    pageSources: new Set<string>(),
    ...over
  })

  it('classifies an unconventionally named SW source as service-worker (anshul regression)', () => {
    const result = classifyReloadFromSources({
      changedSources: ['background-ultimate.js'],
      getContentScriptCount: count(1),
      getSourceFeatureIndex: () =>
        index({swSources: new Set(['background-ultimate.js'])})
    })
    expect(result?.type).toBe('service-worker')
  })

  it('re-injects only the content entries whose chunks contain a changed file', () => {
    const result = classifyReloadFromSources({
      changedSources: ['src/content-two.js'],
      getContentScriptCount: count(3),
      getSourceFeatureIndex: () =>
        index({
          contentEntriesBySource: new Map([
            ['src/content-one.js', new Set(['content_scripts/content-0'])],
            ['src/content-two.js', new Set(['content_scripts/content-1'])]
          ])
        })
    })
    expect(result?.type).toBe('content-scripts')
    expect(result?.changedContentScriptEntries).toEqual([
      'content_scripts/content-1'
    ])
  })

  it('a changed emitted static asset (icon) → full reload, not a content reinject storm (Sappgulf regression)', () => {
    const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-classify-'))
    fs.mkdirSync(path.join(outputPath, 'assets'), {recursive: true})
    fs.writeFileSync(path.join(outputPath, 'assets/icon16.png'), 'png')
    try {
      const result = classifyReloadFromSources({
        changedSources: ['assets/icon16.png'],
        getContentScriptCount: count(1),
        getSourceFeatureIndex: () => index(),
        outputPath
      })
      expect(result?.type).toBe('full')
    } finally {
      fs.rmSync(outputPath, {recursive: true, force: true})
    }
  })

  it('a page-chunk source → notify-only page even when content scripts exist', () => {
    const result = classifyReloadFromSources({
      changedSources: ['src/popup/App.jsx'],
      getContentScriptCount: count(2),
      getSourceFeatureIndex: () =>
        index({pageSources: new Set(['src/popup/App.jsx'])})
    })
    expect(result?.type).toBe('page')
  })

  it('a shared SW+content source fans out to both reload paths (firefox-tab-switcher regression)', () => {
    const result = classifyReloadFromSources({
      changedSources: ['shared.js'],
      getContentScriptCount: count(1),
      getSourceFeatureIndex: () =>
        index({
          swSources: new Set(['shared.js']),
          contentEntriesBySource: new Map([
            ['shared.js', new Set(['content_scripts/content-0'])]
          ])
        })
    })
    expect(result?.type).toBe('service-worker')
    expect(result?.changedContentScriptEntries).toEqual([
      'content_scripts/content-0'
    ])
    expect(result?.label).toBe('service_worker + content_script (shared.js)')
  })

  it('a SW-only change carries no content entries and keeps the plain label', () => {
    const result = classifyReloadFromSources({
      changedSources: ['src/background.ts'],
      getContentScriptCount: count(1),
      getSourceFeatureIndex: () =>
        index({swSources: new Set(['src/background.ts'])})
    })
    expect(result?.type).toBe('service-worker')
    expect(result?.changedContentScriptEntries).toBeUndefined()
    expect(result?.label).toBe('service_worker (src/background.ts)')
  })

  it('falls back to the name heuristics when the index thunk throws', () => {
    const result = classifyReloadFromSources({
      changedSources: ['src/background.ts'],
      getContentScriptCount: count(1),
      getSourceFeatureIndex: () => {
        throw new Error('no compilation')
      }
    })
    expect(result?.type).toBe('service-worker')
  })
})

describe('buildSourceFeatureIndex', () => {
  function fakeCompilation(
    chunks: Array<{name: string; identifiers: string[]}>
  ) {
    const byChunk = new Map<any, string[]>()
    const chunkObjs = chunks.map((c) => {
      const chunk = {name: c.name}
      byChunk.set(chunk, c.identifiers)
      return chunk
    })
    return {
      chunks: chunkObjs,
      chunkGraph: {
        getChunkModulesIterable(chunk: any) {
          return (byChunk.get(chunk) || []).map((id) => ({
            identifier: () => id
          }))
        }
      }
    }
  }

  it('maps loader-prefixed, layered module identifiers to project-relative sources per feature', () => {
    const ctx = '/proj'
    const compilation = fakeCompilation([
      {
        name: 'background/service_worker',
        identifiers: ['/abs/loader.js??ref!/proj/background-ultimate.js']
      },
      {
        name: 'content_scripts/content-0',
        identifiers: [
          '/abs/wrapper.js!/proj/content/content-script.js|extensionjs-content-script'
        ]
      },
      {name: 'action/index', identifiers: ['/proj/popup/popup.js']}
    ])
    const idx = buildSourceFeatureIndex(compilation, ctx)
    expect(idx.swSources.has('background-ultimate.js')).toBe(true)
    expect(idx.contentEntriesBySource.get('content/content-script.js')).toEqual(
      new Set(['content_scripts/content-0'])
    )
    expect(idx.pageSources.has('popup/popup.js')).toBe(true)
  })

  it('expands classic-concat member files hidden in the resource query', () => {
    const ctx = '/proj'
    const members = JSON.stringify({
      feature: 'content_scripts/content-0',
      js: ['/proj/a.js', '/proj/b.js'],
      css: []
    })
    const compilation = fakeCompilation([
      {
        name: 'content_scripts/content-0',
        identifiers: [
          `/proj/a.js?__extensionjs_classic_concat__=${encodeURIComponent(members)}|extensionjs-content-script`
        ]
      }
    ])
    const idx = buildSourceFeatureIndex(compilation, ctx)
    expect(idx.contentEntriesBySource.has('a.js')).toBe(true)
    expect(idx.contentEntriesBySource.has('b.js')).toBe(true)
  })
})

describe('scripts/ bundle edits carry changedScriptFiles for the SW replay', () => {
  const index = (
    over: Partial<SourceFeatureIndex> = {}
  ): SourceFeatureIndex => ({
    swSources: new Set<string>(),
    contentEntriesBySource: new Map<string, Set<string>>(),
    pageSources: new Set<string>(),
    ...over
  })

  it('a scripts/ source edit stays a notify-only page reload and names its emitted bundle', () => {
    const result = classifyReloadFromSources({
      changedSources: ['scripts/widget.ts'],
      getContentScriptCount: count(1),
      getSourceFeatureIndex: () =>
        index({
          pageSources: new Set(['scripts/widget.ts']),
          scriptFilesBySource: new Map([
            ['scripts/widget.ts', new Set(['scripts/widget.js'])]
          ])
        })
    })
    expect(result).toMatchObject({
      type: 'page',
      changedScriptFiles: ['scripts/widget.js']
    })
  })

  it('a helper shared by the SW and a scripts/ bundle keeps the SW reload and still names the bundle', () => {
    const result = classifyReloadFromSources({
      changedSources: ['src/shared.ts'],
      getContentScriptCount: count(0),
      getSourceFeatureIndex: () =>
        index({
          swSources: new Set(['src/shared.ts']),
          scriptFilesBySource: new Map([
            [
              'src/shared.ts',
              new Set(['scripts/widget.js', 'scripts/panel.js'])
            ]
          ])
        })
    })
    expect(result).toMatchObject({
      type: 'service-worker',
      changedScriptFiles: ['scripts/panel.js', 'scripts/widget.js']
    })
  })

  it('a page edit outside scripts/ carries no changedScriptFiles', () => {
    const result = classifyReloadFromSources({
      changedSources: ['popup/popup.js'],
      getContentScriptCount: count(1),
      getSourceFeatureIndex: () =>
        index({
          pageSources: new Set(['popup/popup.js']),
          scriptFilesBySource: new Map([
            ['scripts/widget.ts', new Set(['scripts/widget.js'])]
          ])
        })
    })
    expect(result?.type).toBe('page')
    expect(result?.changedScriptFiles).toBeUndefined()
  })

  it('buildSourceFeatureIndex maps a scripts/ chunk to its emitted js files', () => {
    const chunks = [
      {
        name: 'scripts/widget',
        files: new Set(['scripts/widget.js', 'scripts/widget.js.map']),
        identifiers: ['/proj/scripts/widget.ts', '/proj/src/shared.ts']
      },
      {name: 'scripts/panel', identifiers: ['/proj/scripts/panel.js']},
      {name: 'action/index', identifiers: ['/proj/popup/popup.js']}
    ]
    const byChunk = new Map<any, string[]>()
    const chunkObjs = chunks.map(({identifiers, ...chunk}) => {
      byChunk.set(chunk, identifiers)
      return chunk
    })
    const compilation: any = {
      chunks: chunkObjs,
      chunkGraph: {
        getChunkModulesIterable: (chunk: any) =>
          (byChunk.get(chunk) || []).map((id) => ({identifier: () => id}))
      }
    }

    const idx = buildSourceFeatureIndex(compilation, '/proj')

    expect(idx.scriptFilesBySource?.get('scripts/widget.ts')).toEqual(
      new Set(['scripts/widget.js'])
    )
    expect(idx.scriptFilesBySource?.get('src/shared.ts')).toEqual(
      new Set(['scripts/widget.js'])
    )
    // No chunk file list (a unit fake): the unhashed [name].js form stands in.
    expect(idx.scriptFilesBySource?.get('scripts/panel.js')).toEqual(
      new Set(['scripts/panel.js'])
    )
    expect(idx.scriptFilesBySource?.has('popup/popup.js')).toBe(false)
    expect(idx.pageSources.has('scripts/widget.ts')).toBe(true)
  })
})
