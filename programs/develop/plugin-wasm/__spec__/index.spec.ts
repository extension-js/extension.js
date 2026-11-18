import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {WasmPlugin} from '../index'

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

  it('adds no alias and keeps the user aliases', () => {
    const projectRoot = makeTemp('extjs-wasm-defaults-')
    const compiler = createCompiler(projectRoot, {
      alias: {keepMe: '/user/alias'}
    })

    new WasmPlugin().apply(compiler)

    expect(compiler.options.resolve.alias).toEqual({keepMe: '/user/alias'})
    expect(compiler.options.experiments).toEqual({})
  })

  it('appends .wasm to the user extensions without dropping or repeating any', () => {
    const projectRoot = makeTemp('extjs-wasm-ext-')
    const withUser = createCompiler(projectRoot, {extensions: ['.ts', '.js']})
    const withWasm = createCompiler(projectRoot, {
      extensions: ['.wasm', '.ts']
    })
    const withNone = createCompiler(projectRoot)

    new WasmPlugin().apply(withUser)
    new WasmPlugin().apply(withWasm)
    new WasmPlugin().apply(withNone)

    expect(withUser.options.resolve.extensions).toEqual(['.ts', '.js', '.wasm'])
    expect(withWasm.options.resolve.extensions).toEqual(['.wasm', '.ts'])
    expect(withNone.options.resolve.extensions).toEqual(['.wasm'])
  })
})
