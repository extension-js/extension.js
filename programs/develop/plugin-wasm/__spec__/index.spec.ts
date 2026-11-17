import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {WasmPlugin} from '../index'

const FFMPEG_CORE_JS = '@ffmpeg/core/dist/esm/ffmpeg-core.js'
const FFMPEG_CORE_WASM = '@ffmpeg/core/dist/esm/ffmpeg-core.wasm'

const ALIASED_REQUESTS = [
  '@ffmpeg/core/dist/esm/ffmpeg-core.js',
  '@ffmpeg/core/dist/esm/ffmpeg-core.wasm',
  '@ffmpeg/core-mt/dist/esm/ffmpeg-core.js',
  '@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm',
  '@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js',
  '@imagemagick/magick-wasm/magick.wasm',
  'tesseract-wasm/dist/tesseract-worker.js',
  'tesseract-wasm/dist/tesseract-core.wasm'
]

function writeAsset(root: string, relativePath: string) {
  const filePath = path.join(root, 'node_modules', relativePath)
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, 'asset')

  return filePath
}

function createCompiler(
  context: string,
  resolve: {alias?: Record<string, string>; extensions?: string[]} = {}
) {
  return {options: {context, resolve, experiments: {}}} as any
}

describe('WasmPlugin', () => {
  const temps: string[] = []

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  function makeTemp(prefix: string) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
    temps.push(dir)

    return dir
  }

  // A start folder in the temp tree instead of the process folder, so the walk
  // never finds a copy in the repository's own node_modules.
  function emptyCwd() {
    return makeTemp('extjs-wasm-cwd-')
  }

  it('resolves hoisted ffmpeg-core from the workspace root', () => {
    const workspace = makeTemp('extjs-wasm-hoist-')
    const projectRoot = path.join(workspace, 'packages', 'extension')
    fs.mkdirSync(projectRoot, {recursive: true})

    const hoistedJs = writeAsset(workspace, FFMPEG_CORE_JS)
    const hoistedWasm = writeAsset(workspace, FFMPEG_CORE_WASM)

    const compiler = createCompiler(projectRoot)
    new WasmPlugin().apply(compiler, emptyCwd())

    expect(compiler.options.resolve.alias).toEqual({
      [FFMPEG_CORE_JS]: hoistedJs,
      [FFMPEG_CORE_WASM]: hoistedWasm
    })
  })

  it('prefers the package-local copy over a hoisted workspace copy', () => {
    const workspace = makeTemp('extjs-wasm-local-')
    const projectRoot = path.join(workspace, 'packages', 'extension')
    fs.mkdirSync(projectRoot, {recursive: true})

    writeAsset(workspace, FFMPEG_CORE_JS)
    const localJs = writeAsset(projectRoot, FFMPEG_CORE_JS)

    const compiler = createCompiler(projectRoot)
    new WasmPlugin().apply(compiler, emptyCwd())

    expect(compiler.options.resolve.alias).toEqual({[FFMPEG_CORE_JS]: localJs})
  })

  it('also walks up from the start folder when the project has no copy', () => {
    const projectRoot = makeTemp('extjs-wasm-project-')
    const elsewhere = makeTemp('extjs-wasm-elsewhere-')
    const start = path.join(elsewhere, 'nested', 'folder')
    fs.mkdirSync(start, {recursive: true})
    const found = writeAsset(elsewhere, FFMPEG_CORE_WASM)

    const compiler = createCompiler(projectRoot)
    new WasmPlugin().apply(compiler, start)

    expect(compiler.options.resolve.alias).toEqual({[FFMPEG_CORE_WASM]: found})
  })

  it('aliases each of the eight requests it knows when the files exist', () => {
    const projectRoot = makeTemp('extjs-wasm-all-')
    const expected = Object.fromEntries(
      ALIASED_REQUESTS.map((request) => [
        request,
        writeAsset(projectRoot, request)
      ])
    )
    writeAsset(projectRoot, '@ffmpeg/core/dist/umd/ffmpeg-core.js')

    const compiler = createCompiler(projectRoot)
    new WasmPlugin().apply(compiler, emptyCwd())

    expect(compiler.options.resolve.alias).toEqual(expected)
  })

  it('adds no alias when nothing is installed and keeps the user aliases', () => {
    const projectRoot = makeTemp('extjs-wasm-defaults-')
    const compiler = createCompiler(projectRoot, {
      alias: {keepMe: '/user/alias'}
    })

    new WasmPlugin().apply(compiler, emptyCwd())

    expect(compiler.options.resolve.alias).toEqual({keepMe: '/user/alias'})
    expect(compiler.options.experiments).toEqual({})
  })

  it('lets a user alias for the same request win over the one it found', () => {
    const projectRoot = makeTemp('extjs-wasm-user-wins-')
    writeAsset(projectRoot, FFMPEG_CORE_JS)
    const compiler = createCompiler(projectRoot, {
      alias: {[FFMPEG_CORE_JS]: '/user/ffmpeg-core.js'}
    })

    new WasmPlugin().apply(compiler, emptyCwd())

    expect(compiler.options.resolve.alias).toEqual({
      [FFMPEG_CORE_JS]: '/user/ffmpeg-core.js'
    })
  })

  it('appends .wasm to the user extensions without dropping or repeating any', () => {
    const projectRoot = makeTemp('extjs-wasm-ext-')
    const withUser = createCompiler(projectRoot, {extensions: ['.ts', '.js']})
    const withWasm = createCompiler(projectRoot, {
      extensions: ['.wasm', '.ts']
    })
    const withNone = createCompiler(projectRoot)

    new WasmPlugin().apply(withUser, emptyCwd())
    new WasmPlugin().apply(withWasm, emptyCwd())
    new WasmPlugin().apply(withNone, emptyCwd())

    expect(withUser.options.resolve.extensions).toEqual(['.ts', '.js', '.wasm'])
    expect(withWasm.options.resolve.extensions).toEqual(['.wasm', '.ts'])
    expect(withNone.options.resolve.extensions).toEqual(['.wasm'])
  })
})
