import type {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {collectContentScriptEntryImports} from '../collect-entry-imports'

type ChunkWithAuxFiles = {auxiliaryFiles: string[]}
type EntryPointMock = {chunks: Set<ChunkWithAuxFiles>}
type ChunkGraphMock = {
  getChunkModulesIterable: (chunk: ChunkWithAuxFiles) => object[]
  getModuleChunks: (m: object) => ChunkWithAuxFiles[]
}

function makeCompilationMock(entries: Record<string, string[]>) {
  const entrypoints = new Map<string, EntryPointMock>()
  const chunkGraphModulesMap = new Map<ChunkWithAuxFiles, object[]>()
  const moduleToChunks = new Map<object, ChunkWithAuxFiles[]>()

  for (const [entryName, aux] of Object.entries(entries)) {
    const chunk = {auxiliaryFiles: aux}
    const entry: EntryPointMock = {chunks: new Set([chunk])}
    entrypoints.set(entryName, entry)
    const fakeModule: object = {}
    chunkGraphModulesMap.set(chunk, [fakeModule])
    moduleToChunks.set(fakeModule, [chunk])
  }

  const chunkGraph: ChunkGraphMock = {
    getChunkModulesIterable: (chunk) => chunkGraphModulesMap.get(chunk) || [],
    getModuleChunks: (m) => moduleToChunks.get(m) || []
  }

  return {
    entrypoints,
    chunkGraph
  } as Compilation
}

describe('collectContentScriptEntryImports', () => {
  it('collects auxiliary files for content script entries', () => {
    const compilation = makeCompilationMock({
      'content_scripts/content-a': ['a.css', 'a.svg'],
      background: ['bg.map']
    })

    const includeList = {
      'content_scripts/content-a': 'src/content-a.ts',
      background: 'src/bg.ts'
    } as Compilation

    const res = collectContentScriptEntryImports(compilation, includeList)
    expect(res['content_scripts/content-a']).toEqual(['a.css', 'a.svg'])
    expect(res.background).toBeUndefined()
  })

  it('de-dupes auxiliary files', () => {
    const compilation = makeCompilationMock({
      'content_scripts/x': ['a.css', 'a.css', 'b.css']
    })
    const includeList = {'content_scripts/x': 'src/x.ts'}
    const res = collectContentScriptEntryImports(compilation, includeList)
    expect(res['content_scripts/x']).toEqual(['a.css', 'b.css'])
  })

  function makeJsScanCompilationMock(entryName: string, jsSource: string) {
    const chunk = {
      files: [`${entryName}.js`],
      auxiliaryFiles: [] as string[]
    }
    const entry = {chunks: new Set([chunk])}
    const entrypoints = new Map([[entryName, entry]])

    const chunkGraph = {
      getChunkModulesIterable: () => [],
      getModuleChunks: () => []
    }

    return {
      entrypoints,
      chunkGraph,
      getAsset(name: string) {
        if (name !== `${entryName}.js`) return undefined
        return {source: () => jsSource}
      }
    } as unknown as Compilation
  }

  it('captures nested asset paths referenced from the entry JS, not just the first segment', () => {
    const jsSource = [
      'chrome.runtime.getURL("assets/fonts/x.woff2");',
      "var flat = 'assets/icon.png';",
      'fetch("assets/deep/nested/dir/img.svg")'
    ].join('\n')
    const compilation = makeJsScanCompilationMock(
      'content_scripts/content-0',
      jsSource
    )
    const includeList = {'content_scripts/content-0': 'src/content.ts'}

    const res = collectContentScriptEntryImports(compilation, includeList)
    expect(res['content_scripts/content-0']).toEqual(
      expect.arrayContaining([
        'assets/fonts/x.woff2',
        'assets/icon.png',
        'assets/deep/nested/dir/img.svg'
      ])
    )
    expect(res['content_scripts/content-0']).not.toContain('assets/fonts')
    expect(res['content_scripts/content-0']).not.toContain('assets/deep')
  })

  it('stops nested matches at quotes, parens, and whitespace', () => {
    const jsSource =
      'u("assets/a/b.png")+"assets/c/d.svg" + `assets/e/f.gif`\nassets/g/h.webp tail'
    const compilation = makeJsScanCompilationMock('content_scripts/y', jsSource)
    const includeList = {'content_scripts/y': 'src/y.ts'}

    const res = collectContentScriptEntryImports(compilation, includeList)
    expect(res['content_scripts/y']).toEqual(
      expect.arrayContaining([
        'assets/a/b.png',
        'assets/c/d.svg',
        'assets/e/f.gif',
        'assets/g/h.webp'
      ])
    )
    for (const entry of res['content_scripts/y']) {
      expect(entry).toMatch(/^assets\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/)
    }
  })
})
