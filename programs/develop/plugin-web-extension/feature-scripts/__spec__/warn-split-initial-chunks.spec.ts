import {describe, expect, it} from 'vitest'
import {entryOwnJsFile, initialJsFiles} from '../../shared/initial-files'
import {
  classifyEntrySurface,
  WarnSplitInitialChunks
} from '../steps/warn-split-initial-chunks'

type FakeEntry = {
  files: string[]
  entryFile?: string
  runtimeFiles?: string[]
}

function makeCompilation(entries: Record<string, FakeEntry>) {
  const entrypoints = new Map(
    Object.entries(entries).map(([name, entry]) => [
      name,
      {
        getFiles: () => entry.files,
        getRuntimeChunk: () =>
          entry.runtimeFiles ? {files: new Set(entry.runtimeFiles)} : null,
        getEntrypointChunk: () =>
          entry.entryFile ? {files: new Set([entry.entryFile])} : null
      }
    ])
  )
  const compilation: any = {
    warnings: [],
    entrypoints,
    hooks: {
      processAssets: {tap: (_opts: any, fn: any) => fn()}
    }
  }
  const compiler: any = {
    hooks: {
      thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
    }
  }
  return {compiler, compilation}
}

function run(entries: Record<string, FakeEntry>) {
  const made = makeCompilation(entries)
  new WarnSplitInitialChunks().apply(made.compiler)
  return made.compilation.warnings as Array<Error & {file?: string}>
}

describe('initialJsFiles', () => {
  it('keeps script files only and drops hot-update files', () => {
    const files = initialJsFiles({
      getFiles: () => [
        'action/index.css',
        'action/index.js',
        'action/index.abc123.hot-update.js',
        'shared.mjs'
      ]
    })
    expect(files).toEqual(['action/index.js', 'shared.mjs'])
  })

  it('counts the runtime chunk once, ahead of the group files', () => {
    const files = initialJsFiles({
      getFiles: () => ['runtime.js', 'action/index.js'],
      getRuntimeChunk: () => ({files: new Set(['runtime.js'])})
    })
    expect(files).toEqual(['runtime.js', 'action/index.js'])
  })
})

describe('entryOwnJsFile', () => {
  it('prefers the entry chunk file, then the file named after the entry', () => {
    const files = ['shared.js', 'content_scripts/content-0.ab12cd34.js']
    expect(
      entryOwnJsFile(
        'content_scripts/content-0',
        {
          getFiles: () => files,
          getEntrypointChunk: () => ({
            files: new Set(['content_scripts/content-0.ab12cd34.js'])
          })
        },
        files
      )
    ).toBe('content_scripts/content-0.ab12cd34.js')
    expect(
      entryOwnJsFile(
        'content_scripts/content-0',
        {getFiles: () => files},
        files
      )
    ).toBe('content_scripts/content-0.ab12cd34.js')
  })
})

describe('classifyEntrySurface', () => {
  it('maps entry names to the surface that loads them', () => {
    expect(classifyEntrySurface('background/service_worker')).toBe('background')
    expect(classifyEntrySurface('background/scripts')).toBe('background')
    expect(classifyEntrySurface('content_scripts/content-0')).toBe(
      'content_script'
    )
    expect(classifyEntrySurface('scripts/inject')).toBe('script')
    for (const page of [
      'action/index',
      'options/index',
      'sidebar/index',
      'newtab/index',
      'devtools/index',
      'pages/main'
    ]) {
      expect(classifyEntrySurface(page)).toBe('page')
    }
  })
})

describe('WarnSplitInitialChunks', () => {
  it('warns once for an entry with two initial files', () => {
    const warnings = run({
      'action/index': {
        files: ['shared.js', 'action/index.js'],
        entryFile: 'action/index.js'
      }
    })
    expect(warnings).toHaveLength(1)
    const text = String(warnings[0].message)
    expect(text).toContain(
      'action/index is split into 2 initial files, but action/index.html references only action/index.js.'
    )
    expect(text).toContain('shared.js')
    expect(text).toContain('the page renders blank')
    expect(text).toContain(
      'https://extension.js.org/docs/features/rspack-configuration#share-a-module-between-entries'
    )
    expect(warnings[0].file).toBe('action/index.js')
  })

  it('stays silent for an entry with one initial file', () => {
    const warnings = run({
      'action/index': {files: ['action/index.js', 'action/index.css']},
      'background/service_worker': {files: ['background/service_worker.js']}
    })
    expect(warnings).toHaveLength(0)
  })

  it('ignores hot-update files', () => {
    const warnings = run({
      'content_scripts/content-0': {
        files: [
          'content_scripts/content-0.js',
          'content_scripts/content-0.abc123.hot-update.js'
        ]
      }
    })
    expect(warnings).toHaveLength(0)
  })

  it('counts a runtime chunk as an initial file', () => {
    const warnings = run({
      'background/service_worker': {
        files: ['background/service_worker.js'],
        runtimeFiles: ['runtime.js'],
        entryFile: 'background/service_worker.js'
      }
    })
    expect(warnings).toHaveLength(1)
    const text = String(warnings[0].message)
    expect(text).toContain(
      'the background registration loads only background/service_worker.js'
    )
    expect(text).toContain('runtime.js')
    expect(text).toContain('the background script never starts')
  })

  it('names the content script and injection surfaces', () => {
    const warnings = run({
      'content_scripts/content-0': {
        files: ['shared.js', 'content_scripts/content-0.js']
      },
      'scripts/inject': {files: ['shared.js', 'scripts/inject.js']}
    })
    expect(warnings).toHaveLength(2)
    expect(String(warnings[0].message)).toContain(
      'the content_scripts declaration injects only content_scripts/content-0.js'
    )
    expect(String(warnings[1].message)).toContain(
      'the runtime injection loads only scripts/inject.js'
    )
  })
})
