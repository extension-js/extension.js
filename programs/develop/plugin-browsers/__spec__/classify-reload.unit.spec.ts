// Unit spec for the pure reload classifier shared by the launched-browser path
// (BrowsersPlugin) and the controller-less `--no-browser` reload broadcast.
// Keeping both paths on one classifier guarantees a given change reloads
// identically whether or not a browser was launched.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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
  const index = (over: Partial<SourceFeatureIndex> = {}): SourceFeatureIndex => ({
    swSources: new Set<string>(),
    contentEntriesBySource: new Map<string, Set<string>>(),
    pageSources: new Set<string>(),
    ...over
  })

  it('classifies an unconventionally named SW source as service-worker (anshul regression)', () => {
    // `background-ultimate.js` fails the /background(\.|\/)/ name pattern and
    // used to be re-injected as a content script — the SW never restarted.
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
    // A module listed in both background.scripts and content_scripts[].js
    // used to classify SW-only — the SW restarted while every open tab kept
    // the stale content world. The instruction stays 'service-worker' (the
    // restart carries it) but must name the stale content entries and say so.
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
    expect(
      idx.contentEntriesBySource.get('content/content-script.js')
    ).toEqual(new Set(['content_scripts/content-0']))
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
