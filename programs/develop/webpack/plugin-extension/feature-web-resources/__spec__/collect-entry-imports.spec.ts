import {describe, it, expect} from 'vitest'
import type {Compilation} from '@rspack/core'
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
    expect(res['background']).toBeUndefined()
  })

  it('de-dupes auxiliary files', () => {
    const compilation = makeCompilationMock({
      'content_scripts/x': ['a.css', 'a.css', 'b.css']
    })
    const includeList = {'content_scripts/x': 'src/x.ts'}
    const res = collectContentScriptEntryImports(compilation, includeList)
    expect(res['content_scripts/x']).toEqual(['a.css', 'b.css'])
  })
})
