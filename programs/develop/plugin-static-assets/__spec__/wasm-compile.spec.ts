import {afterAll, describe, expect, it} from 'vitest'
import {StaticAssetsPlugin} from '../index'
import {compileFixture, removeFixtureRoots} from './helpers/compile-harness'
import {ANSWER_WASM} from './helpers/fixtures'

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
    const build = await compileFixture({
      files,
      plugins: [new StaticAssetsPlugin()]
    })

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
        plugins: [new StaticAssetsPlugin()]
      })
    })

    expect(build.compiler.options.experiments.asyncWebAssembly).toBe(false)
    expect(build.errors).toHaveLength(1)
    // With the experiment off rspack has no wasm rule and parses the bytes as JS.
    expect(build.errors[0]).toContain(
      'JavaScript parse error: Invalid character at start of identifier'
    )

    expect(build.errors[0]).toContain(
      'You may need an appropriate loader to handle this file type.'
    )
  })

  it('sets no extension list on a config that has none, so rspack defaults stay', async () => {
    const pkg = {
      'node_modules/wrapper/package.json':
        '{"name":"wrapper","version":"1.0.0"}',
      'node_modules/wrapper/index.js': 'export default 7\n',
      'index.js': "import w from 'wrapper'\nself.out = {w}\n"
    }
    const bare = await compileFixture({files: pkg, plugins: []})
    const withPlugin = await compileFixture({
      files: pkg,
      plugins: [new StaticAssetsPlugin()]
    })

    expect(await bare.evaluate()).toEqual({w: 7})
    expect(await withPlugin.evaluate()).toEqual({w: 7})
    expect(withPlugin.main).toBe(bare.main)
    expect(withPlugin.compiler.options.resolve.extensions).toEqual(
      bare.compiler.options.resolve.extensions
    )
  })

  it('resolves an extensionless wasm import when the config lists its own extensions', async () => {
    const extensionless = {
      'answer.wasm': ANSWER_WASM,
      'index.js':
        "self.out = {answer: import('./answer').then((m) => m.answer())}\n"
    }
    const config = () => ({resolve: {extensions: ['.js', '.json']}})
    const bare = await compileFixture({
      files: extensionless,
      plugins: [],
      config
    })
    const withPlugin = await compileFixture({
      files: extensionless,
      plugins: [new StaticAssetsPlugin()],
      config
    })

    expect(bare.errors).toHaveLength(1)
    expect(bare.errors[0]).toContain(
      "Module not found: Can't resolve './answer'"
    )

    expect(withPlugin.compiler.options.resolve.extensions).toEqual([
      '.js',
      '.json',
      '.wasm'
    ])

    expect(withPlugin.errors).toEqual([])
    expect(await withPlugin.evaluate()).toEqual({answer: 42})
  })
})
