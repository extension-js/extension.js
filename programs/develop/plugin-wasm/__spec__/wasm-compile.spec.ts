import {afterAll, describe, expect, it} from 'vitest'
import {
  compileFixture,
  removeFixtureRoots
} from '../../plugin-static-assets/__spec__/helpers/compile-harness'
import {ANSWER_WASM} from '../../plugin-static-assets/__spec__/helpers/fixtures'
import {WasmPlugin} from '../index'

afterAll(() => removeFixtureRoots())

const files = {
  'answer.wasm': ANSWER_WASM,
  'index.js':
    "self.out = {answer: import('./answer.wasm').then((m) => m.answer())}\n"
}

describe('a .wasm import through a real compile', () => {
  it('builds with bare rspack: async WebAssembly is already its default', async () => {
    const build = await compileFixture({files, plugins: []})

    expect(build.compiler.options.experiments.asyncWebAssembly).toBe(true)
    expect(build.errors).toEqual([])
    expect(await build.evaluate()).toEqual({answer: 42})
  })

  it('builds with the plugin and no user setting', async () => {
    const build = await compileFixture({files, plugins: [new WasmPlugin()]})

    expect(build.compiler.options.experiments.asyncWebAssembly).toBe(true)
    expect(build.errors).toEqual([])
    expect(await build.evaluate()).toEqual({answer: 42})
  })

  it('overrides a user asyncWebAssembly false', async () => {
    // Pins today's behavior. Ledger 1386 D8.
    const build = await compileFixture({
      files,
      plugins: [],
      config: () => ({
        experiments: {asyncWebAssembly: false},
        plugins: [new WasmPlugin()]
      })
    })

    expect(build.compiler.options.experiments.asyncWebAssembly).toBe(true)
    expect(build.errors).toEqual([])
    expect(await build.evaluate()).toEqual({answer: 42})
  })
})
