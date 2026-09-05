import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

import {
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  requestDevSessionRestart,
  unbindDevSessionRestart
} from '../../../dev-server/session-restart'
import {PersistManifestToDisk} from '../steps/persist-manifest'

afterEach(() => {
  unbindDevSessionRestart()
})

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

  it('keeps the last working manifest through an errored compile and drops that cycle', () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'persist-manifest-errored-')
    )
    const manifestOnDisk = () =>
      fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8')
    const lastGood = '{\n  "name": "last-good"\n}'
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), lastGood)

    const compilationErrors: any[] = [new Error('Unexpected token')]
    let manifestSource = '{\n  "name": "from-the-broken-pass"\n}'
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
    expect(manifestOnDisk()).toBe(lastGood)
    expect(compilationErrors).toHaveLength(1)

    // The errored capture is cleared inside the hook: a flush that follows
    // with no fresh capture must not leak the broken pass onto disk.
    compilationErrors.length = 0
    runAfterEmit()
    expect(manifestOnDisk()).toBe(lastGood)

    // The next clean cycle writes its own manifest.
    manifestSource = '{\n  "name": "next-good"\n}'
    runProcessAssets()
    runAfterEmit()
    expect(manifestOnDisk()).toBe('{\n  "name": "next-good"\n}')
    expect(compilationErrors).toEqual([])
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

  it('stays quiet about missing chunks when a restart will emit them', () => {
    const outputDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'persist-manifest-restarting-')
    )
    const manifestSource = JSON.stringify({
      manifest_version: 3,
      content_scripts: [{js: ['content_scripts/content-1.aaaaaaaa.js']}]
    })
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
    const scheduler = new DevSessionRestartScheduler(60_000)
    scheduler.setHandler(() => {})
    bindDevSessionRestart(scheduler)
    requestDevSessionRestart(compiler, {reason: 'scripts'})

    new PersistManifestToDisk().apply(compiler)
    runProcessAssets()
    runAfterEmit()

    expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(false)
    expect(compilationErrors).toHaveLength(0)
    scheduler.dispose()
  })
})
