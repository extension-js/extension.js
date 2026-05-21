import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it} from 'vitest'

import {PersistManifestToDisk} from '../steps/persist-manifest'

type FakeCompilation = {
  errors: any[]
  outputOptions: {path: string}
  hooks: {processAssets: {tap: (opts: any, fn: () => void) => void}}
  getAsset: (name: string) => any
}

function makeCompiler(
  outputDir: string,
  buildCompilation: () => FakeCompilation
) {
  const compilation = buildCompilation()
  let processAssetsFn: (() => void) | undefined
  let afterEmitFn: ((c: FakeCompilation) => void) | undefined

  const compilationProxy: any = {
    ...compilation,
    hooks: {
      processAssets: {
        tap: (_opts: any, fn: () => void) => {
          processAssetsFn = fn
        }
      }
    }
  }

  const compiler: any = {
    options: {output: {path: outputDir}},
    hooks: {
      thisCompilation: {
        tap: (_name: string, fn: (c: any) => void) => fn(compilationProxy)
      },
      afterEmit: {
        tap: (_name: string, fn: (c: any) => void) => {
          afterEmitFn = fn
        }
      }
    }
  }

  return {
    compiler,
    compilation: compilationProxy as FakeCompilation,
    runProcessAssets: () => processAssetsFn?.(),
    runAfterEmit: () => afterEmitFn?.(compilationProxy)
  }
}

describe('PersistManifestToDisk', () => {
  it('writes the final manifest asset to disk atomically in afterEmit', () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'persist-manifest-')
    )

    const {compiler, runProcessAssets, runAfterEmit} = makeCompiler(
      outputDir,
      () => ({
        errors: [],
        outputOptions: {path: outputDir},
        hooks: {processAssets: {tap: () => undefined}},
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? {source: {source: () => '{\n  "name": "x"\n}'}}
            : undefined
      })
    )

    new PersistManifestToDisk().apply(compiler)
    runProcessAssets()
    runAfterEmit()

    expect(
      fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8')
    ).toBe('{\n  "name": "x"\n}')
    expect(
      fs
        .readdirSync(outputDir)
        .filter(
          (entry) => entry.includes('.manifest.') && entry.endsWith('.tmp')
        )
    ).toEqual([])
  })

  it('refuses to write a manifest whose chunks are missing from disk', () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'persist-manifest-missing-')
    )
    const manifestSource = JSON.stringify(
      {
        manifest_version: 3,
        content_scripts: [
          {js: ['content_scripts/content-0.aaaaaaaa.js']},
          {js: ['content_scripts/content-1.aaaaaaaa.js']}
        ]
      },
      null,
      2
    )

    fs.mkdirSync(path.join(outputDir, 'content_scripts'), {recursive: true})
    fs.writeFileSync(
      path.join(outputDir, 'content_scripts', 'content-0.aaaaaaaa.js'),
      '// content 0'
    )

    const compilationErrors: any[] = []
    const {compiler, runProcessAssets, runAfterEmit} = makeCompiler(
      outputDir,
      () => ({
        errors: compilationErrors,
        outputOptions: {path: outputDir},
        hooks: {processAssets: {tap: () => undefined}},
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? {source: {source: () => manifestSource}}
            : undefined
      })
    )

    new PersistManifestToDisk().apply(compiler)
    runProcessAssets()
    runAfterEmit()

    expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(false)
    expect(compilationErrors.length).toBe(1)
    expect(String(compilationErrors[0]?.message || '')).toContain(
      'content_scripts/content-1.aaaaaaaa.js'
    )
  })

  it('writes the manifest when every referenced chunk is on disk', () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'persist-manifest-ok-')
    )
    const manifestSource = JSON.stringify(
      {
        manifest_version: 3,
        content_scripts: [
          {js: ['content_scripts/content-0.aaaaaaaa.js']},
          {js: ['content_scripts/content-1.bbbbbbbb.js']}
        ]
      },
      null,
      2
    )

    fs.mkdirSync(path.join(outputDir, 'content_scripts'), {recursive: true})
    fs.writeFileSync(
      path.join(outputDir, 'content_scripts', 'content-0.aaaaaaaa.js'),
      '// content 0'
    )
    fs.writeFileSync(
      path.join(outputDir, 'content_scripts', 'content-1.bbbbbbbb.js'),
      '// content 1'
    )

    const compilationErrors: any[] = []
    const {compiler, runProcessAssets, runAfterEmit} = makeCompiler(
      outputDir,
      () => ({
        errors: compilationErrors,
        outputOptions: {path: outputDir},
        hooks: {processAssets: {tap: () => undefined}},
        getAsset: (name: string) =>
          name === 'manifest.json'
            ? {source: {source: () => manifestSource}}
            : undefined
      })
    )

    new PersistManifestToDisk().apply(compiler)
    runProcessAssets()
    runAfterEmit()

    expect(compilationErrors).toEqual([])
    const onDisk = fs.readFileSync(
      path.join(outputDir, 'manifest.json'),
      'utf-8'
    )
    expect(JSON.parse(onDisk).content_scripts).toHaveLength(2)
  })
})
