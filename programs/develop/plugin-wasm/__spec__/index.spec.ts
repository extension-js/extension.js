import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {WasmPlugin} from '../index'

const FFMPEG_CORE_JS = '@ffmpeg/core/dist/esm/ffmpeg-core.js'
const FFMPEG_CORE_WASM = '@ffmpeg/core/dist/esm/ffmpeg-core.wasm'

function writeAsset(root: string, relativePath: string) {
  const filePath = path.join(root, 'node_modules', relativePath)
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, 'asset')
  return filePath
}

function createCompiler(context: string, alias?: Record<string, string>) {
  return {
    options: {
      context,
      resolve: alias ? {alias} : {},
      experiments: {}
    }
  } as any
}

describe('WasmPlugin', () => {
  const temps: string[] = []

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  function makeTemp(prefix: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    temps.push(dir)
    return dir
  }

  it('resolves hoisted ffmpeg-core from the workspace root', () => {
    const workspace = makeTemp('extjs-wasm-hoist-')
    const projectRoot = path.join(workspace, 'packages', 'extension')
    fs.mkdirSync(projectRoot, {recursive: true})

    const hoistedJs = writeAsset(workspace, FFMPEG_CORE_JS)
    const hoistedWasm = writeAsset(workspace, FFMPEG_CORE_WASM)

    const compiler = createCompiler(projectRoot)
    new WasmPlugin({
      manifestPath: path.join(projectRoot, 'manifest.json'),
      mode: 'development'
    }).apply(compiler)

    expect(compiler.options.resolve.alias[FFMPEG_CORE_JS]).toBe(hoistedJs)
    expect(compiler.options.resolve.alias[FFMPEG_CORE_WASM]).toBe(hoistedWasm)
  })

  it('prefers the package-local copy over a hoisted workspace copy', () => {
    const workspace = makeTemp('extjs-wasm-local-')
    const projectRoot = path.join(workspace, 'packages', 'extension')
    fs.mkdirSync(projectRoot, {recursive: true})

    writeAsset(workspace, FFMPEG_CORE_JS)
    const localJs = writeAsset(projectRoot, FFMPEG_CORE_JS)

    const compiler = createCompiler(projectRoot)
    new WasmPlugin({
      manifestPath: path.join(projectRoot, 'manifest.json'),
      mode: 'production'
    }).apply(compiler)

    expect(compiler.options.resolve.alias[FFMPEG_CORE_JS]).toBe(localJs)
  })

  it('enables async wasm, adds the .wasm extension, and keeps user aliases', () => {
    const projectRoot = makeTemp('extjs-wasm-defaults-')
    const compiler = createCompiler(projectRoot, {keepMe: '/user/alias'})

    new WasmPlugin({
      manifestPath: path.join(projectRoot, 'manifest.json'),
      mode: 'development'
    }).apply(compiler)

    expect(compiler.options.experiments.asyncWebAssembly).toBe(true)
    expect(compiler.options.resolve.extensions).toContain('.wasm')
    expect(compiler.options.resolve.alias.keepMe).toBe('/user/alias')
    expect(compiler.options.resolve.alias[FFMPEG_CORE_JS]).toBeUndefined()
  })
})
