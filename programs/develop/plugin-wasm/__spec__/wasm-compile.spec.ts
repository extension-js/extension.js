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

  it('respects a user asyncWebAssembly false', async () => {
    const build = await compileFixture({
      files,
      plugins: [],
      config: () => ({
        experiments: {asyncWebAssembly: false},
        plugins: [new WasmPlugin()]
      })
    })

    expect(build.compiler.options.experiments.asyncWebAssembly).toBe(false)
    expect(build.errors).toHaveLength(1)
    // With the experiment off rspack has no wasm rule and parses the bytes as JS.
    expect(build.errors[0]).toContain(
      "JavaScript parse error: Unexpected character '\\0'"
    )

    expect(build.errors[0]).toContain(
      'You may need an appropriate loader to handle this file type.'
    )
  })
})
