import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {writeProjectFiles} from '../../../__spec__/helpers/extension-project'
import {asCompiler, type TapCallback} from '../../__spec__/helpers/rspack-fakes'
import {TraceRuntimeLoadedFiles} from '../steps/trace-runtime-loaded-files'

// A diagnostic as the step under test reports it.
type Reported = Error & {file?: string}

// An asset as the fake compilation keeps it.
type EmittedAsset = {name: string; source: {source(): string | Buffer}}

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, {recursive: true, force: true})
  }
})

function project(files: Record<string, string>) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-folder-pages-'))
  )

  tempDirs.push(dir)

  const all = {
    'manifest.json': JSON.stringify({manifest_version: 3, name: 'fixture'}),
    'package.json': JSON.stringify({name: 'fixture', version: '0.0.0'}),
    ...files
  }

  writeProjectFiles(dir, all)

  return dir
}

async function runTrace(projectDir: string, assets: Record<string, string>) {
  const emitted = new Map<string, EmittedAsset>(
    Object.entries(assets).map(([name, src]) => [
      name,
      {name, source: {source: () => src}}
    ])
  )
  const compilation = {
    warnings: [] as Reported[],
    errors: [] as Reported[],
    fileDependencies: new Set<string>(),
    modules: [],
    getAsset: (name: string) => emitted.get(name),
    getAssets: () => Array.from(emitted.values()),
    emitAsset: (name: string, source: EmittedAsset['source']) => {
      emitted.set(name, {name, source})
    },
    updateAsset: (name: string, source: EmittedAsset['source']) => {
      emitted.set(name, {name, source})
    },
    createChildCompiler: () => {
      throw new Error('unexpected child compilation in a unit fixture')
    },
    hooks: {
      processAssets: {tapPromise: (_opts: unknown, fn: TapCallback) => fn()}
    }
  }
  const compiler = asCompiler({
    options: {entry: {}, mode: 'production', context: projectDir},
    hooks: {
      thisCompilation: {tap: (_n: string, fn: TapCallback) => fn(compilation)}
    }
  })

  new TraceRuntimeLoadedFiles({
    manifestPath: path.join(projectDir, 'manifest.json')
  }).apply(compiler)

  await Promise.resolve()

  const text = (name: string) => String(emitted.get(name)?.source.source())

  return {names: [...emitted.keys()].sort(), text, compilation}
}

const RAW = '<html><body>RAW<script src="./index.ts"></script></body></html>'
const COMPILED = (script: string) =>
  `<html><body>COMPILED<script src="/${script}"></script></body></html>`

describe('a pages/ folder page a script names through getURL', () => {
  it('serves the compiled page at pages/x/index.html and copies no source', async () => {
    const dir = project({
      'pages/welcome/index.html': RAW,
      'pages/welcome/index.ts': 'const typed: string = "x"\n'
    })
    const {names, text} = await runTrace(dir, {
      'background/service_worker.js':
        'chrome.runtime.getURL("pages/welcome/index.html")',
      'pages/welcome.html': COMPILED('pages/welcome.js'),
      'pages/welcome.js': 'console.log("compiled")'
    })

    expect(names).toEqual([
      'background/service_worker.js',
      'pages/welcome.html',
      'pages/welcome.js',
      'pages/welcome/index.html'
    ])

    expect(text('pages/welcome/index.html')).toBe(COMPILED('pages/welcome.js'))
  })

  it('serves a nested folder page the same way', async () => {
    const dir = project({
      'pages/deep/er/index.html': RAW,
      'pages/deep/er/index.ts': 'export {}\n'
    })
    const {names, text} = await runTrace(dir, {
      'background/service_worker.js':
        'chrome.runtime.getURL("/pages/deep/er/index.html")',
      'pages/deep/er.html': COMPILED('pages/deep/er.js'),
      'pages/deep/er.js': 'console.log("compiled")'
    })

    expect(names).toContain('pages/deep/er/index.html')
    expect(names).not.toContain('pages/deep/er/index.ts')
    expect(names).not.toContain('pages/deep/er/index.js')
    expect(text('pages/deep/er/index.html')).toBe(COMPILED('pages/deep/er.js'))
  })

  it('leaves pages/x.html alone, since it is built where it was written', async () => {
    const dir = project({
      'pages/plain.html': RAW,
      'pages/plain.js': 'console.log("raw")\n'
    })
    const {names, text} = await runTrace(dir, {
      'background/service_worker.js':
        'chrome.runtime.getURL("pages/plain.html")',
      'pages/plain.html': COMPILED('pages/plain.js'),
      'pages/plain.js': 'console.log("compiled")'
    })

    expect(names).toEqual([
      'background/service_worker.js',
      'pages/plain.html',
      'pages/plain.js'
    ])

    expect(text('pages/plain.js')).toBe('console.log("compiled")')
  })

  it('ships the file a served page fetches beside itself', async () => {
    const dir = project({
      'pages/welcome/index.html': RAW,
      'pages/welcome/index.ts': 'export {}\n',
      'pages/welcome/data.json': '{"value":1}'
    })
    const {names} = await runTrace(dir, {
      'background/service_worker.js':
        'chrome.runtime.getURL("pages/welcome/index.html")',
      'pages/welcome.html': COMPILED('pages/welcome.js'),
      'pages/welcome.js': 'fetch("./data.json")'
    })

    expect(names).toContain('pages/welcome/data.json')
  })

  it('still copies a page under pages/ that the build did not compile', async () => {
    const dir = project({
      'pages/welcome/index.html': '<html><body>RAW</body></html>'
    })
    const {names, text} = await runTrace(dir, {
      'background/service_worker.js':
        'chrome.runtime.getURL("pages/welcome/index.html")'
    })

    expect(names).toContain('pages/welcome/index.html')
    expect(text('pages/welcome/index.html')).toContain('RAW')
  })
})
